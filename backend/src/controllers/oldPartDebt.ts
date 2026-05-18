import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'

// ─── Helper: maintenance tasdiqlanganida avtomatik chaqiriladi ────────────────

export async function createDebtsForMaintenance(
  maintenanceId: string,
  tx: any
) {
  const maint = await tx.maintenanceRecord.findUnique({
    where: { id: maintenanceId },
    include: {
      vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true } },
      performedBy: { select: { id: true, fullName: true } },
      items: { include: { sparePart: { select: { id: true, name: true } } } },
      sparePart: { select: { id: true, name: true } },
    },
  })
  if (!maint) return

  const vehicleLabel = `${maint.vehicle.registrationNumber} — ${maint.vehicle.brand} ${maint.vehicle.model}`
  const branchId = maint.vehicle.branchId

  const parts: Array<{ sparePartId: string; sparePartName: string; quantity: number }> = []

  if (maint.items.length > 0) {
    for (const item of maint.items) {
      parts.push({
        sparePartId: item.sparePartId,
        sparePartName: item.sparePart.name,
        quantity: item.quantityUsed,
      })
    }
  } else if (maint.sparePart && maint.quantityUsed > 0) {
    parts.push({
      sparePartId: maint.sparePart.id,
      sparePartName: maint.sparePart.name,
      quantity: maint.quantityUsed,
    })
  }

  if (parts.length === 0) return

  await tx.oldPartDebt.createMany({
    data: parts.map(p => ({
      maintenanceId,
      vehicleId: maint.vehicle.id,
      vehicleLabel,
      workerId: maint.performedBy.id,
      workerName: maint.performedBy.fullName,
      branchId,
      sparePartId: p.sparePartId,
      sparePartName: p.sparePartName,
      quantity: p.quantity,
      status: 'open',
    })),
  })
}

// ─── Worker: o'z qarzlarini ko'rish ──────────────────────────────────────────

export async function getMyDebts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const debts = await prisma.oldPartDebt.findMany({
      where: { workerId: req.user!.id },
      include: { evidence: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(successResponse(debts))
  } catch (err) { next(err) }
}

// ─── Admin: tashkilot bo'yicha qarzlar ────────────────────────────────────────

export async function listDebts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status } = req.query as any
    const filter = await getOrgFilter(req.user!)

    const where: any = {}
    if (status) where.status = status
    if (filter.type === 'single') where.branchId = filter.branchId
    else if (filter.type === 'org') where.branchId = { in: filter.orgBranchIds }

    const debts = await prisma.oldPartDebt.findMany({
      where,
      include: {
        evidence: true,
        worker: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(successResponse(debts))
  } catch (err) { next(err) }
}

// ─── Worker: qarzni topshirish (foto yoki jismoniy) ──────────────────────────

export async function submitDebt(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { deliveryMethod, submissionNote } = req.body
    if (!['photo', 'physical'].includes(deliveryMethod)) {
      throw new AppError('deliveryMethod: "photo" yoki "physical" bo\'lishi kerak', 400)
    }

    const debt = await prisma.oldPartDebt.findUnique({ where: { id: req.params.id } })
    if (!debt) throw new AppError('Qarz topilmadi', 404)
    if (debt.workerId !== req.user!.id) throw new AppError('Bu sizning qarzingiz emas', 403)
    if (debt.status !== 'open') throw new AppError('Bu qarz allaqachon yuborilgan yoki yechilgan', 400)

    await prisma.oldPartDebt.update({
      where: { id: req.params.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        deliveryMethod,
        submissionNote: submissionNote?.trim() || null,
      },
    })

    // Admin ga xabar
    try {
      const admins = await prisma.user.findMany({
        where: { branchId: debt.branchId, isActive: true, role: { in: ['admin', 'super_admin'] } },
        select: { id: true },
      })
      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((a: any) => ({
            userId: a.id,
            title: 'Eski qism topshirildi',
            message: `${req.user!.fullName} "${debt.sparePartName}" eski qismini topshirdi (${debt.vehicleLabel}). Tasdiqlanishi kerak.`,
            type: 'warning',
            link: '/maintenance?tab=old-parts',
          })),
        })
      }
    } catch {}

    res.json(successResponse(null, 'Topshirish so\'rovi yuborildi. Admin tasdiqlashi kutilmoqda.'))
  } catch (err) { next(err) }
}

// ─── Worker: foto yuklash ─────────────────────────────────────────────────────

export async function uploadDebtEvidence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const debt = await prisma.oldPartDebt.findUnique({ where: { id: req.params.id } })
    if (!debt) throw new AppError('Qarz topilmadi', 404)
    if (debt.workerId !== req.user!.id && !['admin', 'super_admin'].includes(req.user!.role)) {
      throw new AppError('Kirish huquqi yo\'q', 403)
    }
    if (debt.status === 'cleared') throw new AppError('Yechilgan qarzga rasm qo\'shib bo\'lmaydi', 400)

    const files: Array<{ url: string; size: number }> = (req as any).compressedFiles || []
    if (files.length === 0) throw new AppError('Fayl yuklanmadi', 400)

    const existing = await prisma.oldPartDebtEvidence.count({ where: { debtId: debt.id } })
    if (existing + files.length > 5) throw new AppError(`Maksimal 5 ta rasm. Hozir ${existing} ta bor.`, 400)

    await prisma.oldPartDebtEvidence.createMany({
      data: files.map(f => ({
        debtId: debt.id,
        fileUrl: f.url,
        fileSizeBytes: f.size,
        uploadedById: req.user!.id,
      })),
    })

    res.status(201).json(successResponse(null, `${files.length} ta rasm yuklandi`))
  } catch (err) { next(err) }
}

// ─── Admin: tasdiqlash ────────────────────────────────────────────────────────

export async function approveDebt(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const debt = await prisma.oldPartDebt.findUnique({
      where: { id: req.params.id },
      include: { evidence: true },
    })
    if (!debt) throw new AppError('Qarz topilmadi', 404)
    if (debt.status !== 'submitted') throw new AppError('Faqat "topshirilgan" qarzni tasdiqlash mumkin', 400)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, debt.branchId)) throw new AppError('Kirish huquqi yo\'q', 403)

    if (debt.deliveryMethod === 'photo' && debt.evidence.length === 0) {
      throw new AppError('Foto-otchet yuborilmagan. Tasdiqlash mumkin emas.', 400)
    }

    await prisma.$transaction(async (tx) => {
      const transition = await tx.oldPartDebt.updateMany({
        where: { id: req.params.id, status: 'submitted' },
        data: { status: 'cleared', approvedAt: new Date(), approvedById: req.user!.id },
      })
      if (transition.count === 0) throw new AppError('Allaqachon ko\'rib chiqilgan', 400)

      await tx.notification.create({
        data: {
          userId: debt.workerId,
          title: 'Eski qism qarzi yechildi',
          message: `${req.user!.fullName} "${debt.sparePartName}" eski qismini qabul qildi (${debt.vehicleLabel}). Qarz yechildi.`,
          type: 'success',
          link: '/maintenance?tab=old-parts',
        },
      })
    })

    res.json(successResponse(null, 'Qarz yechildi'))
  } catch (err) { next(err) }
}

// ─── Admin: rad etish (xodim qaytadan topshirishi kerak) ─────────────────────

export async function rejectDebt(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reason } = req.body
    if (!reason?.trim()) throw new AppError('Rad etish sababi kiritilishi shart', 400)

    const debt = await prisma.oldPartDebt.findUnique({ where: { id: req.params.id } })
    if (!debt) throw new AppError('Qarz topilmadi', 404)
    if (debt.status !== 'submitted') throw new AppError('Faqat "topshirilgan" qarzni rad etish mumkin', 400)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, debt.branchId)) throw new AppError('Kirish huquqi yo\'q', 403)

    await prisma.$transaction(async (tx) => {
      const transition = await tx.oldPartDebt.updateMany({
        where: { id: req.params.id, status: 'submitted' },
        data: {
          status: 'open',
          rejectedReason: reason.trim(),
          submittedAt: null,
          deliveryMethod: null,
          submissionNote: null,
        },
      })
      if (transition.count === 0) throw new AppError('Allaqachon ko\'rib chiqilgan', 400)

      await tx.notification.create({
        data: {
          userId: debt.workerId,
          title: 'Eski qism rad etildi',
          message: `${req.user!.fullName} "${debt.sparePartName}" topshirishni rad etdi. Sabab: ${reason.trim()}. Qaytadan topshiring.`,
          type: 'error',
          link: '/maintenance?tab=old-parts',
        },
      })
    })

    res.json(successResponse(null, 'Rad etildi. Xodimga qaytadan topshirish kerak.'))
  } catch (err) { next(err) }
}
