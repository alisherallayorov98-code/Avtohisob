// Rahbarga "So what?" Telegram xabarlari:
//  (a) ertalabki xulosa (kecha kassa, oy rejasi, yangi 3+ oy qarzdorlar, bugun hech narsa
//      kiritmagan inspektorlar, va'dasi bugun/o'tgan tashkilotlar) — harakat bo'lmasa YUBORILMAYDI;
//  (b) haftalik: yaqinda to'xtagan eng qimmat mijozlar.
//
// Qabul qiluvchi doirasi (ekoScope qoidasi): admin — butun korxona; boshliq — FAQAT o'z tumanlari
// (tumani yo'q — hech narsa). Bir doira uchun hisob BIR marta bajariladi. Matn — lib/managerDigestFormat.ts.

import { prisma } from '../../../lib/prisma'
import { sendEkoMessage } from '../../../services/ekoFieldBot'
import { loadEntityDebts } from './entityDebtLoader'
import {
  formatManagerMorning, selectDuePromises, findChurned, formatChurnWeekly,
  MorningDigestInput,
} from '../lib/managerDigestFormat'
import { todayUz, dayBoundsUz, currentMonthUz, uztParts, parseDateOnly } from '../lib/uzt'
import { addDaysIso } from '../lib/planMath'
import { isInSendWindow } from '../lib/smsBudget'
import { entityScopeWhere } from '../lib/ekoScope'

interface Recipient { chatId: string; orgId: string; role: string; districtIds: string[] }

async function loadRecipients(): Promise<Recipient[]> {
  const links = await (prisma as any).ekoHisobBotLink.findMany({
    where: { user: { isActive: true, isMirror: false, role: { in: ['admin', 'supervisor'] } } },
    select: {
      chatId: true,
      user: { select: { orgId: true, role: true, districts: { select: { districtId: true } } } },
    },
  }).catch(() => [] as any[])
  return links
    .map((l: any): Recipient => ({
      chatId: l.chatId, orgId: l.user.orgId, role: l.user.role,
      districtIds: [...new Set<string>(l.user.districts.map((d: any) => d.districtId))].sort(),
    }))
    // Boshliq tumansiz — hech narsa ko'rmaydi (ekoScope)
    .filter((r: Recipient) => r.role === 'admin' || r.districtIds.length > 0)
}

const scopeKey = (r: Recipient) => `${r.orgId}|${r.role === 'admin' ? '*' : r.districtIds.join(',')}`

async function eachScope(
  job: (scope: Recipient, chats: string[]) => Promise<string | null>,
): Promise<void> {
  const recipients = await loadRecipients()
  const groups = new Map<string, { scope: Recipient; chats: string[] }>()
  for (const r of recipients) {
    const k = scopeKey(r)
    const g = groups.get(k) ?? { scope: r, chats: [] }
    g.chats.push(r.chatId)
    groups.set(k, g)
  }
  for (const { scope, chats } of groups.values()) {
    try {
      const text = await job(scope, chats)
      if (!text) continue // "So what?" — bo'sh
      for (const chatId of chats) await sendEkoMessage(chatId, text).catch(() => false)
    } catch (e: any) {
      console.error(`[EkoManagerDigest] doira ${scopeKey(scope)} xato:`, e?.message ?? e)
    }
  }
}

const entityWhere = (s: Recipient) =>
  entityScopeWhere({ role: s.role, orgId: s.orgId, districtIds: s.districtIds })

/** Ertalabki xulosa matnini tuzadi (yuborilmasa null). */
async function buildMorning(scope: Recipient, now: Date): Promise<string | null> {
  const db = prisma as any
  const eWhere = entityWhere(scope)
  const today = todayUz(now)
  const yesterday = addDaysIso(today, -1)
  const yb = dayBoundsUz(yesterday)!
  const tb = dayBoundsUz(today)!
  const month = currentMonthUz(now)

  const [yAgg, mAgg, critLogs, inspectors] = await Promise.all([
    db.ekoHisobPayment.aggregate({
      where: { paidAt: { gte: yb.start, lt: yb.end }, amount: { gt: 0 }, entity: eWhere },
      _sum: { amount: true }, _count: { _all: true },
    }),
    db.ekoHisobCharge.aggregate({
      where: { month, entity: eWhere },
      _sum: { expectedAmount: true, paidAmount: true },
    }),
    db.ekoHisobEscalationLog.findMany({
      where: {
        orgId: scope.orgId, action: 'critical_seen', level: 'critical',
        createdAt: { gte: new Date(now.getTime() - 26 * 3600_000) },
      },
      select: { entityId: true },
    }),
    db.ekoHisobUser.findMany({
      where: {
        orgId: scope.orgId, role: 'inspector', isActive: true, isMirror: false,
        ...(scope.role === 'admin' ? {} : { districts: { some: { districtId: { in: scope.districtIds } } } }),
      },
      select: { id: true, fullName: true },
    }),
  ])

  // Yangi 3+ oy qarzdorlar (hali ham critical va faol)
  const critIds = critLogs.map((l: any) => l.entityId)
  const critEntities = critIds.length
    ? await db.ekoHisobLegalEntity.findMany({
        where: { ...eWhere, id: { in: critIds }, status: 'active', debtLevel: 'critical' },
        select: { id: true, name: true, billingMode: true },
      })
    : []
  const critDebts = await loadEntityDebts(critEntities, scope.orgId)
  const newCritical = critEntities.map((e: any) => ({
    name: e.name,
    debt: critDebts.get(e.id)!.totalDebt,
  }))

  // Bugun hech narsa kiritmagan inspektorlar
  const ids = inspectors.map((u: any) => u.id)
  let idleInspectors: string[] = []
  if (ids.length > 0) {
    const [pays, ents, visits] = await Promise.all([
      db.ekoHisobPayment.groupBy({ by: ['receivedBy'], where: { receivedBy: { in: ids }, paidAt: { gte: tb.start, lt: tb.end } } }),
      db.ekoHisobLegalEntity.groupBy({ by: ['createdBy'], where: { orgId: scope.orgId, createdBy: { in: ids }, createdAt: { gte: tb.start, lt: tb.end } } }),
      db.ekoHisobVisit.groupBy({ by: ['userId'], where: { orgId: scope.orgId, userId: { in: ids }, createdAt: { gte: tb.start, lt: tb.end } } }),
    ])
    const active = new Set<string>([
      ...pays.map((r: any) => r.receivedBy), ...ents.map((r: any) => r.createdBy), ...visits.map((r: any) => r.userId),
    ])
    idleInspectors = inspectors.filter((u: any) => !active.has(u.id)).map((u: any) => u.fullName).sort()
  }

  // Va'dasi bugun/o'tgan
  const todayDate = parseDateOnly(today)!
  const visits = await db.ekoHisobVisit.findMany({
    where: {
      orgId: scope.orgId, kind: 'promised', promisedDate: { lte: todayDate },
      createdAt: { gte: new Date(now.getTime() - 30 * 24 * 3600_000) },
      entityId: { in: (await db.ekoHisobLegalEntity.findMany({
        where: { ...eWhere, status: 'active', debtLevel: { in: ['warning', 'overdue', 'critical'] } },
        select: { id: true },
      })).map((e: any) => e.id) },
    },
    select: { entityId: true, promisedDate: true, createdAt: true },
    take: 2000,
  })
  let promises: ReturnType<typeof selectDuePromises> = []
  if (visits.length > 0) {
    const entIds = [...new Set<string>(visits.map((v: any) => v.entityId))]
    const [ents, lastPays] = await Promise.all([
      db.ekoHisobLegalEntity.findMany({
        where: { id: { in: entIds }, ...eWhere },
        select: { id: true, name: true, billingMode: true },
      }),
      db.ekoHisobPayment.groupBy({ by: ['entityId'], where: { entityId: { in: entIds } }, _max: { paidAt: true } }),
    ])
    const promiseDebts = await loadEntityDebts(ents, scope.orgId)
    promises = selectDuePromises({
      today,
      visits: visits.map((v: any) => ({
        entityId: v.entityId, promisedDate: v.promisedDate.toISOString().slice(0, 10), createdAt: v.createdAt,
      })),
      entities: new Map(ents.map((e: any) => [e.id, {
        name: e.name,
        debt: promiseDebts.get(e.id)!.totalDebt,
      }])),
      lastPaymentAt: new Map(lastPays.filter((p: any) => p._max.paidAt).map((p: any) => [p.entityId, p._max.paidAt])),
    })
  }

  const input: MorningDigestInput = {
    yesterday,
    yesterdayCollected: yAgg._sum.amount ?? 0,
    yesterdayCount: yAgg._count._all ?? 0,
    monthCollected: mAgg._sum.paidAmount ?? 0,
    monthExpected: mAgg._sum.expectedAmount ?? 0,
    newCritical, idleInspectors, promises,
  }
  return formatManagerMorning(input)
}

/** Dushanba–shanba 11:00 UZT: ertalabki xulosa. Yakshanba o'tkaziladi. */
export async function sendManagerMorningDigest(now: Date = new Date()): Promise<void> {
  const p = uztParts(now)!
  if (!isInSendWindow(p.hour)) return
  // Yakshanba (UZT): ish kuni emas — "hech narsa kiritmagan" mazmunsiz
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
  if (dow === 0) return
  await eachScope((scope) => buildMorning(scope, now))
}

/** Dushanba 10:30 UZT: yaqinda to'xtagan eng qimmat mijozlar. */
export async function sendChurnWeekly(now: Date = new Date()): Promise<void> {
  if (!isInSendWindow(uztParts(now)!.hour)) return
  const month = currentMonthUz(now)
  await eachScope(async (scope) => {
    const db = prisma as any
    const rows = await db.ekoHisobPayment.groupBy({
      by: ['entityId', 'month'],
      where: { amount: { gt: 0 }, entity: { ...entityWhere(scope), status: 'active' } },
      _sum: { amount: true },
    })
    if (rows.length === 0) return null
    const ids = [...new Set<string>(rows.map((r: any) => r.entityId))]
    const ents = await db.ekoHisobLegalEntity.findMany({
      where: { id: { in: ids }, ...entityWhere(scope) }, select: { id: true, name: true },
    })
    const names = new Map<string, string>(ents.map((e: any) => [e.id, e.name]))
    const churned = findChurned(
      rows.map((r: any) => ({ entityId: r.entityId, name: names.get(r.entityId) ?? '—', month: r.month, amount: r._sum.amount ?? 0 })),
      { currentMonth: month },
    )
    return formatChurnWeekly(churned)
  })
}
