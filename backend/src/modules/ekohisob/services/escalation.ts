// EkoHisob qarz eskalatsiyasi — amallarni bajaruvchi servis.
//
// Kunlik cron `updateEkoDebtLevels` qarz darajalarini yangilaydi va daraja
// OSHGAN tashkilotlar ro'yxatini shu yerga uzatadi. Har amal `EkoHisobEscalationLog`
// bilan himoyalangan: bir daraja uchun bir marta bajariladi. Tashkilot to'lab
// darajasi pasaysa jurnali tozalanadi — keyin yana qarzdor bo'lsa qayta ishlaydi.

import { prisma } from '../../../lib/prisma'
import { sendEkoMessage } from '../../../services/ekoFieldBot'
import { sendSms, normalizePhone } from './sms'
import {
  mergeRules, decideActions, EscalationAction, EscalationRule,
} from '../lib/escalation'
import {
  renderSmsTemplate, formatSmsAmount, DEFAULT_SMS_TEMPLATE,
} from '../lib/smsTemplate'
import { getOrgSettings } from './orgSettings'
import { computeEntityDebt } from '../lib/debtMath'

const fmt = (n: number) => n.toLocaleString('uz-UZ')

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

/** Shu amal shu daraja uchun allaqachon bajarilganmi */
async function alreadyDone(entityId: string, level: string, action: string): Promise<boolean> {
  const found = await (prisma as any).ekoHisobEscalationLog.findUnique({
    where: { entityId_level_action: { entityId, level, action } },
  }).catch(() => null)
  return !!found
}

async function markDone(
  orgId: string, entityId: string, level: string, action: string, detail?: string,
): Promise<void> {
  await (prisma as any).ekoHisobEscalationLog.create({
    data: { orgId, entityId, level, action, detail: detail ?? null },
  }).catch(() => { /* unique konflikt — parallel ishga tushish, muammo emas */ })
}

/** Tashkilot qarzi (SMS matni uchun) */
async function entityDebt(entity: any): Promise<number> {
  const [charges, talons] = await Promise.all([
    (prisma as any).ekoHisobCharge.findMany({
      where: { entityId: entity.id, status: { in: ['open', 'partial'] } },
      select: { month: true, expectedAmount: true, paidAmount: true },
    }).catch(() => []),
    (prisma as any).ekoHisobTalon.findMany({
      where: { entityId: entity.id, paid: false },
      select: { date: true, amount: true, paid: true },
    }).catch(() => []),
  ])
  return computeEntityDebt({ billingMode: entity.billingMode, charges, talons }).totalDebt
}

/**
 * Daraja oshgan tashkilotlar uchun sozlangan amallarni bajaradi.
 * Har korxona alohida: sozlamasi o'chirilgan bo'lsa umuman tegilmaydi.
 */
export async function runEscalations(transitions: LevelTransition[]): Promise<void> {
  if (transitions.length === 0) return

  // Korxona bo'yicha guruhlaymiz — sozlama va qoidalar bir marta o'qilsin
  const byOrg = new Map<string, LevelTransition[]>()
  for (const t of transitions) {
    const list = byOrg.get(t.orgId) ?? []
    list.push(t)
    byOrg.set(t.orgId, list)
  }

  for (const [orgId, orgTransitions] of byOrg) {
    try {
      const settings = await getOrgSettings(orgId)
      if (!settings.escalationEnabled) continue

      const rules = await loadRules(orgId)
      // Rahbarga kunlik yig'ma xulosa uchun to'planadi (alohida-alohida xabar emas)
      const managerDigest: { name: string; level: string; debt: number }[] = []

      for (const t of orgTransitions) {
        const actions = decideActions(t.newLevel, rules)
        if (actions.length === 0) continue

        const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
          where: { id: t.entityId },
          select: {
            id: true, name: true, phone: true, billingMode: true,
            districtId: true, mahalla: { select: { name: true } },
          },
        }).catch(() => null)
        if (!entity) continue

        const debt = await entityDebt(entity)

        for (const action of actions) {
          if (await alreadyDone(t.entityId, t.newLevel, action)) continue
          await runAction(action, {
            orgId, settings, entity, level: t.newLevel, debt, managerDigest,
          })
        }
      }

      if (managerDigest.length > 0) {
        await notifyManagers(orgId, managerDigest)
      }
    } catch (e: any) {
      console.error(`[EkoEscalation] org=${orgId} xato:`, e?.message ?? e)
    }
  }
}

interface ActionCtx {
  orgId: string
  settings: Awaited<ReturnType<typeof getOrgSettings>>
  entity: any
  level: string
  debt: number
  managerDigest: { name: string; level: string; debt: number }[]
}

async function runAction(action: EscalationAction, ctx: ActionCtx): Promise<void> {
  const { orgId, entity, level } = ctx

  if (action === 'sms') {
    // Qarz yo'q bo'lsa yubormaymiz (daraja yangilanishi bilan to'lov orasidagi poyga)
    if (ctx.debt <= 0 || !entity.phone || !normalizePhone(entity.phone)) return
    const message = renderSmsTemplate(ctx.settings.smsTemplate ?? DEFAULT_SMS_TEMPLATE, {
      tashkilot: entity.name,
      qarz: formatSmsAmount(ctx.debt),
      aloqa: ctx.settings.contactPhone ?? '',
    })
    const result = await sendSms(entity.phone, message)
    await (prisma as any).ekoHisobSmsLog.create({
      data: {
        orgId, entityId: entity.id,
        phone: normalizePhone(entity.phone) || entity.phone,
        message,
        status: result.ok ? 'sent' : 'failed',
        providerMsgId: result.msgId ?? null,
        error: result.error ?? null,
        sentBy: null,                      // avtomatik — odam yubormagan
      },
    }).catch(() => {})
    await markDone(orgId, entity.id, level, action, result.ok ? undefined : result.error)
    return
  }

  if (action === 'inspector') {
    const links = await (prisma as any).ekoHisobBotLink.findMany({
      where: { user: { orgId, isActive: true, districts: { some: { districtId: entity.districtId } } } },
      select: { chatId: true },
    }).catch(() => [] as any[])
    if (links.length === 0) { await markDone(orgId, entity.id, level, action, 'inspektor ulanmagan'); return }

    const levelLabel = level === 'critical' ? 'KRITIK (3+ oy)' : level === 'overdue' ? 'muddati o\'tgan (2 oy)' : level
    const mh = entity.mahalla?.name ? ` [${entity.mahalla.name}]` : ''
    const msg = `⚠️ <b>Qarz darajasi oshdi</b>\n\n` +
      `<b>${entity.name}</b>${mh}\n` +
      `Holat: ${levelLabel}\n` +
      `Qarz: <b>${fmt(ctx.debt)} so'm</b>\n\n` +
      `📍 Borib gaplashing va natijani kiriting.`
    for (const l of links) await sendEkoMessage(l.chatId, msg).catch(() => {})
    await markDone(orgId, entity.id, level, action)
    return
  }

  if (action === 'manager') {
    ctx.managerDigest.push({ name: entity.name, level, debt: ctx.debt })
    await markDone(orgId, entity.id, level, action)
    return
  }

  if (action === 'blacklist_suggest') {
    // Faqat belgilab qo'yamiz — qora ro'yxatga qo'shish HAR DOIM admin qo'li bilan.
    // Tavsiyalar ro'yxati GET /escalation/suggestions orqali ko'rsatiladi.
    await markDone(orgId, entity.id, level, action)
  }
}

/** Rahbar(lar)ga bitta yig'ma xabar — har tashkilot uchun alohida emas */
async function notifyManagers(
  orgId: string,
  digest: { name: string; level: string; debt: number }[],
): Promise<void> {
  const links = await (prisma as any).ekoHisobBotLink.findMany({
    where: { user: { orgId, isActive: true, role: { in: ['admin', 'supervisor'] } } },
    select: { chatId: true },
  }).catch(() => [] as any[])
  if (links.length === 0) return

  const totalDebt = digest.reduce((s, d) => s + d.debt, 0)
  let msg = `📊 <b>Qarz eskalatsiyasi — bugungi o'zgarishlar</b>\n\n`
  msg += `<b>${digest.length}</b> ta tashkilot yuqori darajaga o'tdi.\n`
  msg += `Ular bo'yicha jami qarz: <b>${fmt(totalDebt)} so'm</b>\n\n`
  digest.slice(0, 20).forEach((d, i) => {
    const label = d.level === 'critical' ? 'KRITIK' : d.level === 'overdue' ? '2 oy' : d.level
    msg += `${i + 1}. ${d.name} — ${label}, ${fmt(d.debt)} so'm\n`
  })
  if (digest.length > 20) msg += `\n...va yana ${digest.length - 20} ta`
  msg += `\n\nQora ro'yxat tavsiyalarini tizimda ko'rib chiqing.`

  for (const l of links) await sendEkoMessage(l.chatId, msg).catch(() => {})
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
