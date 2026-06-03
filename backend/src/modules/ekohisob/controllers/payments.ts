import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

export async function listPayments(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { entityId, month, districtId } = req.query

    const where: any = {}

    if (entityId) {
      // Verify entity belongs to org
      const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: String(entityId) } })
      if (!entity || entity.orgId !== orgId) {
        res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
        return
      }
      if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      where.entityId = String(entityId)
    } else {
      // Filter by org through entities
      const entityWhere: any = { orgId }
      if (role === 'inspector') {
        entityWhere.districtId = { in: districtIds }
      }
      if (districtId) {
        if (role === 'inspector' && !districtIds.includes(String(districtId))) {
          res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
          return
        }
        entityWhere.districtId = String(districtId)
      }
      const orgEntities = await (prisma as any).ekoHisobLegalEntity.findMany({
        where: entityWhere,
        select: { id: true },
      })
      where.entityId = { in: orgEntities.map((e: any) => e.id) }
    }

    if (month) {
      where.month = String(month)
    }

    const payments = await (prisma as any).ekoHisobPayment.findMany({
      where,
      include: {
        entity: { select: { id: true, name: true, districtId: true } },
        receiver: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
    })

    res.json({ success: true, data: payments })
  } catch (err) { next(err) }
}

export async function recordPayment(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId, role, districtIds } = req.ekoUser!
    const { entityId, month, amount, note } = req.body

    if (!entityId || !month || amount === undefined) {
      res.status(400).json({ success: false, error: 'entityId, month va amount talab qilinadi' })
      return
    }

    // Validate month format: "2026-01"
    if (!/^\d{4}-\d{2}$/.test(String(month))) {
      res.status(400).json({ success: false, error: 'month formati: "YYYY-MM" (masalan: 2026-01)' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: entityId } })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }
    if (entity.status === 'inactive') {
      res.status(400).json({ success: false, error: 'Deaktiv tashkilotga to\'lov qilish mumkin emas' })
      return
    }

    const parsedAmount = parseInt(String(amount))
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ success: false, error: 'amount musbat son bo\'lishi kerak' })
      return
    }

    try {
      const payment = await (prisma as any).ekoHisobPayment.create({
        data: {
          entityId,
          month: String(month),
          amount: parsedAmount,
          receivedBy: userId,
          note: note ? String(note).trim() : null,
        },
        include: {
          entity: { select: { id: true, name: true } },
          receiver: { select: { id: true, fullName: true } },
        },
      })

      // monthly_fixed tashkilotda shu oy uchun hisob (charge) bo'lsa — uni hisob-kitob qilamiz.
      // Charge mavjud bo'lsa: paidAmount += to'lov, status paid/partial. Mavjud bo'lmasa va
      // tashkilot fixed bo'lsa — charge yaratamiz (qarz to'g'ri ko'rinishi uchun).
      const existingCharge = await (prisma as any).ekoHisobCharge.findUnique({
        where: { entityId_month: { entityId, month: String(month) } },
      })
      if (existingCharge) {
        const paidAmount = existingCharge.paidAmount + parsedAmount
        await (prisma as any).ekoHisobCharge.update({
          where: { id: existingCharge.id },
          data: {
            paidAmount,
            status: paidAmount >= existingCharge.expectedAmount ? 'paid' : 'partial',
          },
        })
      } else if (entity.billingMode === 'monthly_fixed' && entity.monthlyFee > 0) {
        await (prisma as any).ekoHisobCharge.create({
          data: {
            entityId,
            month: String(month),
            expectedAmount: entity.monthlyFee,
            paidAmount: parsedAmount,
            status: parsedAmount >= entity.monthlyFee ? 'paid' : 'partial',
          },
        })
      }

      res.status(201).json({ success: true, data: payment })
    } catch (e: any) {
      if (e?.code === 'P2002') {
        res.status(409).json({ success: false, error: 'Bu tashkilot ushbu oy uchun allaqachon to\'lagan' })
        return
      }
      throw e
    }
  } catch (err) { next(err) }
}

export async function deletePayment(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params

    const payment = await (prisma as any).ekoHisobPayment.findUnique({
      where: { id },
      include: { entity: { select: { orgId: true } } },
    })

    if (!payment || payment.entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'To\'lov topilmadi' })
      return
    }

    await (prisma as any).ekoHisobPayment.delete({ where: { id } })
    res.json({ success: true, data: null, message: 'To\'lov o\'chirildi' })
  } catch (err) { next(err) }
}
