// EkoHisob avtomatik SMS eslatma — oyda bir marta, korxona sozlagan kundan boshlab.
//
// Ilgari SMS faqat qo'lda yuborilardi: inspektor har bir qarzdorni ochib tugma
// bosishi kerak edi, natijada amalda deyarli ishlatilmasdi. Endi korxona
// "oyning 10-kuni, 2+ oy qarzdorlarga" deb sozlab qo'yadi va tizim o'zi yuboradi.
//
// Himoyalar (mijoz puliga va obro'siga ta'sir qiladi) — hammasi services/smsGateway.ts da:
//  - korxonada smsAutoEnabled yoqilmagan bo'lsa — hech narsa qilinmaydi;
//  - oylik limit SEGMENTLAR bo'yicha, kunlik maksimum ham; byudjet tugasa ertasi kuni davom etadi;
//  - bitta tashkilotga bir oyda BIR marta (dedup kaliti: tashkilot+tur+davr);
//  - smsOptOut, faol bo'lmagan holat, noto'g'ri telefon, qarzi 0 — yuborilmaydi;
//  - faqat 10:00–18:00 UZT oynasida.
//
// `smsAutoDay <= bugun` va shu oy hali to'liq ishlamagan (smsAutoLastMonth) bo'lsa ishlaydi;
// hamma nomzod ishlab bo'lgach smsAutoLastMonth = joriy oy qo'yiladi.

import { prisma } from '../../../lib/prisma'
import { renderSmsTemplate, formatSmsAmount } from '../lib/smsTemplate'
import { meetsMinLevel } from '../lib/escalation'
import { queryEntityDebts } from '../lib/reportQueries'
import {
  shouldRunAuto, sortCandidates, shouldAbortBatch, isInSendWindow, remainingBudget,
} from '../lib/smsBudget'
import { currentMonthUz, uztParts } from '../lib/uzt'
import { uzMonth } from '../lib/dateFormat'
import { getOrgSettings } from './orgSettings'
import { sendBudgetedSms, getSmsUsage } from './smsGateway'
import { sendEkoMessage } from '../../../services/ekoFieldBot'

/**
 * Avto-SMS kuni kelgan (yoki o'tib ketgan, lekin shu oy to'liq ishlamagan) korxonalar uchun
 * eslatma yuboradi. Cron kuniga bir necha marta chaqiradi — idempotent.
 */
export async function runAutoSmsReminders(now: Date = new Date()): Promise<void> {
  const p = uztParts(now)!
  if (!isInSendWindow(p.hour)) {
    console.log(`[EkoAutoSms] ${p.hour}:00 UZT — yuborish oynasidan (10–18) tashqari, o'tkazildi`)
    return
  }
  const month = currentMonthUz(now)

  const orgs = await (prisma as any).ekoHisobOrgSettings.findMany({
    where: {
      smsAutoEnabled: true,
      smsAutoDay: { lte: p.day },
      OR: [{ smsAutoLastMonth: null }, { smsAutoLastMonth: { not: month } }],
    },
    select: { orgId: true },
  }).catch(() => [] as any[])

  if (orgs.length === 0) return
  console.log(`[EkoAutoSms] ${orgs.length} ta korxona uchun avtomatik eslatma`)

  for (const { orgId } of orgs) {
    await runForOrg(orgId, now).catch((e: any) =>
      console.error(`[EkoAutoSms] org=${orgId} xato:`, e?.message ?? e))
  }
}

async function runForOrg(orgId: string, now: Date): Promise<void> {
  const settings = await getOrgSettings(orgId)
  const month = currentMonthUz(now)
  const p = uztParts(now)!
  if (!shouldRunAuto({
    enabled: settings.smsAutoEnabled, smsAutoDay: settings.smsAutoDay, todayDay: p.day,
    smsAutoLastMonth: settings.smsAutoLastMonth, currentMonth: month,
  })) return

  const usage = await getSmsUsage(orgId, now)
  const budget0 = remainingBudget({
    monthlyLimit: usage.monthlyLimit, usedMonthSegments: usage.usedMonthSegments,
    dailyMax: usage.dailyMax, usedTodaySegments: usage.usedTodaySegments,
  })
  if (budget0.remaining <= 0) {
    console.log(`[EkoAutoSms] org=${orgId}: byudjet tugagan (${budget0.limitedBy})`)
    if (budget0.limitedBy === 'monthly') {
      await warnAdmins(orgId, `SMS limiti tugadi (${usage.usedMonthSegments}/${usage.monthlyLimit} segment) — avtomatik eslatma yuborilmadi.`)
    }
    return // smsAutoLastMonth qo'yilmaydi: byudjet bo'shaganda (ertaga) davom etadi
  }

  // Qarzdorlar — daraja bo'yicha (cron kechasi debtLevel'ni yangilagan)
  const rows = await (prisma as any).ekoHisobLegalEntity.findMany({
    where: {
      orgId,
      status: 'active',
      smsOptOut: false,
      phone: { not: null },
      debtLevel: { in: ['warning', 'overdue', 'critical'] },
    },
    select: {
      id: true, name: true, phone: true, billingMode: true, debtLevel: true,
    },
  })
  // Kanonik qarz (SQL, tashkilot ichida netto; avans eng eski qarzni qoplaydi)
  const canonDebt = await queryEntityDebts(rows.map((e: any) => e.id), orgId)

  type Cand = { id: string; name: string; debtLevel: string; debt: number; oldestMonth: string | null }
  const candidates = sortCandidates<Cand>(
    rows
      .filter((e: any) => meetsMinLevel(e.debtLevel, settings.smsAutoMinLevel))
      .map((e: any): Cand => {
        const d = canonDebt.get(e.id)
        return { id: e.id as string, name: e.name as string, debtLevel: e.debtLevel as string,
          debt: d?.debt ?? 0, oldestMonth: d?.oldest ?? null }
      })
      .filter((c: Cand) => c.debt > 0),
  )

  let sent = 0, sentSegments = 0, failed = 0, skipped = 0, consecutiveTransient = 0
  let complete = true // hamma nomzod yakuniy holatga keldimi (yuborildi/yakuniy o'tkazildi)
  let stopReason: string | null = null

  for (const c of candidates) {
    const message = renderSmsTemplate(settings.smsTemplate, {
      tashkilot: c.name,
      qarz: formatSmsAmount(c.debt),
      oy: c.oldestMonth ? uzMonth(c.oldestMonth) : '',
      aloqa: settings.contactPhone ?? '',
    })
    const out = await sendBudgetedSms({
      orgId, entityId: c.id, kind: 'auto', message, sentBy: null, periodKey: month,
      dedupKinds: ['auto', 'escalation', 'manual'], // shu oyda biror SMS olgan bo'lsa — takror yo'q
      now,
    })

    if (out.status === 'sent') {
      sent++; sentSegments += out.segments; consecutiveTransient = 0
      continue
    }
    if (out.status === 'skipped') {
      if (out.reason === 'monthly_limit' || out.reason === 'daily_limit') {
        complete = false; stopReason = out.reason; break
      }
      if (out.reason === 'not_configured') { complete = false; stopReason = 'not_configured'; break }
      skipped++ // duplicate/opt_out/no_phone/max_attempts/cooldown... — yakuniy
      continue
    }
    // failed
    failed++
    if (out.errorType === 'transient') { consecutiveTransient++; complete = false } else consecutiveTransient = 0
    if (shouldAbortBatch(out.errorType, consecutiveTransient)) {
      complete = false; stopReason = out.errorType === 'transient' ? 'transient' : `${out.errorType}: ${out.error}`
      break
    }
  }

  if (complete) {
    await (prisma as any).ekoHisobOrgSettings.updateMany({
      where: { orgId }, data: { smsAutoLastMonth: month },
    }).catch((e: any) => console.error(`[EkoAutoSms] smsAutoLastMonth yozilmadi org=${orgId}:`, e?.message ?? e))
  }

  console.log(`[EkoAutoSms] org=${orgId}: ${sent} yuborildi (${sentSegments} segment), ${failed} xato, ${skipped} o'tkazildi${stopReason ? `, to'xtadi: ${stopReason}` : ''}`)

  if (stopReason === 'monthly_limit') {
    await warnAdmins(orgId, `SMS limiti tugadi — avtomatik eslatma to'liq yuborilmadi. Qolganlari limit yangilangach davom etadi.`)
  } else if (stopReason && stopReason !== 'daily_limit' && stopReason !== 'transient') {
    await warnAdmins(orgId, `SMS yuborish to'xtadi: ${stopReason}. Eskiz sozlamalarini tekshiring.`)
  }

  if (sent > 0 || failed > 0) {
    const after = await getSmsUsage(orgId, now)
    const remaining = Math.max(0, after.monthlyLimit - after.usedMonthSegments)
    let msg = `📨 <b>Avtomatik qarz eslatmasi</b>\n\n` +
      `Yuborildi: <b>${sent}</b> ta SMS (${sentSegments} segment)\n`
    if (failed > 0) msg += `Yuborilmadi: ${failed} ta\n`
    if (stopReason === 'daily_limit') msg += `Kunlik chegara — qolganlari ertaga davom etadi\n`
    msg += `Oylik limit: ${after.usedMonthSegments}/${after.monthlyLimit} segment (qoldi ${remaining})`
    if (remaining <= after.monthlyLimit * 0.1) {
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
