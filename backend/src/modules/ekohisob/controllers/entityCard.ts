import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { computeEntityDebt, sumPaymentsByMonth } from '../lib/debtMath'
import { computeCompleteness } from '../lib/entityCompleteness'
import { getCurrentMonth } from '../lib/months'

/**
 * GET /entities/:id/card — tashkilot kartochkasi uchun BITTA javob:
 * asosiy ma'lumot + to'liqlik + qarz + oxirgi to'lovlar/talonlar/SMS.
 *
 * Qarz yagona kanonik funksiyadan (computeEntityDebt) olinadi — kartochkadagi
 * raqam ro'yxat va hisobotdagi bilan har doim bir xil.
 * Kirish: admin — hammasi; boshliq va inspektor — faqat o'z tumanlari.
 */
export async function getEntityCard(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params
    const currentMonth = getCurrentMonth()

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id },
      include: {
        district: { select: { id: true, name: true } },
        mahalla: { select: { id: true, name: true } },
        blacklist: { select: { id: true, status: true, reason: true, addedAt: true } },
        charges: {
          where: { status: { in: ['open', 'partial'] } },
          select: { month: true, expectedAmount: true, paidAmount: true },
        },
        talons: {
          where: { paid: false },
          select: { date: true, amount: true, paid: true },
        },
      },
    })

    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role !== 'admin' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const [payments, talons, smsLogs, monthPayments] = await Promise.all([
      (prisma as any).ekoHisobPayment.findMany({
        where: { entityId: id },
        orderBy: { paidAt: 'desc' },
        take: 8,
        select: {
          id: true, month: true, amount: true, paidAt: true, note: true,
          receiver: { select: { fullName: true } },
          receipt: { select: { id: true, receiptNumber: true } },
        },
      }),
      (prisma as any).ekoHisobTalon.findMany({
        where: { entityId: id },
        orderBy: { date: 'desc' },
        take: 5,
        select: { id: true, date: true, volume: true, amount: true, paid: true, note: true },
      }),
      (prisma as any).ekoHisobSmsLog.findMany({
        where: { orgId, entityId: id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, status: true, createdAt: true, message: true },
      }).catch(() => []),
      (prisma as any).ekoHisobPayment.findMany({
        where: { entityId: id, month: currentMonth },
        select: { month: true, amount: true },
      }),
    ])

    const debt = computeEntityDebt({
      billingMode: entity.billingMode,
      charges: entity.charges,
      talons: entity.talons,
      currentMonth,
      paidCurrentMonth: sumPaymentsByMonth(monthPayments).has(currentMonth),
    })

    const { charges: _c, talons: _t, ...base } = entity
    res.json({
      success: true,
      data: {
        entity: base,
        completeness: computeCompleteness(entity),
        debt: { ...debt, level: entity.debtLevel, currentMonth },
        payments,
        talons,
        smsLogs,
      },
    })
  } catch (err) { next(err) }
}
