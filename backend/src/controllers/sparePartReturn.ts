import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'

// ─── Yaratish ────────────────────────────────────────────────────────────────

export async function createReturn(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { maintenanceId, vehicleId, warehouseId, reason, notes, items } = req.body
    // items: [{ sparePartId, quantity, unitCost }]

    if (!reason?.trim()) throw new AppError('Qaytarish sababi kiritilishi shart', 400)
    if (!warehouseId) throw new AppError('Ombor ko\'rsatilmagan', 400)
    if (!Array.isArray(items) || items.length === 0) throw new AppError('Kamida bitta ehtiyot qism kiritilishi shart', 400)

    // If linked to a maintenance record — validate items vs original
    if (maintenanceId) {
      const maint = await prisma.maintenanceRecord.findUnique({
        where: { id: maintenanceId },
        include: {
          items: true,
          returns: { where: { status: { not: 'rejected' } }, include: { items: true } },
          vehicle: { select: { branchId: true } },
        },
      })
      if (!maint) throw new AppError('Ta\'mirlash yozuvi topilmadi', 404)
      if ((maint as any).status !== 'approved') throw new AppError('Faqat tasdiqlangan ta\'mirlash yozuvidan qaytarish mumkin', 400)

      // Security: user can only return parts from their own branch's maintenance records
      const retFilter = await getOrgFilter(req.user!)
      if (!isBranchAllowed(retFilter, maint.vehicle.branchId)) {
        throw new AppError('Boshqa filialdagi ta\'mirlash yozuvidan qaytarish mumkin emas', 403)
      }

      // Check already-returned quantities
      const alreadyReturned: Record<string, number> = {}
      for (const ret of (maint as any).returns) {
        for (const ri of ret.items) {
          alreadyReturned[ri.sparePartId] = (alreadyReturned[ri.sparePartId] || 0) + ri.quantity
        }
      }

      // Original quantities from the maintenance
      const originalQty: Record<string, number> = {}
      for (const mi of maint.items) {
        originalQty[mi.sparePartId] = (originalQty[mi.sparePartId] || 0) + mi.quantityUsed
      }

      for (const item of items) {
        const qty = Number(item.quantity)
        const orig = originalQty[item.sparePartId] || 0
        const returned = alreadyReturned[item.sparePartId] || 0
        const canReturn = orig - returned
        if (qty <= 0) throw new AppError('Miqdor 0 dan katta bo\'lishi kerak', 400)
        if (qty > canReturn) {
          const sp = await prisma.sparePart.findUnique({ where: { id: item.sparePartId }, select: { name: true } })
          throw new AppError(
            `"${sp?.name}": qaytarish mumkin bo'lgan max miqdor — ${canReturn} ta (avval ${returned} ta qaytarilgan)`,
            400
          )
        }
      }
    } else {
      // Free return — just validate qty > 0
      for (const item of items) {
        if (Number(item.quantity) <= 0) throw new AppError('Miqdor 0 dan katta bo\'lishi kerak', 400)
      }
    }

    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true } })
    if (!warehouse) throw new AppError('Ombor topilmadi', 404)

    // Determine branchId from user
    const branchId = req.user!.branchId
    if (!branchId) throw new AppError('Foydalanuvchi filialsiz qaytarish qila olmaydi', 400)

    const created = await prisma.sparePartReturn.create({
      data: {
        maintenanceId: maintenanceId || null,
        vehicleId: vehicleId || null,
        warehouseId,
        branchId,
        returnedById: req.user!.id,
        reason: reason.trim(),
        notes: notes?.trim() || null,
        status: 'pending_approval',
        items: {
          create: items.map((item: any) => ({
            sparePartId: item.sparePartId,
            warehouseId,
            quantity: Number(item.quantity),
            unitCost: Number(item.unitCost) || 0,
          })),
        },
      },
      include: {
        items: { include: { sparePart: { select: { name: true, partCode: true } } } },
        returnedBy: { select: { fullName: true } },
      },
    })

    // Notify admins
    try {
      const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { organizationId: true } })
      const orgId = branch?.organizationId ?? branchId
      const orgBranches = await prisma.branch.findMany({ where: { organizationId: orgId }, select: { id: true } })
      const admins = await prisma.user.findMany({
        where: { isActive: true, branchId: { in: orgBranches.map((b: any) => b.id) }, role: { in: ['admin', 'super_admin'] } },
        select: { id: true },
      })
      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((a: any) => ({
            userId: a.id,
            title: 'Yangi ehtiyot qism qaytarish so\'rovi',
            message: `${req.user!.fullName} ehtiyot qism qaytarishni so\'radi. Sabab: ${reason.trim()}`,
            type: 'warning',
            link: '/maintenance?tab=returns',
          })),
        })
      }
    } catch {}

    res.status(201).json(successResponse(created, 'Qaytarish so\'rovi yuborildi. Admin tasdiqlashi kutilmoqda.'))
  } catch (err) { next(err) }
}

// ─── Admin: Kutayotganlar ro'yxati ────────────────────────────────────────────

export async function getPendingReturns(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const where: any = { status: 'pending_approval' }
    if (filter.type === 'single') where.branchId = filter.branchId
    else if (filter.type === 'org') where.branchId = { in: filter.orgBranchIds }

    const records = await prisma.sparePartReturn.findMany({
      where,
      include: {
        items: { include: { sparePart: { select: { id: true, name: true, partCode: true } } } },
        evidence: true,
        returnedBy: { select: { id: true, fullName: true } },
        maintenance: {
          select: {
            id: true, installationDate: true,
            vehicle: { select: { registrationNumber: true, brand: true, model: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json({ success: true, data: records, meta: { count: records.length } })
  } catch (err) { next(err) }
}

// ─── Admin: Tasdiqlash ────────────────────────────────────────────────────────

export async function approveReturn(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ret = await prisma.sparePartReturn.findUnique({
      where: { id: req.params.id },
      include: { items: true, evidence: true },
    })
    if (!ret) throw new AppError('Qaytarish yozuvi topilmadi', 404)
    if ((ret as any).status !== 'pending_approval') throw new AppError('Bu yozuv allaqachon ko\'rib chiqilgan', 400)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, (ret as any).branchId)) throw new AppError('Kirish huquqi yo\'q', 403)

    // Require at least one evidence photo
    if (ret.evidence.length === 0) {
      throw new AppError('Tasdiqlash uchun kamida 1 ta foto-otchet bo\'lishi shart', 400)
    }

    await prisma.$transaction(async (tx) => {
      // Race-safe status transition: updateMany with status in WHERE prevents double-approve.
      const transition = await tx.sparePartReturn.updateMany({
        where: { id: req.params.id, status: 'pending_approval' },
        data: { status: 'approved', approvedById: req.user!.id, approvedAt: new Date() },
      })
      if (transition.count === 0) {
        throw new AppError('Bu yozuv allaqachon ko\'rib chiqilgan', 400)
      }

      // Restore inventory for each item (safe — only one transaction reaches this point)
      for (const item of ret.items) {
        await tx.inventory.upsert({
          where: { sparePartId_warehouseId: { sparePartId: item.sparePartId, warehouseId: item.warehouseId } },
          update: { quantityOnHand: { increment: item.quantity } },
          create: {
            sparePartId: item.sparePartId,
            warehouseId: item.warehouseId,
            quantityOnHand: item.quantity,
          },
        })
      }

      // Notify creator
      await tx.notification.create({
        data: {
          userId: (ret as any).returnedById,
          title: 'Qaytarish tasdiqlandi',
          message: `${req.user!.fullName} ehtiyot qism qaytarishingizni tasdiqladi. Ombor miqdori tiklandi.`,
          type: 'success',
          link: '/maintenance',
        },
      })
    })

    res.json(successResponse(null, 'Qaytarish tasdiqlandi, ombor tiklandi'))
  } catch (err) { next(err) }
}

// ─── Admin: Rad etish ─────────────────────────────────────────────────────────

export async function rejectReturn(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reason } = req.body
    if (!reason?.trim()) throw new AppError('Rad etish sababi kiritilishi shart', 400)

    const ret = await prisma.sparePartReturn.findUnique({
      where: { id: req.params.id },
      select: { status: true, returnedById: true, branchId: true },
    })
    if (!ret) throw new AppError('Qaytarish yozuvi topilmadi', 404)
    if ((ret as any).status !== 'pending_approval') throw new AppError('Bu yozuv allaqachon ko\'rib chiqilgan', 400)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, (ret as any).branchId)) throw new AppError('Kirish huquqi yo\'q', 403)

    await prisma.$transaction(async (tx) => {
      const transition = await tx.sparePartReturn.updateMany({
        where: { id: req.params.id, status: 'pending_approval' },
        data: { status: 'rejected', approvedById: req.user!.id, approvedAt: new Date(), rejectedReason: reason.trim() },
      })
      if (transition.count === 0) {
        throw new AppError('Bu yozuv allaqachon ko\'rib chiqilgan', 400)
      }

      await tx.notification.create({
        data: {
          userId: (ret as any).returnedById,
          title: 'Qaytarish rad etildi',
          message: `${req.user!.fullName} ehtiyot qism qaytarishingizni rad etdi. Sabab: ${reason.trim()}`,
          type: 'error',
          link: '/maintenance',
        },
      })
    })

    res.json(successResponse(null, 'Rad etildi'))
  } catch (err) { next(err) }
}

// ─── Foto yuklash ─────────────────────────────────────────────────────────────

export async function uploadReturnEvidence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ret = await prisma.sparePartReturn.findUnique({
      where: { id: req.params.id },
      select: { id: true, returnedById: true, branchId: true, status: true },
    })
    if (!ret) throw new AppError('Qaytarish yozuvi topilmadi', 404)
    if ((ret as any).status === 'approved') throw new AppError('Tasdiqlangan yozuvga rasm qo\'shib bo\'lmaydi', 400)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, (ret as any).branchId)) throw new AppError('Kirish huquqi yo\'q', 403)

    const files: Array<{ url: string; size: number }> = (req as any).compressedFiles || []
    if (files.length === 0) throw new AppError('Fayl yuklanmadi', 400)

    const existing = await prisma.sparePartReturnEvidence.count({ where: { returnId: ret.id } })
    if (existing + files.length > 5) throw new AppError(`Maksimal 5 ta rasm. Hozir ${existing} ta bor.`, 400)

    await prisma.sparePartReturnEvidence.createMany({
      data: files.map(f => ({
        returnId: ret.id,
        fileUrl: f.url,
        fileSizeBytes: f.size,
        uploadedById: req.user!.id,
      })),
    })

    res.status(201).json(successResponse(null, `${files.length} ta rasm yuklandi`))
  } catch (err) { next(err) }
}

// ─── Qaytarish ro'yxati (filial) ──────────────────────────────────────────────

export async function getMyReturns(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const where: any = {}
    if (filter.type === 'single') where.branchId = filter.branchId
    else if (filter.type === 'org') where.branchId = { in: filter.orgBranchIds }

    const records = await prisma.sparePartReturn.findMany({
      where,
      include: {
        items: { include: { sparePart: { select: { name: true, partCode: true } } } },
        evidence: true,
        returnedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
        maintenance: {
          select: {
            id: true, installationDate: true,
            vehicle: { select: { registrationNumber: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    res.json(successResponse(records))
  } catch (err) { next(err) }
}

// ─── Maintenance yozuvidan qaytarish mumkin bo'lgan qismlar ──────────────────

export async function getReturnableItems(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const maint = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.maintenanceId },
      include: {
        items: { include: { sparePart: { select: { id: true, name: true, partCode: true, unitPrice: true } } } },
        returns: { where: { status: { not: 'rejected' } }, include: { items: true } },
        vehicle: { select: { branchId: true } },
      },
    })
    if (!maint) throw new AppError('Ta\'mirlash yozuvi topilmadi', 404)
    if ((maint as any).status !== 'approved') throw new AppError('Faqat tasdiqlangan ta\'mirlash yozuvidan qaytarish mumkin', 400)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, maint.vehicle.branchId)) throw new AppError('Kirish huquqi yo\'q', 403)

    // Already returned (non-rejected)
    const alreadyReturned: Record<string, number> = {}
    for (const ret of (maint as any).returns) {
      for (const ri of ret.items) {
        alreadyReturned[ri.sparePartId] = (alreadyReturned[ri.sparePartId] || 0) + ri.quantity
      }
    }

    const result = maint.items
      .map(mi => ({
        sparePartId: mi.sparePartId,
        name: mi.sparePart.name,
        partCode: mi.sparePart.partCode,
        originalQty: mi.quantityUsed,
        returnedQty: alreadyReturned[mi.sparePartId] || 0,
        canReturnQty: mi.quantityUsed - (alreadyReturned[mi.sparePartId] || 0),
        unitCost: Number(mi.unitCost),
        warehouseId: mi.warehouseId,
      }))
      .filter(i => i.canReturnQty > 0)

    res.json(successResponse(result))
  } catch (err) { next(err) }
}
