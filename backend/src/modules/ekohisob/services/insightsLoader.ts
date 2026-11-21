// EkoHisob robot: bazadan Snapshot yig'ish. Tenant + tuman doirasi FAQAT ekoScope orqali
// (entityScopeWhere) — boshqa korxona yoki boshqa tuman yozuvi Snapshot'ga tushmaydi.
import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { ScopeUser, entityScopeWhere, isEkoAdmin } from '../lib/ekoScope'
import { queryEntityDebts, queryPaidMonthsByEntity } from '../lib/reportQueries'
import { evaluationMonths } from '../lib/monitoringMath'
import { currentMonthUz, shiftMonth } from '../lib/uzt'
import { getSmsUsage } from './smsGateway'
import type { Snapshot, EntitySnap } from '../lib/insights/types'

const DAY = 86_400_000
const MAX_ENTITIES = 20000

const p = prisma as any

export async function loadInsightsSnapshot(user: ScopeUser, now: Date = new Date()): Promise<Snapshot> {
  const orgId = user.orgId
  const fullScope = isEkoAdmin(user)
  const scope = entityScopeWhere(user)
  const ago = (d: number) => new Date(now.getTime() - d * DAY)
  const month = currentMonthUz(now)

  const rawEntities: any[] = await p.ekoHisobLegalEntity.findMany({
    where: scope,
    select: {
      id: true, name: true, status: true, billingMode: true, monthlyFee: true, cubicPrice: true,
      phone: true, lat: true, lon: true, mahallId: true, stir: true, entityType: true, districtId: true,
      debtLevel: true, smsOptOut: true, createdAt: true,
      district: { select: { name: true } },
    },
    take: MAX_ENTITIES,
    orderBy: { createdAt: 'desc' },
  })
  const ids = rawEntities.map(e => e.id)
  const idSet = new Set<string>(ids)
  const debts = await queryEntityDebts(rawEntities.filter(e => e.status !== 'inactive').map(e => e.id), orgId)

  const entities: EntitySnap[] = rawEntities.map(e => {
    const d = debts.get(e.id)
    return {
      id: e.id, name: e.name, status: e.status, billingMode: e.billingMode,
      monthlyFee: Number(e.monthlyFee) || 0, cubicPrice: Number(e.cubicPrice) || 0,
      phone: e.phone ?? null, lat: e.lat ?? null, lon: e.lon ?? null, mahallId: e.mahallId ?? null,
      stir: e.stir ?? null, entityType: e.entityType ?? 'legal', districtId: e.districtId,
      districtName: e.district?.name ?? null, debtLevel: e.debtLevel ?? 'current', smsOptOut: !!e.smsOptOut,
      createdAt: e.createdAt,
      debt: d?.debt ?? 0, debtMonths: d?.months ?? 0, oldestDebtMonth: d?.oldest ?? null,
    }
  })

  const settings = await p.ekoHisobOrgSettings.findUnique({ where: { orgId } }).catch(() => null)
  const evalMonths = evaluationMonths(12, now, settings?.paymentDueDay)

  const entityRel = { entity: scope }

  const [payments, everPaidRows, voided, talons, visits, sms, audit, blacklist, suggested, paid, users] = await Promise.all([
    p.ekoHisobPayment.findMany({
      where: { ...entityRel, paidAt: { gte: ago(120) } },
      select: { id: true, entityId: true, month: true, amount: true, paidAt: true, receivedBy: true, groupId: true, method: true, receipt: { select: { id: true } } },
    }),
    p.ekoHisobPayment.findMany({ where: entityRel, select: { entityId: true }, distinct: ['entityId'] }),
    p.ekoHisobReceipt.findMany({
      where: { orgId, ...entityRel, voidedAt: { gte: ago(30) } },
      select: { id: true, receiptNumber: true, entityId: true, amount: true, month: true, issuedBy: true, issuedAt: true, voidedAt: true, voidedBy: true, voidReason: true },
    }),
    p.ekoHisobTalon.findMany({
      where: { orgId, ...entityRel, createdAt: { gte: ago(180) } },
      select: { id: true, entityId: true, volume: true, amount: true, date: true, paid: true, paidAmount: true, paymentId: true, createdBy: true, createdAt: true },
    }),
    p.ekoHisobVisit.findMany({
      where: { orgId, createdAt: { gte: ago(120) } },
      select: { id: true, entityId: true, userId: true, kind: true, promisedDate: true, lat: true, lon: true, createdAt: true },
    }),
    p.ekoHisobSmsLog.findMany({
      where: { orgId, createdAt: { gte: ago(60) }, entityId: { not: null } },
      select: { entityId: true, status: true, createdAt: true, error: true },
    }),
    p.ekoHisobAuditLog.findMany({
      where: { orgId, createdAt: { gte: ago(60) }, action: { in: ['entity.update', 'entity.billing_mode'] } },
      select: { id: true, action: true, userId: true, userName: true, targetId: true, targetName: true, details: true, createdAt: true },
    }),
    p.ekoHisobBlacklist.findMany({ where: entityRel, select: { entityId: true, status: true, addedAt: true } }),
    p.ekoHisobEscalationLog.findMany({
      where: { orgId, action: 'blacklist_suggest', status: 'done' },
      select: { entityId: true, createdAt: true },
    }),
    queryPaidMonthsByEntity(user, ['active'], evalMonths),
    p.ekoHisobUser.findMany({
      where: { orgId, isMirror: false },
      select: { id: true, fullName: true, role: true, isActive: true, createdAt: true, districts: { select: { districtId: true } }, botLink: { select: { id: true } } },
    }),
  ])

  // Talonga bog'langan to'lov hali bormi
  const talonPayIds = [...new Set<string>(talons.map((t: any) => t.paymentId).filter(Boolean))]
  const livePay = talonPayIds.length
    ? new Set<string>((await p.ekoHisobPayment.findMany({ where: { id: { in: talonPayIds } }, select: { id: true } })).map((x: any) => x.id))
    : new Set<string>()

  // Oylik hisobdagi "to'langan" ≠ to'lovlar yig'indisi (oxirgi 12 oy)
  const distCond = fullScope ? Prisma.empty : Prisma.sql`AND e."districtId" IN (${Prisma.join(user.districtIds.length ? user.districtIds : ['__none__'])})`
  const mismatchRows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT c."entityId" AS "entityId", c."month" AS month, c."expectedAmount" AS exp, c."paidAmount" AS cp,
           COALESCE(SUM(pm."amount"), 0)::bigint AS ps
    FROM "ekohisob_charges" c
    JOIN "ekohisob_legal_entities" e ON e."id" = c."entityId"
    LEFT JOIN "ekohisob_payments" pm ON pm."entityId" = c."entityId" AND pm."month" = c."month"
    WHERE e."orgId" = ${orgId} ${distCond} AND e."status" <> 'inactive' AND c."month" >= ${shiftMonth(month, -12)}
    GROUP BY c."id", c."entityId", c."month", c."expectedAmount", c."paidAmount"
    HAVING c."paidAmount" <> COALESCE(SUM(pm."amount"), 0)
    LIMIT 2000`).catch(() => [] as any[])

  // Joriy oyga hisob yozilmagan monthly_fixed tashkilotlar (faqat butun korxona ko'zi bilan)
  const missingRows = fullScope
    ? await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT e."id" FROM "ekohisob_legal_entities" e
        WHERE e."orgId" = ${orgId} AND e."status" = 'active' AND e."billingMode" = 'monthly_fixed' AND e."monthlyFee" > 0
          AND (e."contractStartMonth" IS NULL OR e."contractStartMonth" <= ${month})
          AND e."createdAt" < ${ago(1)}
          AND NOT EXISTS (SELECT 1 FROM "ekohisob_charges" c WHERE c."entityId" = e."id" AND c."month" = ${month})
        LIMIT 5000`).catch(() => [] as any[])
    : []

  // Xodimlarning oxirgi faolligi: to'lov, tashrif yoki tashkilot kiritish
  const userIds = users.map((u: any) => u.id)
  const lastAct = new Map<string, Date>()
  const bump = (id: string | null, d: Date | null) => {
    if (!id || !d) return
    const cur = lastAct.get(id)
    if (!cur || d > cur) lastAct.set(id, d)
  }
  if (fullScope && userIds.length) {
    const [pa, va, ea] = await Promise.all([
      p.ekoHisobPayment.groupBy({ by: ['receivedBy'], where: { receivedBy: { in: userIds } }, _max: { paidAt: true } }),
      p.ekoHisobVisit.groupBy({ by: ['userId'], where: { orgId, userId: { in: userIds } }, _max: { createdAt: true } }),
      p.ekoHisobLegalEntity.groupBy({ by: ['createdBy'], where: { orgId, createdBy: { in: userIds } }, _max: { createdAt: true } }),
    ])
    pa.forEach((r: any) => bump(r.receivedBy, r._max.paidAt))
    va.forEach((r: any) => bump(r.userId, r._max.createdAt))
    ea.forEach((r: any) => bump(r.createdBy, r._max.createdAt))
  }

  // Tizim holati (faqat admin uchun kerak)
  let smsLimit = 0, smsUsed = 0, kpiConfigured = false, prevKpiStatus: string | null = null
  if (fullScope) {
    const [usage, kpiCount, prevPeriod] = await Promise.all([
      getSmsUsage(orgId, now).catch(() => null),
      p.ekoHisobKpiIndicator.count({ where: { orgId, isActive: true } }).catch(() => 0),
      p.ekoHisobKpiPeriod.findUnique({ where: { orgId_month: { orgId, month: shiftMonth(month, -1) } }, select: { status: true } }).catch(() => null),
    ])
    smsLimit = usage?.monthlyLimit ?? 0
    smsUsed = usage?.usedMonthSegments ?? 0
    kpiConfigured = kpiCount > 0
    prevKpiStatus = prevPeriod?.status ?? null
  }

  return {
    now,
    fullScope,
    entities,
    payments: payments.map((x: any) => ({
      id: x.id, entityId: x.entityId, month: x.month, amount: Number(x.amount) || 0, paidAt: x.paidAt,
      receivedBy: x.receivedBy, groupId: x.groupId ?? null, method: x.method, hasReceipt: !!x.receipt,
    })),
    everPaid: new Set<string>(everPaidRows.map((x: any) => x.entityId)),
    voidedReceipts: voided.map((r: any) => ({
      id: r.id, receiptNumber: r.receiptNumber, entityId: r.entityId, amount: Number(r.amount) || 0, month: r.month,
      issuedBy: r.issuedBy, issuedAt: r.issuedAt, voidedAt: r.voidedAt, voidedBy: r.voidedBy ?? null, voidReason: r.voidReason ?? null,
    })),
    talons: talons.map((t: any) => ({
      id: t.id, entityId: t.entityId, volume: Number(t.volume) || 0, amount: Number(t.amount) || 0, date: t.date,
      paid: !!t.paid, paidAmount: Number(t.paidAmount) || 0, paymentId: t.paymentId ?? null,
      paymentExists: !!t.paymentId && livePay.has(t.paymentId), createdBy: t.createdBy ?? null, createdAt: t.createdAt,
    })),
    chargeMismatches: mismatchRows.map(r => ({
      entityId: r.entityId, month: r.month, expected: Number(r.exp) || 0, chargePaid: Number(r.cp) || 0, paymentsSum: Number(r.ps) || 0,
    })),
    missingCharges: missingRows.map(r => r.id).filter((id: string) => idSet.has(id)),
    visits: visits.filter((v: any) => idSet.has(v.entityId)).map((v: any) => ({
      id: v.id, entityId: v.entityId, userId: v.userId, kind: v.kind,
      promisedDate: v.promisedDate ? new Date(v.promisedDate).toISOString().slice(0, 10) : null,
      lat: v.lat ?? null, lon: v.lon ?? null, createdAt: v.createdAt,
    })),
    sms: sms.filter((s: any) => idSet.has(s.entityId)).map((s: any) => ({ entityId: s.entityId, status: s.status, createdAt: s.createdAt, error: s.error ?? null })),
    audit: audit.filter((a: any) => a.targetId && idSet.has(a.targetId)),
    users: users.map((u: any) => ({
      id: u.id, fullName: u.fullName, role: u.role, isActive: !!u.isActive,
      districtIds: (u.districts ?? []).map((d: any) => d.districtId), botLinked: !!u.botLink,
      createdAt: u.createdAt, lastActivityAt: lastAct.get(u.id) ?? null,
    })),
    blacklist: blacklist.map((b: any) => ({ entityId: b.entityId, status: b.status, addedAt: b.addedAt })),
    blacklistSuggested: suggested.filter((x: any) => idSet.has(x.entityId)).map((x: any) => ({ entityId: x.entityId, at: x.createdAt })),
    evalMonths,
    paidMonths: new Map(paid.map(v => [v.entityId, { months: v.paidMonths, avg: v.count > 0 ? v.total / v.count : 0 }])),
    org: {
      smsAutoEnabled: !!settings?.smsAutoEnabled,
      smsAutoDay: Number(settings?.smsAutoDay) || 10,
      smsAutoLastMonth: settings?.smsAutoLastMonth ?? null,
      smsLimit, smsUsedThisMonth: smsUsed, kpiConfigured, prevKpiStatus,
    },
  }
}
