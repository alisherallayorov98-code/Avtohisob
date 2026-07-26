// EkoHisob avtomatik SMS eslatma — oyda bir marta, korxona sozlagan kunda.
//
// Ilgari SMS faqat qo'lda yuborilardi: inspektor har bir qarzdorni ochib tugma
// bosishi kerak edi, natijada amalda deyarli ishlatilmasdi. Endi korxona
// "oyning 10-kuni, 2+ oy qarzdorlarga" deb sozlab qo'yadi va tizim o'zi yuboradi.
//
// Himoyalar (mijoz puliga va obro'siga ta'sir qiladi):
//  - korxonada smsAutoEnabled yoqilmagan bo'lsa — hech narsa qilinmaydi;
//  - oylik SMS limiti (super-admin belgilaydi) oshib ketmaydi;
//  - kunlik maksimal (smsDailyMax) hurmat qilinadi;
//  - bitta tashkilotga bir oyda BIR marta avto-SMS (takror yuborilmaydi);
//  - qarzi 0 bo'lgan yoki telefoni noto'g'ri tashkilotga yuborilmaydi.

import { prisma } from '../../../lib/prisma'
import { sendSms, normalizePhone } from './sms'
import { renderSmsTemplate, formatSmsAmount } from '../lib/smsTemplate'
import { meetsMinLevel } from '../lib/escalation'
import { computeEntityDebt } from '../lib/debtMath'
import { getOrgSettings } from './orgSettings'
import { sendEkoMessage } from '../../../services/ekoFieldBot'

const DEFAULT_SMS_MONTHLY_LIMIT = 1000

function envLimit(): number {
  const v = parseInt(process.env.EKO_SMS_MONTHLY_LIMIT || '', 10)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SMS_MONTHLY_LIMIT
}

function monthStart(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/**
 * Bugun avto-SMS kuni bo'lgan barcha korxonalar uchun eslatma yuboradi.
 * Cron har kuni chaqiradi — kun mos kelmasa korxona o'tkazib yuboriladi.
 */
export async function runAutoSmsReminders(): Promise<void> {
  const today = new Date().getDate()

  // Sozlamasi yoqilgan va bugungi kunga mos korxonalar
  const orgs = await (prisma as any).ekoHisobOrgSettings.findMany({
    where: { smsAutoEnabled: true, smsAutoDay: today },
    select: { orgId: true },
  }).catch(() => [] as any[])

  if (orgs.length === 0) return
  console.log(`[EkoAutoSms] ${orgs.length} ta korxona uchun avtomatik eslatma`)

  for (const { orgId } of orgs) {
    await runForOrg(orgId).catch((e: any) =>
      console.error(`[EkoAutoSms] org=${orgId} xato:`, e?.message ?? e))
  }
}

async function runForOrg(orgId: string): Promise<void> {
  const settings = await getOrgSettings(orgId)
  const limit = settings.smsMonthlyLimit && settings.smsMonthlyLimit > 0
    ? settings.smsMonthlyLimit
    : envLimit()

  const used = await (prisma as any).ekoHisobSmsLog.count({
    where: { orgId, status: 'sent', createdAt: { gte: monthStart() } },
  })
  if (used >= limit) {
    console.log(`[EkoAutoSms] org=${orgId}: oylik limit tugagan (${used}/${limit})`)
    await warnAdmins(orgId, `SMS limiti tugadi (${used}/${limit}) — avtomatik eslatma yuborilmadi.`)
    return
  }

  // Shu oyda allaqachon SMS olgan tashkilotlar — takror yubormaymiz
  const alreadySent = await (prisma as any).ekoHisobSmsLog.findMany({
    where: { orgId, createdAt: { gte: monthStart() }, entityId: { not: null } },
    select: { entityId: true },
    distinct: ['entityId'],
  }).catch(() => [] as any[])
  const skipIds = new Set<string>(alreadySent.map((s: any) => s.entityId))

  // Qarzdorlar — daraja bo'yicha (cron kechasi debtLevel'ni yangilagan)
  const candidates = await (prisma as any).ekoHisobLegalEntity.findMany({
    where: {
      orgId,
      status: 'active',
      phone: { not: null },
      debtLevel: { in: ['warning', 'overdue', 'critical'] },
    },
    select: {
      id: true, name: true, phone: true, billingMode: true, debtLevel: true,
      charges: {
        where: { status: { in: ['open', 'partial'] } },
        select: { month: true, expectedAmount: true, paidAmount: true },
      },
      talons: { where: { paid: false }, select: { date: true, amount: true, paid: true } },
    },
    // Eng qarzdorlardan boshlaymiz: limit yetmasa ham eng muhimlari qamrab olinadi
    orderBy: { debtLevel: 'desc' },
  })

  const budget = Math.min(limit - used, settings.smsDailyMax)
  let sent = 0, failed = 0, skipped = 0

  for (const e of candidates) {
    if (sent >= budget) break
    if (skipIds.has(e.id)) { skipped++; continue }
    if (!meetsMinLevel(e.debtLevel, settings.smsAutoMinLevel)) { skipped++; continue }
    if (!normalizePhone(e.phone)) { skipped++; continue }

    const debt = computeEntityDebt({
      billingMode: e.billingMode, charges: e.charges, talons: e.talons,
    }).totalDebt
    if (debt <= 0) { skipped++; continue }

    const message = renderSmsTemplate(settings.smsTemplate, {
      tashkilot: e.name,
      qarz: formatSmsAmount(debt),
      aloqa: settings.contactPhone ?? '',
    })
    const result = await sendSms(e.phone, message)

    await (prisma as any).ekoHisobSmsLog.create({
      data: {
        orgId, entityId: e.id,
        phone: normalizePhone(e.phone) || e.phone,
        message,
        status: result.ok ? 'sent' : 'failed',
        providerMsgId: result.msgId ?? null,
        error: result.error ?? null,
        sentBy: null,                    // avtomatik
      },
    }).catch(() => {})

    if (result.ok) sent++
    else {
      failed++
      // Xizmat umuman sozlanmagan bo'lsa qolganini urinib o'tirmaymiz
      if (result.error?.includes('sozlanmagan')) break
    }
  }

  console.log(`[EkoAutoSms] org=${orgId}: ${sent} yuborildi, ${failed} xato, ${skipped} o'tkazildi`)

  if (sent > 0 || failed > 0) {
    const remaining = Math.max(0, limit - used - sent)
    let msg = `📨 <b>Avtomatik qarz eslatmasi</b>\n\n` +
      `Yuborildi: <b>${sent}</b> ta SMS\n`
    if (failed > 0) msg += `Yuborilmadi: ${failed} ta\n`
    msg += `Oylik limit: ${used + sent}/${limit} (qoldi ${remaining})`
    if (remaining <= limit * 0.1) {
      msg += `\n\n⚠️ Limit tugash arafasida.`
    }
    await warnAdmins(orgId, msg, true)
  }
}

/** Korxona admin/boshliqlariga Telegram xabar (botga ulanganlarga) */
async function warnAdmins(orgId: string, text: string, raw = false): Promise<void> {
  const links = await (prisma as any).ekoHisobBotLink.findMany({
    where: { user: { orgId, isActive: true, role: { in: ['admin', 'supervisor'] } } },
    select: { chatId: true },
  }).catch(() => [] as any[])
  const msg = raw ? text : `⚠️ <b>EkoHisob</b>\n\n${text}`
  for (const l of links) await sendEkoMessage(l.chatId, msg).catch(() => {})
}
