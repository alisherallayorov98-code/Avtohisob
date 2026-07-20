import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { nextReceiptNum } from './receipts'
import { computeChargeStatus } from '../lib/chargeMath'

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
            status: computeChargeStatus(existingCharge.expectedAmount, paidAmount),
          },
        })
      } else if (entity.billingMode === 'monthly_fixed' && entity.monthlyFee > 0) {
        await (prisma as any).ekoHisobCharge.create({
          data: {
            entityId,
            month: String(month),
            expectedAmount: entity.monthlyFee,
            paidAmount: parsedAmount,
            status: computeChargeStatus(entity.monthlyFee, parsedAmount),
          },
        })
      }

      // Kvitansiya raqami — atomik ketma-ket (orgId bo'yicha, yillik)
      let receiptNumber: string | null = null
      try {
        receiptNumber = await nextReceiptNum(orgId)
        await (prisma as any).ekoHisobReceipt.create({
          data: {
            receiptNumber,
            orgId,
            entityId,
            paymentId: payment.id,
            month: String(month),
            amount: parsedAmount,
            issuedBy: userId,
          },
        })
      } catch (receiptErr: any) {
        console.warn('EkoHisob: kvitansiya yaratishda xato (to\'lov saqlanadi):', receiptErr?.message)
        receiptNumber = null
      }

      // Qisman to'lov holatini javobga qo'shamiz (frontend progress uchun)
      let chargeInfo: { expectedAmount: number; paidAmount: number; remaining: number; status: string } | null = null
      const ch = await (prisma as any).ekoHisobCharge.findUnique({
        where: { entityId_month: { entityId, month: String(month) } },
      })
      if (ch) {
        chargeInfo = {
          expectedAmount: ch.expectedAmount,
          paidAmount: ch.paidAmount,
          remaining: Math.max(0, ch.expectedAmount - ch.paidAmount),
          status: ch.status,
        }
      }

      res.status(201).json({ success: true, data: { ...payment, receiptNumber, charge: chargeInfo } })
    } catch (e: any) {
      throw e
    }
  } catch (err) { next(err) }
}

/**
 * GET /payments/charge-status?entityId=&month=
 * Tanlangan oy uchun: kutilgan summa, to'langan, qolgan qarz.
 * Qisman to'lov modali uchun.
 */
export async function getChargeStatus(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { entityId, month } = req.query
    if (!entityId || !month) {
      res.status(400).json({ success: false, error: 'entityId va month talab qilinadi' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: String(entityId) } })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const charge = await (prisma as any).ekoHisobCharge.findUnique({
      where: { entityId_month: { entityId: String(entityId), month: String(month) } },
    })

    // Shu oy uchun barcha to'lovlar (tarix)
    const payments = await (prisma as any).ekoHisobPayment.findMany({
      where: { entityId: String(entityId), month: String(month) },
      include: { receiver: { select: { fullName: true } } },
      orderBy: { paidAt: 'asc' },
    })

    const expectedAmount = charge?.expectedAmount ?? entity.monthlyFee ?? 0
    const paidAmount = charge?.paidAmount ?? payments.reduce((s: number, p: any) => s + p.amount, 0)
    const remaining = Math.max(0, expectedAmount - paidAmount)

    res.json({
      success: true,
      data: {
        expectedAmount,
        paidAmount,
        remaining,
        status: charge?.status ?? (paidAmount > 0 ? (remaining > 0 ? 'partial' : 'paid') : 'open'),
        billingMode: entity.billingMode,
        payments: payments.map((p: any) => ({
          id: p.id, amount: p.amount, paidAt: p.paidAt,
          note: p.note, receiver: p.receiver?.fullName,
        })),
      },
    })
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
