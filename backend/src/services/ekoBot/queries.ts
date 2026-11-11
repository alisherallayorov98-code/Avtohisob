// Dala-bot DB so'rovlari. Hamma doira ekoScope orqali; qarz — dashboard /daily bilan bir xil manba.

import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { ScopeUser, canAccessEntity, entityScopeWhere } from '../../modules/ekohisob/lib/ekoScope'
import { queryDailyDebtors, queryEntityDebts, sumCashBetween } from '../../modules/ekohisob/lib/reportQueries'
import { dayBoundsUz, monthBoundsUz, currentMonthUz, parseDateOnly, todayUz } from '../../modules/ekohisob/lib/uzt'
import { findBrokenPromises } from '../../modules/ekohisob/lib/visitMath'
import { findSimilar, SimilarMatch, cyrToLatin } from '../../modules/ekohisob/lib/similarEntities'
import { classifyQuery } from './search'
import { DailyRow, InspectorRow } from './reports'

const db = prisma as any

export interface BotUser {
  id: string; fullName: string; role: string; orgId: string; email: string
  districts: { district: { id: string; name?: string } }[]
}

export function scopeOf(u: BotUser): ScopeUser {
  return { role: u.role, orgId: u.orgId, districtIds: u.districts.map(d => d.district.id) }
}

export function actorOf(u: BotUser) {
  const s = scopeOf(u)
  return { id: u.id, email: u.email || '', role: s.role, orgId: s.orgId, districtIds: s.districtIds, eko: true as const }
}

export type EntityAccess =
  | { ok: true; entity: any }
  | { ok: false; reason: 'not_found' | 'forbidden' }

/** Tashkilotni yuklaydi va org + tuman huquqini tekshiradi. */
export async function loadEntityFor(u: BotUser, entityId: string): Promise<EntityAccess> {
  if (!entityId || entityId.length > 60) return { ok: false, reason: 'not_found' }
  const entity = await db.ekoHisobLegalEntity.findUnique({
    where: { id: entityId },
    select: {
      id: true, name: true, orgId: true, districtId: true, status: true, monthlyFee: true, billingMode: true,
      cubicPrice: true, address: true, lat: true, lon: true, stir: true, code: true, phone: true,
    },
  })
  if (!entity || entity.orgId !== u.orgId) return { ok: false, reason: 'not_found' }
  if (!canAccessEntity(scopeOf(u), entity)) return { ok: false, reason: 'forbidden' }
  return { ok: true, entity }
}

export interface DebtInfo { debt: number; advance: number; unpaidMonths: string[] }

export async function getEntityDebtInfo(
  scope: ScopeUser, entity: { id: string; status: string }, month: string,
): Promise<DebtInfo> {
  const [map, daily] = await Promise.all([
    queryEntityDebts([entity.id], scope.orgId),
    entity.status === 'active'
      ? queryDailyDebtors(scope, month, Prisma.sql`AND e."id" = ${entity.id}`, 1)
      : Promise.resolve(null),
  ])
  const base = map.get(entity.id)
  const unpaid = [...(base?.unpaidMonths ?? [])]
  const row = daily?.rows[0]
  if (row && row.unbilled > 0 && !unpaid.includes(month)) unpaid.push(month)
  unpaid.sort()
  return { debt: daily ? (row?.debt ?? 0) : (base?.debt ?? 0), advance: base?.advance ?? 0, unpaidMonths: unpaid }
}

export async function paidInMonth(entityId: string, month: string): Promise<number> {
  const agg = await db.ekoHisobPayment.aggregate({ where: { entityId, month }, _sum: { amount: true } })
  return agg._sum.amount || 0
}

export async function searchEntities(scope: ScopeUser, text: string) {
  const q = classifyQuery(text)
  if (q.kind === 'invalid') return []
  const or: any[] = []
  if (q.name) {
    or.push({ name: { contains: q.name, mode: 'insensitive' } })
    const alt = cyrToLatin(q.name)
    if (alt && alt !== q.name) or.push({ name: { contains: alt, mode: 'insensitive' } })
  }
  if (q.digits) or.push({ stir: { contains: q.digits } })
  if (q.code) or.push({ code: { contains: q.code, mode: 'insensitive' } })
  if (q.phoneTail && q.phoneTail.length >= 4 && scope.orgId) {
    const rows: { id: string }[] = await prisma.$queryRaw(Prisma.sql`
      SELECT id FROM "ekohisob_legal_entities"
      WHERE "orgId" = ${scope.orgId}
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE ${'%' + q.phoneTail + '%'}
      LIMIT 50`)
    if (rows.length) or.push({ id: { in: rows.map(r => r.id) } })
  }
  if (or.length === 0) return []
  return db.ekoHisobLegalEntity.findMany({
    where: { ...entityScopeWhere(scope), status: { not: 'inactive' }, OR: or },
    select: { id: true, name: true, stir: true, code: true, phone: true },
    orderBy: { name: 'asc' }, take: 10,
  })
}

/** Va'dasi bugun/o'tgan tashkilotlar: entityId -> necha kun o'tgan (0 = bugun). */
export async function brokenPromiseMap(orgId: string, entityIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (entityIds.length === 0) return out
  const today = todayUz()
  const todayDate = parseDateOnly(today)!
  const since = new Date(todayDate.getTime() - 60 * 86400000)
  const visits = await db.ekoHisobVisit.findMany({
    where: { orgId, kind: 'promised', entityId: { in: entityIds }, promisedDate: { gte: since, lte: todayDate } },
    select: { id: true, entityId: true, promisedDate: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 5000,
  })
  if (visits.length === 0) return out
  const minCreated = new Date(Math.min(...visits.map((v: any) => v.createdAt.getTime())))
  const payments = await db.ekoHisobPayment.findMany({
    where: { entityId: { in: [...new Set<string>(visits.map((v: any) => v.entityId))] }, paidAt: { gte: minCreated } },
    select: { entityId: true, paidAt: true },
  })
  const broken = findBrokenPromises(
    visits.map((v: any) => ({
      id: v.id, entityId: v.entityId, createdAt: v.createdAt, promisedDate: v.promisedDate.toISOString().slice(0, 10),
    })),
    payments, today,
  )
  for (const b of broken) out.set(b.entityId, b.daysOverdue)
  return out
}

export async function loadDailyList(scope: ScopeUser) {
  const month = currentMonthUz()
  const day = dayBoundsUz(todayUz())!
  const [ranked, collectedToday] = await Promise.all([
    queryDailyDebtors(scope, month, Prisma.empty, 2000),
    sumCashBetween(scope, ['active'], day.start, day.end),
  ])
  const ids = ranked.rows.map(r => r.id)
  const ents = ids.length === 0 ? [] : await db.ekoHisobLegalEntity.findMany({
    where: { ...entityScopeWhere(scope), id: { in: ids } },
    select: { id: true, name: true, mahalla: { select: { name: true } } },
  })
  const byId = new Map<string, any>(ents.map((e: any) => [e.id, e]))
  const promises = await brokenPromiseMap(scope.orgId, ids)
  const rows: DailyRow[] = []
  for (const r of ranked.rows) {
    const e = byId.get(r.id)
    if (!e) continue
    rows.push({ id: r.id, name: e.name, debt: r.debt, mahalla: e.mahalla?.name ?? null, promiseDays: promises.get(r.id) ?? null })
  }
  return { rows, collectedToday, month }
}

/** Yangi tashkilotga o'xshashlar (tuman doirasida). */
export async function findSimilarForNew(
  scope: ScopeUser, c: { name: string; lat: number | null; lon: number | null; districtId: string },
): Promise<SimilarMatch[]> {
  const or: any[] = []
  if (c.lat != null && c.lon != null) {
    or.push({ lat: { gte: c.lat - 0.0006, lte: c.lat + 0.0006 }, lon: { gte: c.lon - 0.0008, lte: c.lon + 0.0008 } })
  }
  const token = c.name.split(/\s+/).find(w => w.length >= 3)
  if (token) or.push({ districtId: c.districtId, name: { contains: token, mode: 'insensitive' } })
  if (or.length === 0) return []
  const cand = await db.ekoHisobLegalEntity.findMany({
    where: { ...entityScopeWhere(scope), OR: or },
    select: { id: true, name: true, phone: true, lat: true, lon: true, districtId: true, status: true },
    take: 500,
  })
  return findSimilar({ name: c.name, lat: c.lat, lon: c.lon, districtId: c.districtId }, cand)
}

/** Boshliq/inspektor hisobotlari uchun inspektor qatorlari (0 bilan ham). */
export async function inspectorRows(scope: ScopeUser, entWhere: any, onlyId?: string): Promise<InspectorRow[]> {
  const month = currentMonthUz()
  const mb = monthBoundsUz(month)!
  const day = dayBoundsUz(todayUz())!
  const payments = await db.ekoHisobPayment.findMany({
    where: { entity: entWhere, paidAt: { gte: mb.start, lt: mb.end }, ...(onlyId ? { receivedBy: onlyId } : {}) },
    select: { amount: true, receivedBy: true, paidAt: true },
  })
  const userWhere: any = { orgId: scope.orgId, role: 'inspector', isActive: true, isMirror: false }
  if (scope.role !== 'admin') userWhere.districts = { some: { districtId: { in: scope.districtIds } } }
  if (onlyId) userWhere.id = onlyId
  const users = await db.ekoHisobUser.findMany({ where: userWhere, select: { id: true, fullName: true } })
  const known = new Set<string>(users.map((u: any) => u.id))
  const extraIds = [...new Set<string>(payments.map((p: any) => p.receivedBy))].filter(id => !known.has(id))
  if (extraIds.length) {
    const more = await db.ekoHisobUser.findMany({
      where: { id: { in: extraIds }, orgId: scope.orgId }, select: { id: true, fullName: true },
    })
    users.push(...more)
  }
  const ids = users.map((u: any) => u.id)
  const todayDate = parseDateOnly(todayUz())!
  const [plans, created] = await Promise.all([
    db.ekoHisobPlan.findMany({ where: { inspectorId: { in: ids }, date: todayDate, type: 'new_entity' }, select: { inspectorId: true, targetCount: true } }),
    db.ekoHisobLegalEntity.groupBy({
      by: ['createdBy'], where: { orgId: scope.orgId, createdBy: { in: ids }, createdAt: { gte: day.start, lt: day.end } },
      _count: { _all: true },
    }),
  ])
  const planBy = new Map<string, number>(plans.map((p: any) => [p.inspectorId, p.targetCount]))
  const newBy = new Map<string, number>(created.map((c: any) => [c.createdBy, c._count._all]))
  return users.map((u: any): InspectorRow => {
    const mine = payments.filter((p: any) => p.receivedBy === u.id)
    const today = mine.filter((p: any) => p.paidAt >= day.start && p.paidAt < day.end)
    const last = mine.reduce((m: Date | null, p: any) => (!m || p.paidAt > m ? p.paidAt : m), null)
    return {
      id: u.id, name: u.fullName,
      monthSum: mine.reduce((s: number, p: any) => s + p.amount, 0), monthCnt: mine.length,
      todaySum: today.reduce((s: number, p: any) => s + p.amount, 0), todayCnt: today.length,
      lastPaidAt: last, planTarget: planBy.get(u.id) ?? null, newToday: newBy.get(u.id) ?? 0,
    }
  })
}

export async function districtOverview(scope: ScopeUser) {
  const month = currentMonthUz()
  const mb = monthBoundsUz(month)!
  const day = dayBoundsUz(todayUz())!
  const entWhere = { ...entityScopeWhere(scope), status: 'active' }
  const [entities, monthPays, paidEnts, todayAgg] = await Promise.all([
    db.ekoHisobLegalEntity.findMany({ where: entWhere, select: { monthlyFee: true, billingMode: true } }),
    db.ekoHisobPayment.aggregate({ where: { entity: entWhere, paidAt: { gte: mb.start, lt: mb.end } }, _sum: { amount: true } }),
    db.ekoHisobPayment.findMany({ where: { entity: entWhere, month }, distinct: ['entityId'], select: { entityId: true } }),
    db.ekoHisobPayment.aggregate({ where: { entity: entWhere, paidAt: { gte: day.start, lt: day.end } }, _sum: { amount: true } }),
  ])
  const inspectors = await inspectorRows(scope, entWhere)
  return {
    month, totalEnt: entities.length, paidEnts: paidEnts.length,
    collectedMonth: monthPays._sum.amount || 0, collectedToday: todayAgg._sum.amount || 0,
    expected: entities.filter((e: any) => e.billingMode === 'monthly_fixed').reduce((s: number, e: any) => s + (e.monthlyFee || 0), 0),
    inspectors, entWhere,
  }
}
