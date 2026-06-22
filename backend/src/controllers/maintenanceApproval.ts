import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed, resolveOrgId } from '../lib/orgFilter'
import { getEffectiveWarehouseId } from '../lib/warehouse'
import {
  checkFrequentMaintenance,
  checkPartPriceAnomaly,
  checkWorkerRepeatOnVehicle,
  checkWorkerHighVolume,
} from '../lib/smartAlerts'
import { createDebtsForMaintenance } from './oldPartDebt'
import { detectServiceTypes, recordServicedTypes } from '../lib/serviceStatus'

// Tashkilot doirasidagi kategoriyani topadi yoki yaratadi.
// Eski global (organizationId=null) kategoriya org'larga tegmaydi —
// har tashkilot o'zining nusxasini oladi, bu cross-tenant ulanishning oldini oladi.
async function getOrCreateCategory(name: string, orgId: string | null) {
  const where: any = orgId ? { name, organizationId: orgId } : { name, organizationId: null }
  let cat = await prisma.expenseCategory.findFirst({ where })
  if (!cat) {
    cat = await prisma.expenseCategory.create({
      data: { name, description: name, organizationId: orgId } as any,
    })
  }
  return cat.id
}

export async function getPendingMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const where: any = { status: 'pending_approval' }
    if (filter.type === 'single') where.vehicle = { branchId: filter.branchId }
    else if (filter.type === 'org') where.vehicle = { branchId: { in: filter.orgBranchIds } }
    // type === 'none' → super_admin sees all

    const records = await prisma.maintenanceRecord.findMany({
      where,
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true } },
        sparePart: { select: { id: true, name: true, partCode: true } },
        performedBy: { select: { id: true, fullName: true } },
        items: {
          include: {
            sparePart: { select: { id: true, name: true, partCode: true } },
            warehouse: { select: { id: true, name: true } },
          },
        },
        evidence: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const count = records.length
    res.json({ success: true, data: records, meta: { count } })
  } catch (err) { next(err) }
}

export async function approveMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      include: {
        vehicle: { select: { id: true, branchId: true, mileage: true } },
        items: { include: { sparePart: { select: { name: true } } } },
      },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)
    if ((record as any).status !== 'pending_approval') {
      throw new AppError('Bu rekord allaqachon ko\'rib chiqilgan', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const totalCost = Number(record.cost) + Number(record.laborCost)
    const orgIdForCategory = await resolveOrgId(req.user!)
    const expenseCategoryId = totalCost > 0 ? await getOrCreateCategory('Texnik xizmat', orgIdForCategory) : null

    const updated = await prisma.$transaction(async (tx) => {
      // Race-safe status transition: updateMany with status in WHERE is atomic.
      // If another concurrent request already approved/rejected this record,
      // count === 0 and we roll back the whole transaction — no double-deduction.
      const transition = await tx.maintenanceRecord.updateMany({
        where: { id: req.params.id, status: 'pending_approval' },
        data: { status: 'approved', approvedById: req.user!.id, approvedAt: new Date() },
      })
      if (transition.count === 0) {
        throw new AppError('Bu rekord allaqachon ko\'rib chiqilgan', 400)
      }

      // Deduct inventory now (safe — only one transaction reaches this point)
      if (record.items.length > 0) {
        for (const item of record.items) {
          if (!item.warehouseId || item.quantityUsed <= 0) continue
          const inv = await tx.inventory.findFirst({
            where: { sparePartId: item.sparePartId, warehouseId: item.warehouseId },
          })
          if (inv && inv.quantityOnHand < item.quantityUsed) {
            const sp = await tx.sparePart.findUnique({ where: { id: item.sparePartId }, select: { name: true } })
            throw new AppError(`"${sp?.name}" uchun omborda faqat ${inv.quantityOnHand} ta mavjud`, 400)
          }
          await tx.inventory.updateMany({
            where: { sparePartId: item.sparePartId, warehouseId: item.warehouseId },
            data: { quantityOnHand: { decrement: item.quantityUsed } },
          })
        }
      } else if (record.sparePartId && record.quantityUsed > 0) {
        const warehouseId = record.sourceWarehouseId || await getEffectiveWarehouseId(record.vehicle.branchId)
        if (warehouseId) {
          await tx.inventory.updateMany({
            where: { sparePartId: record.sparePartId, warehouseId },
            data: { quantityOnHand: { decrement: record.quantityUsed } },
          })
        }
      }

      // Create expense
      if (totalCost > 0 && expenseCategoryId) {
        await tx.expense.create({
          data: {
            vehicleId: record.vehicleId,
            amount: totalCost,
            description: 'Texnik xizmat',
            expenseDate: record.installationDate,
            createdById: req.user!.id,
            categoryId: expenseCategoryId,
          },
        })
      }

      // Notify creator
      await tx.notification.create({
        data: {
          userId: record.performedById,
          title: 'Ta\'mirlash tasdiqlandi',
          message: `${req.user!.fullName} sizning ta\'mirlash yozuvingizni tasdiqladi va ehtiyot qism hisobdan chiqarildi.`,
          type: 'success',
          link: `/maintenance`,
        },
      })

      // Eski qism qarzi — har bir o'rnatilgan qism uchun avtomatik yaratiladi
      await createDebtsForMaintenance(req.params.id, tx)

      return tx.maintenanceRecord.findUnique({
        where: { id: req.params.id },
        include: {
          vehicle: true,
          items: { include: { sparePart: { select: { id: true, name: true } } } },
          performedBy: { select: { fullName: true } },
          approvedBy: { select: { fullName: true } },
        },
      })
    })

    // Smart alerts — non-blocking
    const date = record.installationDate
    const uniquePartIds = [...new Set(record.items.map((i: any) => i.sparePartId))]
    checkFrequentMaintenance(record.id, record.vehicleId, record.vehicle.branchId, date).catch(() => {})
    checkPartPriceAnomaly(record.vehicle.branchId, record.items.map((i: any) => ({ sparePartId: i.sparePartId, unitCost: Number(i.unitCost) }))).catch(() => {})
    checkWorkerRepeatOnVehicle(record.id, record.vehicleId, record.vehicle.branchId, record.workerName, date).catch(() => {})
    checkWorkerHighVolume(record.id, record.vehicle.branchId, record.workerName, date).catch(() => {})
    // (Ombor minimumi alerti foydalanuvchi iltimosi bilan o'chirildi)

    // Yog'/filtr ta'mirlanган bo'lsa — tegishli xizmat intervalini avtomatik yangilaymiz
    const partNames = record.items.map((i: any) => i.sparePart?.name)
    const serviceTypes = detectServiceTypes({
      isOil: (record as any).isOil,
      oilLiters: (record as any).oilLiters,
      notes: (record as any).notes,
      partNames,
    })
    await recordServicedTypes(record.vehicleId, serviceTypes, Number(record.vehicle.mileage) || 0, record.installationDate, req.user!.id)
      .catch(e => console.error('[maintenanceApproval] xizmat intervali yangilash xatosi:', e?.message))

    res.json(successResponse(updated, 'Tasdiqlandi va ehtiyot qism hisobdan chiqarildi'))
  } catch (err) { next(err) }
}

export async function rejectMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reason } = req.body
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { status: true, performedById: true, vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)
    if ((record as any).status !== 'pending_approval') {
      throw new AppError('Bu rekord allaqachon ko\'rib chiqilgan', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Race-safe transition: only rejects if still pending
      const transition = await tx.maintenanceRecord.updateMany({
        where: { id: req.params.id, status: 'pending_approval' },
        data: { status: 'rejected', approvedById: req.user!.id, approvedAt: new Date(), rejectedReason: reason || null },
      })
      if (transition.count === 0) {
        throw new AppError('Bu rekord allaqachon ko\'rib chiqilgan', 400)
      }

      await tx.notification.create({
        data: {
          userId: record.performedById,
          title: 'Ta\'mirlash rad etildi',
          message: `${req.user!.fullName} sizning ta\'mirlash yozuvingizni rad etdi.${reason ? ' Sabab: ' + reason : ''}`,
          type: 'error',
          link: `/maintenance`,
        },
      })

      return tx.maintenanceRecord.findUnique({ where: { id: req.params.id } })
    })

    res.json(successResponse(updated, 'Rad etildi'))
  } catch (err) { next(err) }
}

// Xodim o'z xatosini o'zi tuzatishi uchun: kutilayotgan (pending_approval) yozuvini
// admin ko'rib chiqmasidan oldin o'zi qaytarib oladi. "Admin rad etdi" emas — alohida holat.
export async function withdrawMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { status: true, performedById: true, vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)

    // Faqat yozuvni yaratgan xodimning o'zi qaytarib olishi mumkin
    if (record.performedById !== req.user!.id) {
      throw new AppError('Faqat yozuvni yaratgan xodim qaytarib olishi mumkin', 403)
    }
    if ((record as any).status !== 'pending_approval') {
      throw new AppError('Faqat kutilayotgan yozuvni qaytarib olish mumkin', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    // Race-safe: faqat hali pending bo'lsa qaytarib oladi (admin ayni paytda tasdiqlab/rad etib yuborgan bo'lishi mumkin)
    const transition = await prisma.maintenanceRecord.updateMany({
      where: { id: req.params.id, status: 'pending_approval', performedById: req.user!.id },
      data: { status: 'withdrawn' },
    })
    if (transition.count === 0) {
      throw new AppError('Yozuv allaqachon ko\'rib chiqilgan, qaytarib bo\'lmaydi', 400)
    }

    const updated = await prisma.maintenanceRecord.findUnique({ where: { id: req.params.id } })
    res.json(successResponse(updated, 'Yozuv qaytarib olindi. Tuzatib qayta yuborishingiz mumkin.'))
  } catch (err) { next(err) }
}

// Qaytarib olingan yozuvni tuzatgandan keyin yana adminga yuboradi.
export async function resubmitMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { status: true, performedById: true, vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)

    if (record.performedById !== req.user!.id) {
      throw new AppError('Faqat yozuvni yaratgan xodim qayta yuborishi mumkin', 403)
    }
    if ((record as any).status !== 'withdrawn') {
      throw new AppError('Faqat qaytarib olingan yozuvni qayta yuborish mumkin', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const transition = await prisma.maintenanceRecord.updateMany({
      where: { id: req.params.id, status: 'withdrawn', performedById: req.user!.id },
      data: { status: 'pending_approval' },
    })
    if (transition.count === 0) {
      throw new AppError('Yozuv holati o\'zgargan, qayta yuborib bo\'lmaydi', 400)
    }

    const updated = await prisma.maintenanceRecord.findUnique({ where: { id: req.params.id } })
    res.json(successResponse(updated, 'Yozuv qayta yuborildi'))
  } catch (err) { next(err) }
}

export async function uploadEvidence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { id: true, performedById: true, status: true, vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)

    const isAdmin = ['admin', 'super_admin'].includes(req.user!.role)

    // Security: only the creator or admin can upload evidence
    if (!isAdmin && record.performedById !== req.user!.id) {
      throw new AppError('Faqat yozuvni yaratgan xodim yoki admin rasm yuklashi mumkin', 403)
    }
    // Security: cannot upload evidence to already approved or rejected records.
    // 'withdrawn' (xodim o'zi qaytarib olgan) ham tahrirlash mumkin — xato rasmni almashtirish uchun.
    if (!['pending_approval', 'withdrawn'].includes((record as any).status) && !isAdmin) {
      throw new AppError('Faqat kutayotgan yoki qaytarib olingan yozuvlarga rasm yuklash mumkin', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const files: Array<{ url: string; size: number }> = (req as any).compressedFiles || []
    if (files.length === 0) throw new AppError('Fayl yuklanmadi', 400)

    const existing = await prisma.maintenanceEvidence.count({ where: { maintenanceId: record.id } })
    if (existing + files.length > 3) {
      throw new AppError(`Maksimal 3 ta rasm ruxsat etiladi. Hozir ${existing} ta bor.`, 400)
    }

    const created = await prisma.maintenanceEvidence.createMany({
      data: files.map(f => ({
        maintenanceId: record.id,
        fileUrl: f.url,
        fileSizeBytes: f.size,
        uploadedById: req.user!.id,
      })),
    })

    res.status(201).json(successResponse(created, `${files.length} ta rasm yuklandi`))
  } catch (err) { next(err) }
}

export async function getEvidence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const evidence = await prisma.maintenanceEvidence.findMany({
      where: { maintenanceId: req.params.id },
      orderBy: { createdAt: 'asc' },
    })

    res.json(successResponse(evidence))
  } catch (err) { next(err) }
}

export async function deleteEvidence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { evidenceId } = req.params
    const ev = await prisma.maintenanceEvidence.findUnique({
      where: { id: evidenceId },
      include: { maintenance: { select: { status: true, vehicle: { select: { branchId: true } } } } },
    })
    if (!ev) throw new AppError('Rasm topilmadi', 404)
    if ((ev.maintenance as any).status === 'approved') {
      throw new AppError('Tasdiqlangan yozuvdan rasm o\'chirib bo\'lmaydi', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, ev.maintenance.vehicle.branchId)) {
      throw new AppError('Kirish huquqi yo\'q', 403)
    }

    await prisma.maintenanceEvidence.delete({ where: { id: evidenceId } })

    // Delete physical file
    try {
      const fs = await import('fs')
      const path = await import('path')
      const filePath = path.join(process.cwd(), ev.fileUrl)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {}

    res.json(successResponse(null, 'Rasm o\'chirildi'))
  } catch (err) { next(err) }
}
