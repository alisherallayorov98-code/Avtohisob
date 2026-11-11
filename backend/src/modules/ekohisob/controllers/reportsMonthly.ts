// EkoHisob — oyma-oy hisobot.
//
// `reports.ts` davrning FAQAT oxirgi oyi bo'yicha kesim beradi (yig'im foizi,
// tuman, qarz), oylar bo'yicha esa faqat "qancha yig'ildi" grafigi bor edi.
// Buxgalteriya va rahbar yig'ilishi so'raydigan jadval — "har oy: kutilgan,
// yig'ilgan, foiz, qarz" — shu yerda. Alohida faylda: reports.ts shishmasin.

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { resolvePeriod, scopeOf, wantsBlacklisted } from './reports'
import { buildMonthlyReport, MonthAgg, MonthlyReport } from '../lib/monthlyReport'
import { getCurrentMonth } from '../lib/months'
import { reportStatuses, summarizeDebt } from '../lib/debtSummary'
import { totalsByMonth } from '../lib/reportAggregate'
import {
  entityWhereFor, queryDebtGroups, queryObligations, queryCashByMonth, queryPayersByMonth,
} from '../lib/reportQueries'
import { TtlCache, cached, reportCacheKey } from '../lib/reportCache'

const monthlyCache = new TtlCache<Promise<any>>()

type MonthlyData = MonthlyReport & { period: { from: string; to: string; months: number } }

/**
 * Oylik hisobot ma'lumotlari (HTTP javobisiz).
 * JSON, Excel va chop etish — uchalasi shu yagona manbadan oladi, aks holda
 * ekrandagi raqam hujjatdagidan farq qiladi.
 *
 * "Kutilgan" / "yopilgan" / "qoldiq" — reports.ts (Umumiy KPI) bilan BIR XIL manba
 * (queryObligations), shuning uchun Excel "Umumiy" varaqdagi kutilgan summa oyma-oy
 * jadvaldagi davrning oxirgi oyi qatoriga teng.
 */
export async function getMonthlyReportData(req: EkoRequest): Promise<MonthlyData> {
  const user = scopeOf(req)
  const { months } = resolvePeriod(req)
  const includeBlacklisted = wantsBlacklisted(req)
  const key = reportCacheKey('monthly', { ...user, userId: req.ekoUser!.id }, {
    from: months[0], to: months[months.length - 1], bl: includeBlacklisted, cur: getCurrentMonth(),
  })
  return cached(monthlyCache, key, () => computeMonthlyReport(user, months, includeBlacklisted))
}

async function computeMonthlyReport(
  user: ReturnType<typeof scopeOf>, months: string[], includeBlacklisted: boolean,
): Promise<MonthlyData> {
  const period = { from: months[0], to: months[months.length - 1], months: months.length }
  const statuses = reportStatuses(includeBlacklisted)

  const [payGroups, obligations, cash, payers, debtRows] = await Promise.all([
    // "Shu oyga tegishli" yig'ilgan va to'lov yozuvlari soni
    (prisma as any).ekoHisobPayment.groupBy({
      by: ['month'],
      where: { entity: entityWhereFor(user, statuses), month: { in: months } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    queryObligations(user, statuses, months, getCurrentMonth()),
    queryCashByMonth(user, statuses, months),
    queryPayersByMonth(user, statuses, months),
    // KANONIK jami qarz (tashkilot ichida netto) — KPI va kartochka bilan bir xil
    queryDebtGroups(user),
  ])

  const agg = new Map<string, MonthAgg>()
  const ob = totalsByMonth(obligations, months)
  for (const m of months) {
    const t = ob.get(m)!
    agg.set(m, {
      chargeExpected: t.expectedCharge,
      talonExpected: t.expectedTalon,
      applied: t.applied,
      remaining: t.remaining,
      obliged: t.obliged,
      settled: t.settled,
      collectedCash: cash.get(m)?.cash ?? 0,
      payers: payers.get(m) ?? 0,
    })
  }
  for (const g of payGroups) {
    const row = agg.get(g.month)
    if (!row) continue
    row.collected = g._sum.amount || 0
    row.payments = g._count?._all || 0
  }

  const canonicalDebt = summarizeDebt(debtRows, includeBlacklisted).totalDebt
  return { ...buildMonthlyReport(months, agg, { canonicalDebt }), period }
}

/** GET /reports/monthly?from=YYYY-MM&to=YYYY-MM */
export async function getMonthlyReport(
  req: EkoRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    res.json({ success: true, data: await getMonthlyReportData(req) })
  } catch (err) { next(err) }
}
