// EkoHisob — oyma-oy hisobot.
//
// `reports.ts` davrning FAQAT oxirgi oyi bo'yicha kesim beradi (yig'im foizi,
// tuman, qarz), oylar bo'yicha esa faqat "qancha yig'ildi" grafigi bor edi.
// Buxgalteriya va rahbar yig'ilishi so'raydigan jadval — "har oy: kutilgan,
// yig'ilgan, foiz, qarz" — shu yerda. Alohida faylda: reports.ts shishmasin.

import { Prisma } from '@prisma/client'
import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { resolvePeriod } from './reports'
import { buildMonthlyReport, MonthAgg, MonthlyReport, monthOf } from '../lib/monthlyReport'

/** Oy chegaralari — "YYYY-MM" → [boshi, keyingi oy boshi) */
function monthBounds(month: string): { start: Date; end: Date } {
  const start = new Date(month + '-01T00:00:00.000Z')
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { start, end }
}

/**
 * Oylik hisobot ma'lumotlari (HTTP javobisiz).
 * JSON, Excel va chop etish — uchalasi shu yagona manbadan oladi, aks holda
 * ekrandagi raqam hujjatdagidan farq qiladi.
 */
export async function getMonthlyReportData(
  req: EkoRequest,
): Promise<MonthlyReport & { period: { from: string; to: string; months: number } }> {
  const { orgId, role, districtIds } = req.ekoUser!
  const { months } = resolvePeriod(req)

  const empty = {
    ...buildMonthlyReport(months, new Map()),
    period: { from: months[0], to: months[months.length - 1], months: months.length },
  }
  // Tuman biriktirilmagan inspektor — ko'radigan ma'lumoti yo'q.
  // (Bo'sh ro'yxatni filtrga qo'ysak `IN ()` SQL xatosi bo'lardi.)
  if (role !== 'admin' && districtIds.length === 0) return empty

  const entityWhere: any = { orgId }
  if (role !== 'admin') entityWhere.districtId = { in: districtIds }

  const first = monthBounds(months[0]).start
  const last = monthBounds(months[months.length - 1]).end

  const districtCond = role === 'admin'
    ? Prisma.empty
    : Prisma.sql`AND e."districtId" IN (${Prisma.join(districtIds)})`

  const [payGroups, chargeGroups, talonGroups, payerRows] = await Promise.all([
    // Kassaga tushgan summa va to'lov yozuvlari soni
    (prisma as any).ekoHisobPayment.groupBy({
      by: ['month'],
      where: { entity: entityWhere, month: { in: months } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // Hisoblangan va yopilgan summa
    (prisma as any).ekoHisobCharge.groupBy({
      by: ['month'],
      where: { entity: entityWhere, month: { in: months } },
      _sum: { expectedAmount: true, paidAmount: true },
    }),
    // Talon (bajarilgan ish) — sana bo'yicha, to'langan/to'lanmagan kesimida.
    // Sana bo'yicha guruhlash qatorlar sonini kun bilan cheklaydi (≤ 2×kun).
    (prisma as any).ekoHisobTalon.groupBy({
      by: ['date', 'paid'],
      where: { entity: entityWhere, date: { gte: first, lt: last } },
      _sum: { amount: true },
    }),
    // To'lov qilgan tashkilotlar soni — DISTINCT Prisma groupBy bilan
    // (entityId × oy) juda katta natija berardi, shuning uchun SQL tomonida.
    prisma.$queryRaw<{ month: string; payers: number }[]>(Prisma.sql`
      SELECT p."month" AS month, COUNT(DISTINCT p."entityId")::int AS payers
      FROM "ekohisob_payments" p
      JOIN "ekohisob_legal_entities" e ON e."id" = p."entityId"
      WHERE e."orgId" = ${orgId}
        AND p."month" IN (${Prisma.join(months)})
        ${districtCond}
      GROUP BY p."month"
    `),
  ])

  const agg = new Map<string, MonthAgg>()
  const at = (month: string): MonthAgg => {
    let row = agg.get(month)
    if (!row) { row = {}; agg.set(month, row) }
    return row
  }

  for (const g of payGroups) {
    const row = at(g.month)
    row.collected = g._sum.amount || 0
    row.payments = g._count?._all || 0
  }
  for (const g of chargeGroups) {
    const row = at(g.month)
    row.chargeExpected = g._sum.expectedAmount || 0
    row.chargePaid = g._sum.paidAmount || 0
  }
  for (const g of talonGroups) {
    const month = monthOf(g.date)
    if (!month) continue
    const row = at(month)
    const amount = g._sum.amount || 0
    row.talonExpected = (row.talonExpected || 0) + amount
    if (!g.paid) row.talonUnpaid = (row.talonUnpaid || 0) + amount
  }
  for (const r of payerRows) {
    at(r.month).payers = Number(r.payers) || 0
  }

  return {
    ...buildMonthlyReport(months, agg),
    period: { from: months[0], to: months[months.length - 1], months: months.length },
  }
}

/** GET /reports/monthly?from=YYYY-MM&to=YYYY-MM */
export async function getMonthlyReport(
  req: EkoRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    res.json({ success: true, data: await getMonthlyReportData(req) })
  } catch (err) { next(err) }
}
