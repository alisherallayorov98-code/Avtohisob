// EkoHisob qarz eskalatsiyasi — amallarni bajaruvchi servis.
//
// Ikki bosqich (vaqt oynasi uchun):
//  1. Kechasi (02:30 UZT) `updateEkoDebtLevels` darajalarni yangilaydi va daraja OSHGANLARNI
//     `enqueueEscalations` orqali jurnalga 'pending' qilib qo'yadi (SMS/Telegram yuborilmaydi).
//  2. Kunduzi 10:00–18:00 UZT oynasida `processPendingEscalations` navbatni bajaradi.
//
// Har amal `EkoHisobEscalationLog` (entityId+level+action UNIQUE) bilan himoyalangan:
//  - status 'done'   — bajarilgan, qayta yurmaydi;
//  - status 'pending'/'failed' (attempts < 3) — keyingi ishga tushishda qayta uriniladi;
//  - markDone FAQAT muvaffaqiyatda; xato ('inspektor ulanmagan', SMS xatosi) → 'failed', attempts++.
// Tashkilot to'lab darajasi pasaysa jurnali tozalanadi — keyin yana qarzdor bo'lsa qayta ishlaydi.

import { prisma } from '../../../lib/prisma'
import { sendEkoMessage } from '../../../services/ekoFieldBot'
import {
  mergeRules, decideActions, EscalationAction, EscalationRule, levelRank,
} from '../lib/escalation'
import {
  renderSmsTemplate, formatSmsAmount, DEFAULT_SMS_TEMPLATE,
} from '../lib/smsTemplate'
import {
  decideEscalationRow, MAX_ESCALATION_ATTEMPTS, ESCALATION_COOLDOWN_HOURS, escalationPeriodKey,
  isInSendWindow, shouldAbortBatch,
} from '../lib/smsBudget'
import { getOrgSettings } from './orgSettings'
import { sendBudgetedSms } from './smsGateway'
import { queryEntityDebts } from '../lib/reportQueries'
import { uzNum as fmt, uzMonth } from '../lib/dateFormat'
import { currentMonthUz, uztParts } from '../lib/uzt'

export interface LevelTransition {
  entityId: string
  orgId: string
  oldLevel: string
  newLevel: string
}

/** Korxona eskalatsiya qoidalari (DB + standart) */
async function loadRules(orgId: string): Promise<Record<string, EscalationRule>> {
  const rows = await (prisma as any).ekoHisobEscalationRule.findMany({
    where: { orgId },
  }).catch(() => [] as any[])
  return mergeRules(rows)
}

// ─── 1-bosqich: navbatga qo'yish (kechasi, hech narsa yuborilmaydi) ─────────

/**
 * Daraja oshgan tashkilotlar uchun sozlangan amallarni 'pending' qilib jurnalga yozadi.
 * Korxonada escalationEnabled o'chiq bo'lsa hech narsa yozilmaydi.
 * Qo'shimcha: 'critical' ga o'tishlar eskalatsiya yoqilmagan bo'lsa ham `critical_seen`
 * deb qayd etiladi (rahbarga ertalabki xulosadagi "yangi 3+ oy qarzdorlar" uchun).
 */
export async function enqueueEscalations(transitions: LevelTransition[]): Promise<void> {
  if (transitions.length === 0) return
  const db = prisma as any

  // critical_seen — sozlamadan mustaqil
  const critical = transitions.filter(t => t.newLevel === 'critical')
  if (critical.length > 0) {
    await db.ekoHisobEscalationLog.createMany({
      data: critical.map(t => ({
        orgId: t.orgId, entityId: t.entityId, level: 'critical', action: 'critical_seen',
        status: 'done', attempts: 1,
      })),
      skipDuplicates: true,
    }).catch((e: any) => console.error('[EkoEscalation] critical_seen yozilmadi:', e?.message ?? e))
  }

  const byOrg = new Map<string, LevelTransition[]>()
  for (const t of transitions) {
    const list = byOrg.get(t.orgId) ?? []
    list.push(t)
    byOrg.set(t.orgId, list)
  }

  for (const [orgId, list] of byOrg) {
    try {
      const settings = await getOrgSettings(orgId)
      if (!settings.escalationEnabled) continue
      const rules = await loadRules(orgId)
      const data: any[] = []
      for (const t of list) {
        for (const action of decideActions(t.newLevel, rules)) {
          data.push({ orgId, entityId: t.entityId, level: t.newLevel, action, status: 'pending', attempts: 0 })
        }
      }
      if (data.length > 0) {
        await db.ekoHisobEscalationLog.createMany({ data, skipDuplicates: true })
      }
    } catch (e: any) {
      console.error(`[EkoEscalation] navbatga qo'yish org=${orgId} xato:`, e?.message ?? e)
    }
  }
}

// ─── 2-bosqich: oynada bajarish ──────────────────────────────────────────────

let processing = false

interface RowCtx {
  id: string
  orgId: string
  entityId: string
  level: string
  action: string
  attempts: number
}

interface DigestItem { rowId: string; name: string; level: string; debt: number }

async function setRow(
  id: string, status: 'done' | 'failed' | 'pending', detail: string | null, attempts?: number,
): Promise<void> {
  await (prisma as any).ekoHisobEscalationLog.update({
    where: { id },
    data: { status, detail, ...(attempts !== undefined ? { attempts } : {}) },
  }).catch((e: any) => console.error(`[EkoEscalation] qator yangilanmadi (${id}):`, e?.message ?? e))
}

/**
 * Navbatdagi ('pending' / 'failed', urinish < 3) amallarni bajaradi.
 * Faqat 10:00–18:00 UZT oynasida ishlaydi (oynadan tashqarida hech narsa qilmaydi).
 */
export async function processPendingEscalations(now: Date = new Date()): Promise<void> {
  const parts = uztParts(now)!
  if (!isInSendWindow(parts.hour)) return
  if (processing) return
  processing = true
  try {
    const db = prisma as any
    const rows: RowCtx[] = await db.ekoHisobEscalationLog.findMany({
      where: { status: { in: ['pending', 'failed'] }, attempts: { lt: MAX_ESCALATION_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: 1000,
      select: { id: true, orgId: true, entityId: true, level: true, action: true, attempts: true },
    }).catch(() => [] as any[])
    if (rows.length === 0) return

    const byOrg = new Map<string, RowCtx[]>()
    for (const r of rows) {
      if (!['sms', 'inspector', 'manager', 'blacklist_suggest'].includes(r.action)) continue
      const list = byOrg.get(r.orgId) ?? []
      list.push(r)
      byOrg.set(r.orgId, list)
    }
    for (const [orgId, list] of byOrg) {
      await processOrg(orgId, list, now).catch((e: any) =>
        console.error(`[EkoEscalation] org=${orgId} xato:`, e?.message ?? e))
    }
  } finally {
    processing = false
  }
}

async function processOrg(orgId: string, rows: RowCtx[], now: Date): Promise<void> {
  const db = prisma as any
  const settings = await getOrgSettings(orgId)
  if (!settings.escalationEnabled) return
  const rules = await loadRules(orgId)
  const month = currentMonthUz(now)

  // Tashkilotlar va qarzlarni bir marta yuklaymiz
  const entityIds = [...new Set(rows.map(r => r.entityId))]
  const entities: any[] = await db.ekoHisobLegalEntity.findMany({
    where: { id: { in: entityIds }, orgId },
    select: {
      id: true, name: true, phone: true, billingMode: true, status: true, debtLevel: true,
      districtId: true, mahalla: { select: { name: true } },
    },
  })
  const entMap = new Map<string, any>(entities.map(e => [e.id, e]))
  const debtMap = new Map<string, { total: number; oldest: string | null }>()
  // Kanonik qarz (SQL, tashkilot ichida netto; avans eng eski qarzni qoplaydi)
  const canon = await queryEntityDebts(entities.map(e => e.id), orgId)
  for (const e of entities) {
    const d = canon.get(e.id)
    debtMap.set(e.id, { total: d?.debt ?? 0, oldest: d?.oldest ?? null })
  }

  // Byudjet ustuvorligi: yuqori daraja, katta qarz birinchi
  const ordered = [...rows].sort((a, b) =>
    levelRank(b.level) - levelRank(a.level)
    || (debtMap.get(b.entityId)?.total ?? 0) - (debtMap.get(a.entityId)?.total ?? 0)
    || (a.id < b.id ? -1 : 1))

  const digest: DigestItem[] = []
  let smsStopped = false
  let consecutiveTransient = 0

  for (const row of ordered) {
    const ent = entMap.get(row.entityId)
    // Eskirgan: tashkilot yo'q/faol emas, yoki daraja o'zgargan, yoki qoida o'chirilgan
    if (!ent || ent.status !== 'active') { await setRow(row.id, 'done', 'tashkilot faol emas', row.attempts); continue }
    if (ent.debtLevel !== row.level) { await setRow(row.id, 'done', 'daraja o\'zgargan', row.attempts); continue }
    if (!decideActions(row.level, rules).includes(row.action as EscalationAction)) {
      await setRow(row.id, 'done', 'qoida o\'chirilgan', row.attempts); continue
    }
    const debt = debtMap.get(row.entityId)?.total ?? 0
    if (debt <= 0) { await setRow(row.id, 'done', 'qarz yo\'q', row.attempts); continue }

    if (decideEscalationRow({ status: 'pending', attempts: row.attempts }) !== 'try') continue

    if (row.action === 'sms') {
      if (smsStopped) continue
      const message = renderSmsTemplate(settings.smsTemplate ?? DEFAULT_SMS_TEMPLATE, {
        tashkilot: ent.name,
        qarz: formatSmsAmount(debt),
        oy: debtMap.get(row.entityId)?.oldest ? uzMonth(debtMap.get(row.entityId)!.oldest) : '',
        aloqa: settings.contactPhone ?? '',
      })
      const out = await sendBudgetedSms({
        orgId, entityId: row.entityId, kind: 'escalation', message, sentBy: null,
        periodKey: escalationPeriodKey(month, row.level), dedupKinds: ['escalation'],
        cooldownHours: ESCALATION_COOLDOWN_HOURS, now,
      })
      if (out.status === 'sent') { consecutiveTransient = 0; await setRow(row.id, 'done', null, row.attempts + 1); continue }
      if (out.status === 'skipped') {
        const r = out.reason
        if (r === 'monthly_limit' || r === 'daily_limit' || r === 'not_configured') {
          smsStopped = true // pending qoladi — byudjet bo'shaganda (ertaga/keyingi oy) davom etadi
          continue
        }
        if (r === 'cooldown') continue // yaqinda SMS yuborilgan — keyinroq
        await setRow(row.id, 'done', `o'tkazildi: ${r}`, row.attempts + 1)
        continue
      }
      // failed
      await setRow(row.id, 'failed', out.error.slice(0, 300), row.attempts + 1)
      consecutiveTransient = out.errorType === 'transient' ? consecutiveTransient + 1 : 0
      if (shouldAbortBatch(out.errorType, consecutiveTransient)) smsStopped = true
      continue
    }

    if (row.action === 'inspector') {
      const links = await db.ekoHisobBotLink.findMany({
        where: { user: { orgId, isActive: true, districts: { some: { districtId: ent.districtId } } } },
        select: { chatId: true },
      }).catch(() => [] as any[])
      if (links.length === 0) { await setRow(row.id, 'failed', 'inspektor ulanmagan', row.attempts + 1); continue }

      const levelLabel = row.level === 'critical' ? 'KRITIK (3+ oy)' : row.level === 'overdue' ? 'muddati o\'tgan (2 oy)' : row.level
      const mh = ent.mahalla?.name ? ` [${ent.mahalla.name}]` : ''
      const msg = `⚠️ <b>Qarz darajasi oshdi</b>\n\n` +
        `<b>${ent.name}</b>${mh}\n` +
        `Holat: ${levelLabel}\n` +
        `Qarz: <b>${fmt(debt)} so'm</b>\n\n` +
        `📍 Borib gaplashing va natijani kiriting.`
      let delivered = 0
      for (const l of links) {
        if (await sendEkoMessage(l.chatId, msg).catch(() => false)) delivered++
      }
      if (delivered > 0) await setRow(row.id, 'done', null, row.attempts + 1)
      else await setRow(row.id, 'failed', 'Telegram yuborilmadi', row.attempts + 1)
      continue
    }

    if (row.action === 'manager') {
      digest.push({ rowId: row.id, name: ent.name, level: row.level, debt })
      continue
    }

    if (row.action === 'blacklist_suggest') {
      // Faqat belgilab qo'yamiz — qora ro'yxatga qo'shish HAR DOIM admin qo'li bilan.
      // Tavsiyalar ro'yxati GET /settings/blacklist-suggestions orqali ko'rsatiladi.
      await setRow(row.id, 'done', null, row.attempts + 1)
    }
  }

  if (digest.length > 0) {
    const ok = await notifyManagers(orgId, digest)
    for (const d of digest) {
      const att = (rows.find(r => r.id === d.rowId)?.attempts ?? 0) + 1
      if (ok) await setRow(d.rowId, 'done', null, att)
      else await setRow(d.rowId, 'failed', 'rahbar ulanmagan yoki Telegram yuborilmadi', att)
    }
  }
}

/** Rahbar(lar)ga bitta yig'ma xabar — har tashkilot uchun alohida emas. true = kamida bittasiga yetdi. */
async function notifyManagers(orgId: string, digest: DigestItem[]): Promise<boolean> {
  const links = await (prisma as any).ekoHisobBotLink.findMany({
    where: { user: { orgId, isActive: true, role: { in: ['admin', 'supervisor'] } } },
    select: { chatId: true },
  }).catch(() => [] as any[])
  if (links.length === 0) return false

  const sorted = [...digest].sort((a, b) => b.debt - a.debt)
  const totalDebt = sorted.reduce((s, d) => s + d.debt, 0)
  let msg = `📊 <b>Qarz eskalatsiyasi — yangi o'zgarishlar</b>\n\n`
  msg += `<b>${sorted.length}</b> ta tashkilot yuqori darajaga o'tdi.\n`
  msg += `Ular bo'yicha jami qarz: <b>${fmt(totalDebt)} so'm</b>\n\n`
  sorted.slice(0, 20).forEach((d, i) => {
    const label = d.level === 'critical' ? 'KRITIK' : d.level === 'overdue' ? '2 oy' : d.level
    msg += `${i + 1}. ${d.name} — ${label}, ${fmt(d.debt)} so'm\n`
  })
  if (sorted.length > 20) msg += `\n...va yana ${sorted.length - 20} ta`
  msg += `\n\nQora ro'yxat tavsiyalarini tizimda ko'rib chiqing.`

  let delivered = 0
  for (const l of links) {
    if (await sendEkoMessage(l.chatId, msg).catch(() => false)) delivered++
  }
  return delivered > 0
}

/**
 * Eski nom (moslik uchun): navbatga qo'yadi va oynada bo'lsa darhol bajaradi.
 * Yangi kod `enqueueEscalations` + `processPendingEscalations` ni alohida chaqiradi.
 */
export async function runEscalations(transitions: LevelTransition[]): Promise<void> {
  await enqueueEscalations(transitions)
  await processPendingEscalations()
}

/**
 * Daraja pasaygan tashkilotlarning eskalatsiya jurnalini tozalaydi.
 * Shu tufayli to'lab, keyin yana qarzdor bo'lgan tashkilotga eslatma qaytadan boradi.
 */
export async function clearEscalationLogs(entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return
  await (prisma as any).ekoHisobEscalationLog.deleteMany({
    where: { entityId: { in: entityIds } },
  }).catch(() => {})
}
