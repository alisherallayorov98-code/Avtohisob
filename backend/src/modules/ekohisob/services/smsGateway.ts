// EkoHisob SMS — YAGONA yuborish yo'li: avto-SMS, eskalatsiya va qo'lda SMS HAMMASI shundan o'tadi.
//
// Tartib (pul va obro'ga ta'sir qiladi):
//  1. Tranzaksiya + pg_advisory_xact_lock(org): tashkilot holati, smsOptOut, telefon,
//     dedup (tashkilot+tur+davr), cooldown, byudjet (SEGMENTLAR yig'indisi) tekshiriladi va
//     'pending' yozuv yaratiladi. Lock tufayli ikki parallel chaqiruv bitta byudjet/kalitni
//     ikki marta ishlata olmaydi.
//  2. Lock bo'shatilgach Eskiz'ga yuboriladi (tarmoq tranzaksiya ichida kutmaydi).
//  3. 'pending' yozuv natijaga yangilanadi. Yangilash xatosi YUTILMAYDI: yozuv 'pending'
//     qoladi (u dedup va byudjetda hisobga olinadi — ikkilanish bo'lmaydi), xato logga yoziladi.
//  4. config/auth xatosida 'pending' o'chiriladi (urinish sarflanmaydi), chunki xabar Eskiz'ga
//     yetmagan va butun navbat to'xtashi kerak.

import { prisma } from '../../../lib/prisma'
import { sendSms, normalizePhone, isSmsConfigured, SmsResult } from './sms'
import { smsSegments, toGsmSafe } from '../lib/smsTemplate'
import {
  decideReservation, SmsKind, SkipReason, SmsErrorType, consumesAttempt,
} from '../lib/smsBudget'
import { getOrgSettings, effectiveSmsLimit } from './orgSettings'
import { currentMonthUz, monthStartUz, todayUz, dayBoundsUz } from '../lib/uzt'

export interface SendBudgetedInput {
  orgId: string
  entityId: string
  kind: SmsKind
  /** Tayyor (render qilingan) matn */
  message: string
  /** Qo'lda yuborgan EkoHisobUser id; avto/eskalatsiya uchun null */
  sentBy?: string | null
  /** Dedup davri (standart: joriy oy UZT) */
  periodKey?: string
  /** Dedup shu turlar bo'yicha tekshiriladi (standart: [kind]) */
  dedupKinds?: string[]
  /** Shu soat ichida shu tashkilot/telefonga 'sent'/'pending' bo'lsa yuborilmaydi (0 = o'chiq) */
  cooldownHours?: number
  now?: Date
}

export type SendOutcome =
  | { status: 'sent'; segments: number; logId: string; msgId?: string; message: string }
  | { status: 'skipped'; reason: SkipReason | 'not_configured' }
  | { status: 'failed'; errorType: SmsErrorType | undefined; error: string; segments: number; logId?: string }

const COUNTED = ['sent', 'pending']

export interface SmsUsage {
  monthlyLimit: number
  usedMonthSegments: number
  usedMonthSms: number
  dailyMax: number
  usedTodaySegments: number
}

/** Shu oy (UZT) va bugungi sarf — 'sent' + 'pending' (segment va SMS soni). */
export async function getSmsUsage(orgId: string, now: Date = new Date()): Promise<SmsUsage> {
  const db = prisma as any
  const settings = await getOrgSettings(orgId)
  const monthStart = monthStartUz(currentMonthUz(now))!
  const dayStart = dayBoundsUz(todayUz(now))!.start
  const [m, d] = await Promise.all([
    db.ekoHisobSmsLog.aggregate({
      where: { orgId, status: { in: COUNTED }, createdAt: { gte: monthStart } },
      _sum: { segments: true }, _count: { _all: true },
    }),
    db.ekoHisobSmsLog.aggregate({
      where: { orgId, status: { in: COUNTED }, createdAt: { gte: dayStart } },
      _sum: { segments: true },
    }),
  ])
  return {
    monthlyLimit: effectiveSmsLimit(settings),
    usedMonthSegments: m._sum.segments ?? 0,
    usedMonthSms: m._count._all ?? 0,
    dailyMax: settings.smsDailyMax,
    usedTodaySegments: d._sum.segments ?? 0,
  }
}

async function finalize(logId: string, data: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await (prisma as any).ekoHisobSmsLog.update({ where: { id: logId }, data })
      return true
    } catch (e: any) {
      console.error(`[EkoSms] jurnalni yangilab bo'lmadi (log=${logId}, urinish ${attempt + 1}):`, e?.message ?? e)
    }
  }
  return false
}

export async function sendBudgetedSms(input: SendBudgetedInput): Promise<SendOutcome> {
  const { orgId, entityId, kind } = input
  const now = input.now ?? new Date()
  const periodKey = input.periodKey ?? currentMonthUz(now)
  const dedupKinds = input.dedupKinds?.length ? input.dedupKinds : [kind]
  const message = toGsmSafe(input.message).trim()
  const segments = smsSegments(message).segments

  if (!isSmsConfigured()) return { status: 'skipped', reason: 'not_configured' }

  const settings = await getOrgSettings(orgId)
  const monthlyLimit = effectiveSmsLimit(settings)
  const monthStart = monthStartUz(currentMonthUz(now))!
  const dayStart = dayBoundsUz(todayUz(now))!.start

  let reserved: { id: string; phone: string } | null = null
  let skip: SkipReason | null = null

  await (prisma as any).$transaction(async (tx: any) => {
    // Tashkilot darajasida ketma-ketlashtirish (byudjet + dedup poygasiz)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'eko-sms:' + orgId}))`

    const entity = await tx.ekoHisobLegalEntity.findFirst({
      where: { id: entityId, orgId },
      select: { id: true, status: true, smsOptOut: true, phone: true },
    })
    const phone = normalizePhone(entity?.phone)

    const [month, today, dup, failed, cooldown] = await Promise.all([
      tx.ekoHisobSmsLog.aggregate({
        where: { orgId, status: { in: COUNTED }, createdAt: { gte: monthStart } }, _sum: { segments: true },
      }),
      tx.ekoHisobSmsLog.aggregate({
        where: { orgId, status: { in: COUNTED }, createdAt: { gte: dayStart } }, _sum: { segments: true },
      }),
      tx.ekoHisobSmsLog.count({
        where: { orgId, entityId, periodKey, kind: { in: dedupKinds }, status: { in: COUNTED } },
      }),
      tx.ekoHisobSmsLog.count({
        where: { orgId, entityId, periodKey, kind, status: 'failed' },
      }),
      input.cooldownHours && input.cooldownHours > 0
        ? tx.ekoHisobSmsLog.count({
            where: {
              orgId, status: { in: COUNTED },
              createdAt: { gte: new Date(now.getTime() - input.cooldownHours * 3600_000) },
              OR: [{ entityId }, ...(phone ? [{ phone }] : [])],
            },
          })
        : Promise.resolve(0),
    ])

    const decision = decideReservation({
      entityFound: !!entity,
      entityStatus: entity?.status ?? null,
      smsOptOut: !!entity?.smsOptOut,
      phoneValid: !!phone,
      segments,
      budget: {
        monthlyLimit, usedMonthSegments: month._sum.segments ?? 0,
        dailyMax: settings.smsDailyMax, usedTodaySegments: today._sum.segments ?? 0,
      },
      duplicateExists: dup > 0,
      failedAttempts: failed,
      cooldownHit: cooldown > 0,
    })
    if (!decision.ok) { skip = decision.reason; return }

    const row = await tx.ekoHisobSmsLog.create({
      data: {
        orgId, entityId, phone: phone!, message, status: 'pending',
        sentBy: input.sentBy ?? null, segments, kind, periodKey,
      },
      select: { id: true },
    })
    reserved = { id: row.id, phone: phone! }
  }, { timeout: 15_000 })

  if (skip) return { status: 'skipped', reason: skip }
  const r = reserved as { id: string; phone: string } | null
  if (!r) return { status: 'skipped', reason: 'not_found' }

  let result: SmsResult
  try {
    result = await sendSms(r.phone, message)
  } catch (e: any) {
    result = { ok: false, error: e?.message || 'SMS yuborishda xato', errorType: 'transient' }
  }

  if (result.ok) {
    await finalize(r.id, { status: 'sent', providerMsgId: result.msgId ?? null, error: null })
    return { status: 'sent', segments, logId: r.id, msgId: result.msgId, message }
  }

  const error = result.error || 'SMS yuborilmadi'
  if (!consumesAttempt(result.errorType)) {
    // config/auth: xabar Eskiz'ga yetmagan — band qilingan joyni qaytaramiz
    await (prisma as any).ekoHisobSmsLog.delete({ where: { id: r.id } }).catch(async (e: any) => {
      console.error(`[EkoSms] pending yozuvni o'chirib bo'lmadi (log=${r.id}):`, e?.message ?? e)
      await finalize(r.id, { status: 'failed', error })
    })
    return { status: 'failed', errorType: result.errorType, error, segments }
  }
  await finalize(r.id, { status: 'failed', error })
  return { status: 'failed', errorType: result.errorType, error, segments, logId: r.id }
}
