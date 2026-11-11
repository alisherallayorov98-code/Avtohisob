import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getCurrentMonth, isValidMonth, monthsBetween, addMonths } from '../lib/months'
import { deltaPercent, debtAgeRowsFromBuckets } from '../lib/reportMath'
import {
  ScopeUser, districtIdsFilter, canAccessDistrict, entityScopeWhere,
} from '../lib/ekoScope'
import { dayBoundsUz, daysInMonth, uztParts, shiftMonth } from '../lib/uzt'
import {
  NO_MAHALLA, reportStatuses, summarizeDebt, debtByDistrict, debtByMahalla,
} from '../lib/debtSummary'
import {
  emptyTotals, sumObligations, totalsByDistrict, totalsByMahalla, totalsByMonth,
  settlementRate, collectionRate, advanceAmount, pctChange, computePace,
} from '../lib/reportAggregate'
import {
  entityWhereFor, onlyDistrict, queryDebtGroups, queryDebtAgeBuckets, queryDebtors,
  queryObligations, queryCollected, queryCashByMonth, queryEntityCounts, sumCashBetween,
} from '../lib/reportQueries'
import { TtlCache, cached, reportCacheKey } from '../lib/reportCache'

/** Hisobot davri bir so'rovda maksimal necha oyni qamrashi mumkin. */
const MAX_PERIOD_MONTHS = 36

const reportCache = new TtlCache<Promise<any>>()

/** So'rovdagi ekoUser → doira obyekti (ekoScope). */
export function scopeOf(req: EkoRequest): ScopeUser {
  const u = req.ekoUser!
  return { role: u.role, orgId: u.orgId, districtIds: u.districtIds ?? [] }
}

/** `?includeBlacklisted=1` — qora ro'yxatdagi tashkilotlar KPI/tuman/yig'imga ham qo'shiladi. */
export function wantsBlacklisted(req: EkoRequest): boolean {
  const v = String((req.query as any)?.includeBlacklisted ?? '').toLowerCase()
  return v === '1' || v === 'true'
}

/**
 * So'rovdan hisobot davrini oladi: `?from=YYYY-MM&to=YYYY-MM`.
 * Berilmasa — oxirgi 6 oy (avvalgi xatti-harakat saqlanadi).
 *
 * "Oylik" ko'rsatkichlar (yig'im foizi, tuman kesimi, kutilgan summa) davrning
 * OXIRGI oyiga tegishli. Standart davrda bu joriy oy (UZT).
 */
export function resolvePeriod(req: EkoRequest): { months: string[]; focusMonth: string } {
  const q = req.query as Record<string, string>
  const current = getCurrentMonth()

  let from = isValidMonth(q.from ?? '') ? q.from : null
  let to = isValidMonth(q.to ?? '') ? q.to : null

  if (!from && !to) {
    from = addMonths(current, -5)
    to = current
  } else if (from && !to) {
    to = current < from ? from : current
  } else if (!from && to) {
    from = addMonths(to, -5)
  }
  if (from! > to!) [from, to] = [to, from]

  let months = monthsBetween(from!, to!)
  if (months.length === 0) months = [current]
  // Juda uzun davr — oxirgi MAX_PERIOD_MONTHS oy qoldiriladi
  if (months.length > MAX_PERIOD_MONTHS) months = months.slice(-MAX_PERIOD_MONTHS)

  return { months, focusMonth: months[months.length - 1] }
}

/**
 * GET /reports/overview
 * Rahbar uchun: oylik yig'im dinamikasi, tuman bo'yicha, inspektor samaradorligi.
 *
 * TA'RIFLAR (hamma hisobot — dashboard, Excel, chop etish — shularga amal qiladi):
 *  - "Jami qarz"  : faol tashkilotlarning ochiq hisob + to'lanmagan talon qoldig'i (debtSummary.ts).
 *                   Qora ro'yxat qarzi ALOHIDA (`blacklistedDebt`); `?includeBlacklisted=1` bilan jamiga qo'shiladi.
 *  - "Kassaga tushdi" (`collectedCash`)   : paidAt shu oyda (UZT chegarasi).
 *  - "Shu oyga tegishli" (`collectedForMonth`, eski nomi `collectedThisMonth`): payment.month = shu oy.
 *  - To'lov foizi (`payRate`): majburiyati borlar ichida majburiyatini TO'LIQ yopganlar
 *    (qisman to'lov — to'lamagan). Maxraj o'sha oyning hisob/talon yozuvlaridan.
 *  - Yig'im foizi (`collectRate`): yopilgan / kutilgan — bir xil tashkilotlar to'plamidan.
 *    Avans (ortiqcha tushum) `advance` maydonida alohida.
 */
export async function getReportsOverview(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getReportsData(req)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

/**
 * Hisobot ma'lumotlarini yig'adi (HTTP javobisiz).
 * `getReportsOverview`, Excel eksport va chop etish — uchalasi shu yagona
 * manbadan oladi, aks holda ekrandagi raqam bilan hujjatdagi raqam farq qilardi.
 * 60 soniyalik kesh: kalit orgId + foydalanuvchi + rol + tumanlar + davr.
 */
export async function getReportsData(req: EkoRequest): Promise<any> {
  const user = scopeOf(req)
  const { months, focusMonth } = resolvePeriod(req)
  const includeBlacklisted = wantsBlacklisted(req)
  const key = reportCacheKey('overview', { ...user, userId: req.ekoUser!.id }, {
    from: months[0], to: focusMonth, bl: includeBlacklisted, cur: getCurrentMonth(),
  })
  return cached(reportCache, key, () => computeReportsData(req, user, months, focusMonth, includeBlacklisted))
}

async function computeReportsData(
  req: EkoRequest, user: ScopeUser, months: string[], focusMonth: string, includeBlacklisted: boolean,
): Promise<any> {
  const { id: userId } = req.ekoUser!
  const { orgId, role } = user
  const statuses = reportStatuses(includeBlacklisted)
  const currentMonthNow = getCurrentMonth()
  const prevMonth = shiftMonth(focusMonth, -1)
  const entityWhere = entityWhereFor(user, statuses)
  const districtFilter = districtIdsFilter(user)

  const [
    districts, debtRows, obligations, collectedRows, prevCollectedRows, entityCounts,
    cashByMonth, monthGroups, ageBuckets, topRows, activeEntities,
  ] = await Promise.all([
    (prisma as any).ekoHisobDistrict.findMany({
      where: districtFilter ? { orgId, id: { in: districtFilter } } : { orgId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    queryDebtGroups(user),
    queryObligations(user, statuses, months, currentMonthNow),
    queryCollected(user, statuses, focusMonth),
    queryCollected(user, statuses, prevMonth),
    queryEntityCounts(user, statuses),
    queryCashByMonth(user, statuses, months),
    (prisma as any).ekoHisobPayment.groupBy({
      by: ['month'], where: { entity: entityWhere, month: { in: months } }, _sum: { amount: true },
    }),
    queryDebtAgeBuckets(user, statuses),
    queryDebtors(user, statuses, 10, 'debt'),
    (prisma as any).ekoHisobLegalEntity.count({ where: { ...entityScopeWhere(user), status: 'active' } }),
  ])

  // ── Qarz (yagona ta'rif) ──
  const debtSummary = summarizeDebt(debtRows, includeBlacklisted)
  const debtDistrict = debtByDistrict(debtRows, includeBlacklisted)
  const blacklistedByDistrict = new Map<string, number>()
  for (const r of debtRows) {
    if (r.status === 'blacklisted') {
      blacklistedByDistrict.set(r.districtId, (blacklistedByDistrict.get(r.districtId) ?? 0) + r.debt)
    }
  }

  // ── Majburiyat (kutilgan / yopilgan / to'liq to'lagan) ──
  const focusTotals = sumObligations(obligations, r => r.month === focusMonth)
  const obByDistrict = totalsByDistrict(obligations, focusMonth)
  const obByMonth = totalsByMonth(obligations, months)

  // ── Yig'ilgan: ikki aniq ma'no ──
  const sumCol = (rows: { forMonth: number; cash: number; districtId: string }[], districtId?: string) =>
    rows.reduce((a, r) => (districtId && r.districtId !== districtId
      ? a : { forMonth: a.forMonth + r.forMonth, cash: a.cash + r.cash }), { forMonth: 0, cash: 0 })
  const colNow = sumCol(collectedRows)
  const colPrev = sumCol(prevCollectedRows)

  // ── Oylik dinamika ──
  const byMonth = new Map<string, number>(
    monthGroups.map((g: any) => [g.month as string, g._sum.amount || 0]),
  )
  const monthlyTrend = months.map(m => {
    const ob = obByMonth.get(m) ?? emptyTotals()
    const forMonth = byMonth.get(m) || 0
    return {
      month: m,
      label: new Date(m + '-01').toLocaleDateString('uz-UZ', { month: 'short', year: '2-digit' }),
      collected: forMonth,
      collectedForMonth: forMonth,
      collectedCash: cashByMonth.get(m)?.cash ?? 0,
      expected: ob.expected,
      applied: ob.applied,
    }
  })

  // ── Tuman bo'yicha ──
  const totalByDistrict = new Map<string, number>()
  for (const c of entityCounts) totalByDistrict.set(c.districtId, (totalByDistrict.get(c.districtId) ?? 0) + c.total)

  const byDistrict = districts.map((d: any) => {
    const ob = obByDistrict.get(d.id) ?? emptyTotals()
    const col = sumCol(collectedRows, d.id)
    const dd = debtDistrict.get(d.id)
    return {
      id: d.id,          // mahalla kesimini yuklash uchun
      name: d.name,
      total: totalByDistrict.get(d.id) ?? 0,
      obliged: ob.obliged,
      // "paid" — majburiyatini TO'LIQ yopganlar (qisman to'lov kirmaydi)
      paid: ob.settled,
      partial: ob.partial,
      unpaid: Math.max(0, ob.obliged - ob.settled),
      collected: col.forMonth,
      collectedForMonth: col.forMonth,
      collectedCash: col.cash,
      expected: ob.expected,
      applied: ob.applied,
      advance: advanceAmount(col.forMonth, ob.applied),
      debt: dd?.debt ?? 0,
      debtors: dd?.debtors ?? 0,
      blacklistedDebt: blacklistedByDistrict.get(d.id) ?? 0,
      // null — shu oyda to'laydigan tashkilot yo'q (0% yozish yolg'on bo'lardi)
      payRate: settlementRate(ob),
      collectRate: collectionRate(ob),
    }
  })
  byDistrict.sort((a: any, b: any) => b.collected - a.collected)

  // ── Inspektor samaradorligi ──
  // MUHIM: inspektorga ochiq shaxsiy reyting KO'RSATILMAYDI — faqat o'z natijasi va jamoa o'rtachasi.
  const first = dayBoundsUz(`${months[0]}-01`)
  const periodEnd = dayBoundsUz(`${shiftMonth(months[months.length - 1], 1)}-01`)?.start ?? null
  const [inspectorGroups, inspectorCashGroups, inspectors] = await Promise.all([
    (prisma as any).ekoHisobPayment.groupBy({
      by: ['receivedBy'],
      where: { entity: entityWhere, month: { in: months } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    first && periodEnd
      ? (prisma as any).ekoHisobPayment.groupBy({
          by: ['receivedBy'],
          where: { entity: entityWhere, paidAt: { gte: first.start, lt: periodEnd } },
          _sum: { amount: true },
        })
      : Promise.resolve([]),
    (prisma as any).ekoHisobUser.findMany({
      where: {
        orgId, role: 'inspector', isMirror: false,
        ...(districtFilter ? { districts: { some: { districtId: { in: districtFilter } } } } : {}),
      },
      select: { id: true, fullName: true },
    }),
  ])
  const collById = new Map<string, { collected: number; payments: number }>(
    inspectorGroups.map((g: any) => [
      g.receivedBy as string,
      { collected: g._sum.amount || 0, payments: g._count._all || 0 },
    ]),
  )
  const cashById = new Map<string, number>(
    inspectorCashGroups.map((g: any) => [g.receivedBy as string, g._sum.amount || 0]),
  )
  const allInspectorRows = inspectors
    .map((u: any) => ({
      id: u.id,
      name: u.fullName,
      collected: collById.get(u.id)?.collected ?? 0,
      collectedCash: cashById.get(u.id) ?? 0,
      payments: collById.get(u.id)?.payments ?? 0,
    }))
    .sort((a: any, b: any) => b.collected - a.collected)

  // Jamoa o'rtachasi — faqat ishlaganlar bo'yicha
  const workedRows = allInspectorRows.filter((i: any) => i.collected > 0)
  const teamAverage = workedRows.length > 0
    ? Math.round(workedRows.reduce((s: number, i: any) => s + i.collected, 0) / workedRows.length)
    : 0

  let byInspector: any[]
  let inspectorSelf: any = null
  if (role === 'inspector') {
    const self = allInspectorRows.find((i: any) => i.id === userId)
    inspectorSelf = {
      collected: self?.collected ?? 0,
      collectedCash: self?.collectedCash ?? 0,
      payments: self?.payments ?? 0,
      teamAverage,
      inspectorCount: workedRows.length,
    }
    byInspector = []
  } else {
    byInspector = allInspectorRows
  }

  // ── Tempo (faqat joriy oy): X-kuniga qadar kassa vs o'tgan oyning shu kuni ──
  let pace: ReturnType<typeof computePace> | null = null
  if (focusMonth === currentMonthNow) {
    const day = uztParts(new Date())!.day
    const curEnd = dayBoundsUz(`${focusMonth}-${String(day).padStart(2, '0')}`)
    const prevDay = Math.min(day, daysInMonth(prevMonth))
    const prevEnd = dayBoundsUz(`${prevMonth}-${String(prevDay).padStart(2, '0')}`)
    const curStart = dayBoundsUz(`${focusMonth}-01`)
    const prevStart = dayBoundsUz(`${prevMonth}-01`)
    if (curEnd && prevEnd && curStart && prevStart) {
      const [cur, prev] = await Promise.all([
        sumCashBetween(user, statuses, curStart.start, curEnd.end),
        sumCashBetween(user, statuses, prevStart.start, prevEnd.end),
      ])
      pace = computePace(day, daysInMonth(focusMonth), cur, prev)
    }
  }

  const totalCollected6m = monthlyTrend.reduce((s: number, m: any) => s + m.collected, 0)
  const totalCollectedCash = monthlyTrend.reduce((s: number, m: any) => s + m.collectedCash, 0)

  return {
    kpi: {
      activeEntities,
      // ── Yig'ilgan: ikki alohida, aniq ma'no ──
      collectedThisMonth: colNow.forMonth,          // eski nom = collectedForMonth
      collectedForMonth: colNow.forMonth,           // "Shu oyga tegishli" (payment.month)
      collectedCash: colNow.cash,                   // "Kassaga tushdi" (paidAt, UZT oy)
      collectedPrevMonth: colPrev.forMonth,
      collectedForMonthPrev: colPrev.forMonth,
      collectedCashPrev: colPrev.cash,
      // O'tgan oy bilan OLMA-OLMA: ikkala tomon ham bir xil ma'noda
      collectedDelta: deltaPercent(colNow.forMonth, colPrev.forMonth),
      collectedCashDelta: pctChange(colNow.cash, colPrev.cash),
      // ── Kutilgan: Excel "Umumiy" va oyma-oy jadval bilan bir xil manba ──
      expectedMonthly: focusTotals.expected,
      expectedFixed: focusTotals.expectedCharge,
      expectedTalon: focusTotals.expectedTalon,
      applied: focusTotals.applied,
      remainingMonth: focusTotals.remaining,
      advance: advanceAmount(colNow.forMonth, focusTotals.applied),
      // ── Qarz ──
      totalDebt: debtSummary.totalDebt,
      totalDebtors: debtSummary.totalDebtors,
      activeDebt: debtSummary.activeDebt,
      blacklistedDebt: debtSummary.blacklistedDebt,
      blacklistedDebtors: debtSummary.blacklistedDebtors,
      includeBlacklisted,
      // Eski maydon son bo'lib qoladi (null o'rniga 0); aniq qiymat — collectRateExact
      collectRate: collectionRate(focusTotals) ?? 0,
      collectRateExact: collectionRate(focusTotals),
      // Tashkilot bo'yicha: majburiyatini to'liq yopganlar / majburiyati borlar
      obligedCount: focusTotals.obliged,
      paidCount: focusTotals.settled,
      partialCount: focusTotals.partial,
      payRate: settlementRate(focusTotals),
      totalCollected6m,
      totalCollectedCash,
    },
    pace,
    monthlyTrend,
    byDistrict,
    byInspector,
    inspectorSelf,
    debtByAge: debtAgeRowsFromBuckets(ageBuckets),
    topDebtors: topRows.map(r => ({
      id: r.id, name: r.name, district: r.district, mahalla: r.mahalla, billingMode: r.billingMode,
      debtMonths: r.debtMonths, debtAmount: r.debtAmount,
    })),
    currentMonth: focusMonth,
    prevMonth,
    period: { from: months[0], to: months[months.length - 1], months: months.length },
    definitions: {
      totalDebt: includeBlacklisted ? 'faol + qora ro\'yxat qarzi' : 'faol tashkilotlar qarzi (qora ro\'yxat alohida)',
      collectedCash: 'paidAt shu UZT oyida',
      collectedForMonth: 'payment.month shu oy',
      payRate: 'majburiyatini to\'liq yopganlar / majburiyati borlar',
      collectRate: 'yopilgan / kutilgan (bir xil to\'plam)',
    },
  }
}

/**
 * GET /reports/district/:id/mahallas?from=&to=
 *
 * Tuman ichidagi mahallalar kesimi — talab bo'lganda yuklanadi (drill-down).
 * Mahallasiz tashkilotlarning qarzi ham HAQIQIY hisoblanadi (ilgari qattiq 0 edi).
 */
export async function getDistrictMahallas(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = scopeOf(req)
    const districtId = String(req.params.id)

    const district = await (prisma as any).ekoHisobDistrict.findUnique({
      where: { id: districtId },
      select: { id: true, name: true, orgId: true },
    })
    if (!district || district.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tuman topilmadi' })
      return
    }
    if (!canAccessDistrict(user, districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const { months, focusMonth } = resolvePeriod(req)
    const includeBlacklisted = wantsBlacklisted(req)
    const key = reportCacheKey('mahallas', { ...user, userId: req.ekoUser!.id }, {
      d: districtId, from: months[0], to: focusMonth, bl: includeBlacklisted, cur: getCurrentMonth(),
    })
    const data = await cached(reportCache, key, async () => {
      const statuses = reportStatuses(includeBlacklisted)
      const extra = onlyDistrict(districtId)
      const [mahallas, obligations, collectedRows, counts, debtRows] = await Promise.all([
        (prisma as any).ekoHisobMahalla.findMany({
          where: { districtId }, select: { id: true, name: true }, orderBy: { name: 'asc' },
        }),
        queryObligations(user, statuses, [focusMonth], getCurrentMonth(), extra),
        queryCollected(user, statuses, focusMonth, extra),
        queryEntityCounts(user, statuses, extra),
        queryDebtGroups(user, extra),
      ])
      const obBy = totalsByMahalla(obligations, focusMonth, districtId)
      const debtBy = debtByMahalla(debtRows, districtId, includeBlacklisted)

      const rowFor = (id: string, name: string, mahallId: string | null) => {
        const ob = obBy.get(mahallId) ?? emptyTotals()
        const col = collectedRows
          .filter(r => r.mahallId === mahallId)
          .reduce((a, r) => ({ forMonth: a.forMonth + r.forMonth, cash: a.cash + r.cash }), { forMonth: 0, cash: 0 })
        const total = counts.filter(c => c.mahallId === mahallId).reduce((s, c) => s + c.total, 0)
        const dd = debtBy.get(mahallId ?? NO_MAHALLA)
        return {
          id, name,
          total, obliged: ob.obliged, paid: ob.settled, partial: ob.partial,
          unpaid: Math.max(0, ob.obliged - ob.settled),
          collected: col.forMonth, collectedForMonth: col.forMonth, collectedCash: col.cash,
          expected: ob.expected, applied: ob.applied, advance: advanceAmount(col.forMonth, ob.applied),
          debt: dd?.debt ?? 0, debtors: dd?.debtors ?? 0,
          payRate: settlementRate(ob), collectRate: collectionRate(ob),
        }
      }

      const rows = mahallas.map((m: any) => rowFor(m.id, m.name, m.id))
      // Mahallasiz tashkilotlar ham bo'lishi mumkin — ular yo'qolib qolmasin (qarzi HAQIQIY)
      const noMahalla = rowFor(NO_MAHALLA, 'Mahallasiz', null)
      if (noMahalla.total > 0 || noMahalla.debt > 0) rows.push(noMahalla)
      rows.sort((a: any, b: any) => b.collected - a.collected)
      return { district: district.name, month: focusMonth, mahallas: rows }
    })

    res.json({ success: true, data })
  } catch (err) { next(err) }
}
