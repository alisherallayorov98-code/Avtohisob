// KPI natijalarini yig'ish (DB bilan). Hisob qoidalari — lib/kpiMath.ts (pure, testlangan).
//
// Tenant izolatsiya: barcha so'rovlar orgId bilan chegaralangan (OR-null pattern YO'Q).

import { prisma } from '../../../lib/prisma'
import { summarizePlans } from '../lib/reportMath'
import {
  AUTO_METRICS, getAutoMetric, computeScore, finalScore, computeBonus, monthBoundsUzt, dayKeyUzt,
  DEFAULT_CAP_PERCENT, IndicatorScore, KpiDirection,
} from '../lib/kpiMath'
import {
  countCreditedEntities, countPaymentEvents, sumValidPayments, activeDayKeys, CREDITED_STATUSES,
} from '../lib/kpiAuto'

export interface KpiSchemeDto { bonusMax: number; minScore: number; capPercent: number }

export interface KpiIndicatorDto {
  id: string; name: string; kind: 'auto' | 'manual'; metric: string | null; unit: string
  direction: KpiDirection; target: number; weight: number; isActive: boolean; sortOrder: number
}

export interface KpiAdjustmentDto {
  id: string; points: number; bonusDelta: number; reason: string; createdAt: string; createdByName: string | null
}

export interface KpiUserResult {
  userId: string
  fullName: string
  baseScore: number
  adjustmentPoints: number
  score: number
  bonusDelta: number
  bonus: number
  missingCount: number
  items: IndicatorScore[]
  adjustments: KpiAdjustmentDto[]
}

export interface KpiMonthResults {
  month: string
  status: 'open' | 'closed'
  closedAt: string | null
  scheme: KpiSchemeDto
  indicators: KpiIndicatorDto[]
  rows: KpiUserResult[]
  totalBonus: number
}

export const DEFAULT_SCHEME: KpiSchemeDto = { bonusMax: 0, minScore: 50, capPercent: DEFAULT_CAP_PERCENT }

export async function loadScheme(orgId: string): Promise<KpiSchemeDto> {
  const s = await (prisma as any).ekoHisobKpiScheme.findUnique({ where: { orgId } })
  return s ? { bonusMax: s.bonusMax, minScore: s.minScore, capPercent: s.capPercent } : { ...DEFAULT_SCHEME }
}

export async function loadIndicators(orgId: string, activeOnly = false): Promise<KpiIndicatorDto[]> {
  const rows = await (prisma as any).ekoHisobKpiIndicator.findMany({
    where: { orgId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return rows
}

/** KPI qo'llanadigan xodimlar: faol inspektorlar (soya admin yozuvlari emas). */
export async function loadInspectors(orgId: string, onlyUserId?: string) {
  return (prisma as any).ekoHisobUser.findMany({
    where: { orgId, role: 'inspector', isActive: true, isMirror: false, ...(onlyUserId ? { id: onlyUserId } : {}) },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  }) as Promise<Array<{ id: string; fullName: string }>>
}

/**
 * Oy uchun KPI xodimlari: faol inspektorlar + shu oy ichida ishlagan (to'lov qabul qilgan yoki
 * tashkilot kiritgan) lekin keyin NOFAOL bo'lib ketganlar — ular mehnat qilgan oyi uchun hisobga kiradi.
 */
export async function loadKpiUsers(orgId: string, month: string, onlyUserId?: string) {
  const db = prisma as any
  const active = await loadInspectors(orgId, onlyUserId)
  const { start, end } = monthBoundsUzt(month)
  const [payers, creators] = await Promise.all([
    db.ekoHisobPayment.groupBy({
      by: ['receivedBy'],
      where: { paidAt: { gte: start, lt: end }, amount: { gt: 0 }, entity: { orgId } },
    }).catch(() => [] as any[]),
    db.ekoHisobLegalEntity.groupBy({
      by: ['createdBy'],
      where: { orgId, createdAt: { gte: start, lt: end }, createdBy: { not: null } },
    }).catch(() => [] as any[]),
  ])
  const workedIds = new Set<string>([
    ...payers.map((r: any) => r.receivedBy), ...creators.map((r: any) => r.createdBy),
  ].filter(Boolean))
  const have = new Set(active.map(u => u.id))
  const extraIds = [...workedIds].filter(id => !have.has(id) && (!onlyUserId || id === onlyUserId))
  if (extraIds.length === 0) return active
  const extra = await db.ekoHisobUser.findMany({
    where: { id: { in: extraIds }, orgId, role: 'inspector', isMirror: false, isActive: false },
    select: { id: true, fullName: true },
  })
  return [...active, ...extra].sort((a, b) => a.fullName.localeCompare(b.fullName)) as Array<{ id: string; fullName: string }>
}

type MetricMap = Map<string, Record<string, number>>

/**
 * Avtomatik ko'rsatkichlar. Faqat kerakli (faol sxemada ishlatilgan) metrikalar hisoblanadi.
 * Natijada qiymati bo'lmagan metrika (masalan plan berilmagan) o'sha xodim uchun YO'Q —
 * kpiMath uni hisobdan chiqaradi.
 */
export async function computeAutoMetrics(
  orgId: string, userIds: string[], month: string, needed: Set<string>,
): Promise<MetricMap> {
  const out: MetricMap = new Map(userIds.map(id => [id, {}]))
  if (userIds.length === 0 || needed.size === 0) return out

  const { start, end } = monthBoundsUzt(month)
  const db = prisma as any

  // To'lovlar bir marta o'qiladi: summa > 0 (nol/manfiy sanalmaydi)
  let payRows: Array<{ receivedBy: string; entityId: string; paidAt: Date; amount: number; groupId: string | null }> = []
  if (needed.has('collected') || needed.has('payments_count') || needed.has('active_days')) {
    payRows = await db.ekoHisobPayment.findMany({
      where: { receivedBy: { in: userIds }, paidAt: { gte: start, lt: end }, amount: { gt: 0 }, entity: { orgId } },
      select: { receivedBy: true, entityId: true, paidAt: true, amount: true, groupId: true },
      take: 200000,
    })
  }
  const paysOf = (id: string) => payRows.filter(r => r.receivedBy === id)

  if (needed.has('collected') || needed.has('payments_count')) {
    for (const id of userIds) {
      const mine = paysOf(id)
      out.get(id)!.collected = sumValidPayments(mine)
      // Manipulyatsiyaga chidamli: bir tashkilotga bir kunda bir marta, kassa operatsiyasi bir marta
      out.get(id)!.payments_count = countPaymentEvents(mine)
    }
  }

  // Oy ichida xodim kiritgan tashkilotlar (new_entities va active_days uchun)
  let entRows: Array<{ id: string; stir: string | null; status: string; createdAt: Date; createdBy: string }> = []
  if (needed.has('new_entities') || needed.has('active_days')) {
    entRows = await db.ekoHisobLegalEntity.findMany({
      where: { orgId, createdBy: { in: userIds }, createdAt: { gte: start, lt: end } },
      select: { id: true, stir: true, status: true, createdAt: true, createdBy: true }, take: 100000,
    })
  }

  if (needed.has('new_entities')) {
    const stirs = [...new Set(entRows.map(e => e.stir).filter((x): x is string => !!x && x.trim().length > 0))]
    const sameStir = stirs.length
      ? await db.ekoHisobLegalEntity.findMany({
          where: { orgId, stir: { in: stirs } },
          select: { id: true, stir: true, status: true, createdAt: true },
        })
      : []
    for (const id of userIds) {
      const mine = entRows.filter(e => e.createdBy === id)
      // Faqat faol (qoralama/nofaol emas) va takroriy STIR emas
      out.get(id)!.new_entities = countCreditedEntities(mine, sameStir)
    }
  }

  if (needed.has('draft_backlog')) {
    const rows = await db.ekoHisobLegalEntity.groupBy({
      by: ['createdBy'],
      where: { orgId, createdBy: { in: userIds }, status: 'draft' },
      _count: { _all: true },
    })
    const byUser = new Map<string, number>(rows.map((r: any) => [r.createdBy, r._count._all]))
    for (const id of userIds) out.get(id)!.draft_backlog = byUser.get(id) ?? 0
  }

  if (needed.has('sms_sent')) {
    // Bir tashkilotga bir necha SMS bir marta sanaladi
    const rows = await db.ekoHisobSmsLog.findMany({
      where: { orgId, sentBy: { in: userIds }, status: 'sent', createdAt: { gte: start, lt: end } },
      select: { sentBy: true, entityId: true }, distinct: ['sentBy', 'entityId'], take: 100000,
    })
    const cnt = new Map<string, number>()
    for (const r of rows) cnt.set(r.sentBy, (cnt.get(r.sentBy) ?? 0) + 1)
    for (const id of userIds) out.get(id)!.sms_sent = cnt.get(id) ?? 0
  }

  if (needed.has('active_days')) {
    for (const id of userIds) {
      out.get(id)!.active_days = activeDayKeys(
        paysOf(id).map(p => p.paidAt),
        entRows.filter(e => e.createdBy === id && CREDITED_STATUSES.includes(e.status)).map(e => e.createdAt),
      ).size
    }
  }

  if (needed.has('plan_completion')) {
    // Plan sanasi @db.Date (UTC yarim tun = kalendar kun), tashkilot kiritish vaqti esa UZT kuniga
    // bo'linadi (plans.ts bilan bir xil: dayBoundsUz) — "Planlar" sahifasi bilan mos.
    const pStart = new Date(`${month}-01T00:00:00.000Z`)
    const pEnd = new Date(pStart); pEnd.setUTCMonth(pEnd.getUTCMonth() + 1)
    const [plans, ents] = await Promise.all([
      db.ekoHisobPlan.findMany({
        where: { orgId, inspectorId: { in: userIds }, type: 'new_entity', date: { gte: pStart, lt: pEnd } },
        select: { inspectorId: true, date: true, targetCount: true },
      }),
      db.ekoHisobLegalEntity.findMany({
        where: { orgId, createdBy: { in: userIds }, createdAt: { gte: start, lt: end } },
        select: { createdBy: true, createdAt: true }, take: 100000,
      }),
    ])
    for (const id of userIds) {
      const myPlans = plans.filter((p: any) => p.inspectorId === id)
      if (myPlans.length === 0) continue // plan berilmagan — ko'rsatkich hisobdan chiqadi
      const createdByDay: Record<string, number> = {}
      for (const e of ents) {
        if (e.createdBy !== id) continue
        const k = dayKeyUzt(e.createdAt)
        createdByDay[k] = (createdByDay[k] ?? 0) + 1
      }
      const s = summarizePlans(
        myPlans.map((p: any) => ({ date: p.date.toISOString().slice(0, 10), target: p.targetCount })),
        createdByDay,
      )
      if (s.fulfillRate !== null) out.get(id)!.plan_completion = s.fulfillRate
    }
  }

  return out
}

/** Oy natijalari: yopilgan bo'lsa snapshot, aks holda jonli hisob. */
export async function buildMonthResults(
  orgId: string, month: string, opts: { onlyUserId?: string } = {},
): Promise<KpiMonthResults> {
  const db = prisma as any
  const period = await db.ekoHisobKpiPeriod.findUnique({ where: { orgId_month: { orgId, month } } })

  if (period?.status === 'closed' && period.snapshot) {
    const snap = period.snapshot as KpiMonthResults
    const rows = opts.onlyUserId ? snap.rows.filter(r => r.userId === opts.onlyUserId) : snap.rows
    return { ...snap, rows, status: 'closed', closedAt: period.closedAt?.toISOString?.() ?? null }
  }

  const [scheme, allIndicators, users] = await Promise.all([
    loadScheme(orgId),
    loadIndicators(orgId, true),
    loadKpiUsers(orgId, month, opts.onlyUserId),
  ])
  const userIds = users.map(u => u.id)

  const needed = new Set<string>(
    allIndicators.filter(i => i.kind === 'auto' && i.metric && i.weight > 0).map(i => i.metric as string),
  )
  const [autoMap, entries, adjustments] = await Promise.all([
    computeAutoMetrics(orgId, userIds, month, needed),
    db.ekoHisobKpiEntry.findMany({ where: { orgId, month, userId: { in: userIds } } }),
    db.ekoHisobKpiAdjustment.findMany({
      where: { orgId, month, userId: { in: userIds } }, orderBy: { createdAt: 'asc' },
    }),
  ])
  const entryMap = new Map<string, number>(entries.map((e: any) => [`${e.indicatorId}:${e.userId}`, e.value]))

  const creatorIds = Array.from(new Set(adjustments.map((a: any) => a.createdBy).filter(Boolean))) as string[]
  const creators = creatorIds.length
    ? await db.ekoHisobUser.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true } })
    : []
  const creatorName = new Map<string, string>(creators.map((c: any) => [c.id, c.fullName]))

  const rows: KpiUserResult[] = users.map(u => {
    const metrics = autoMap.get(u.id) ?? {}
    const score = computeScore(
      allIndicators.map(i => ({
        id: i.id,
        name: i.name,
        weight: i.weight,
        target: i.target,
        direction: i.direction,
        unit: i.unit,
        value: i.kind === 'auto'
          ? (i.metric && metrics[i.metric] !== undefined ? metrics[i.metric] : null)
          : (entryMap.get(`${i.id}:${u.id}`) ?? null),
      })),
      scheme.capPercent,
    )
    const mine = adjustments.filter((a: any) => a.userId === u.id)
    const adjustmentPoints = mine.reduce((s: number, a: any) => s + a.points, 0)
    const bonusDelta = mine.reduce((s: number, a: any) => s + a.bonusDelta, 0)
    const total = finalScore(score.baseScore, adjustmentPoints, scheme.capPercent)
    return {
      userId: u.id,
      fullName: u.fullName,
      baseScore: score.baseScore,
      adjustmentPoints,
      score: total,
      bonusDelta,
      bonus: computeBonus({ score: total, bonusMax: scheme.bonusMax, minScore: scheme.minScore, bonusDelta }),
      missingCount: score.missingCount,
      items: score.items,
      adjustments: mine.map((a: any) => ({
        id: a.id, points: a.points, bonusDelta: a.bonusDelta, reason: a.reason,
        createdAt: a.createdAt.toISOString(),
        createdByName: a.createdBy ? (creatorName.get(a.createdBy) ?? null) : null,
      })),
    }
  })

  return {
    month,
    status: 'open',
    closedAt: null,
    scheme,
    indicators: allIndicators,
    rows,
    totalBonus: rows.reduce((s, r) => s + r.bonus, 0),
  }
}

/** Davr holati (yopiq bo'lsa o'zgartirishlar bloklanadi). */
export async function isPeriodClosed(orgId: string, month: string): Promise<boolean> {
  const p = await (prisma as any).ekoHisobKpiPeriod.findUnique({ where: { orgId_month: { orgId, month } } })
  return p?.status === 'closed'
}

/** Standart avto-ko'rsatkichlarni qo'shadi (idempotent: allaqachon bor metrikani qayta qo'shmaydi). */
export async function seedDefaultIndicators(orgId: string): Promise<number> {
  const db = prisma as any
  const existing = await db.ekoHisobKpiIndicator.findMany({
    where: { orgId, kind: 'auto' }, select: { metric: true },
  })
  const have = new Set<string>(existing.map((e: any) => e.metric))
  const count = await db.ekoHisobKpiIndicator.count({ where: { orgId } })
  let added = 0
  for (const m of AUTO_METRICS) {
    if (have.has(m.key)) continue
    await db.ekoHisobKpiIndicator.create({
      data: {
        orgId, name: m.label, kind: 'auto', metric: m.key, unit: m.unit, direction: m.direction,
        target: m.defaultTarget, weight: m.defaultWeight, sortOrder: count + added,
      },
    })
    added++
  }
  return added
}

export { getAutoMetric }
