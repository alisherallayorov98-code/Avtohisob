// Savdo — SMS yuborishning YAGONA yadrosi.
//
// SMS yozadigan yangi joy paydo bo'lsa (veb, bot, cron) mustaqil nusxa
// YOZILMASIN — shu funksiyalar chaqirilsin. Ichida: telefon normalizatsiyasi,
// provayderga yuborish va HAR DOIM savdoSmsLog'ga yozish (audit uchun —
// muvaffaqiyatsiz urinish ham qoladi).
//
// Provayder bilan aloqa umumiy services/smsService.ts orqali (Eskiz.uz).

import { prisma } from '../../../lib/prisma'
import { sendSms as sendSmsRaw } from '../../../services/smsService'
import { normalizePhone } from '../lib/savdoSmsTemplate'

export interface SendSavdoSmsInput {
  orgId: string
  customerId?: string | null
  phone: string
  message: string
  sentBy?: string | null
}

export interface SendSavdoSmsResult {
  ok: boolean
  error?: string
}

/** Eskiz kaliti sozlanganmi — sozlanmagan bo'lsa SMS haqiqatda ketmaydi */
export function isSavdoSmsConfigured(): boolean {
  return !!(process.env.ESKIZ_EMAIL && process.env.ESKIZ_PASSWORD)
}

/**
 * Bitta SMS yuboradi va natijani jurnalga yozadi.
 * Hech qachon throw qilmaydi — bulk yuborishda bitta xato qolganini
 * to'xtatib qo'ymasligi kerak.
 */
export async function sendSavdoSms(input: SendSavdoSmsInput): Promise<SendSavdoSmsResult> {
  const phone = normalizePhone(input.phone)
  const message = (input.message || '').trim()

  let ok = false
  let error: string | undefined

  if (!phone) {
    error = 'Telefon raqami noto\'g\'ri'
  } else if (!message) {
    error = 'SMS matni bo\'sh'
  } else {
    try {
      const res = await sendSmsRaw(phone, message)
      if (res.sent) {
        ok = true
      } else {
        error = res.devMode
          ? 'SMS xizmati sozlanmagan (dev-rejim) — xabar yuborilmadi'
          : 'Provayder xabarni qabul qilmadi'
      }
    } catch (e: any) {
      error = e?.message || 'Yuborishda kutilmagan xato'
    }
  }

  try {
    await (prisma as any).savdoSmsLog.create({
      data: {
        orgId: input.orgId,
        customerId: input.customerId || null,
        phone: phone || input.phone,
        message,
        status: ok ? 'sent' : 'failed',
        error: error || null,
        sentBy: input.sentBy || null,
      },
    })
  } catch (e: any) {
    // Jurnal yozilmasa ham yuborilgan SMS'ni "xato" deb ko'rsatmaymiz
    console.error('[SavdoSMS] Jurnalga yozib bo\'lmadi:', e?.message)
  }

  return ok ? { ok: true } : { ok: false, error }
}

export interface BulkSmsItem {
  customerId: string
  phone: string
  message: string
}

export interface BulkSmsResult {
  sent: number
  failed: number
  results: { customerId: string; ok: boolean; error?: string }[]
}

/**
 * Ro'yxat bo'yicha ketma-ket yuboradi (parallel EMAS — provayder tezlik
 * limitini urmaslik uchun).
 */
export async function sendSavdoSmsBulk(input: {
  orgId: string
  sentBy?: string | null
  items: BulkSmsItem[]
}): Promise<BulkSmsResult> {
  const results: BulkSmsResult['results'] = []
  let sent = 0
  let failed = 0

  for (const item of input.items) {
    const res = await sendSavdoSms({
      orgId: input.orgId,
      customerId: item.customerId,
      phone: item.phone,
      message: item.message,
      sentBy: input.sentBy,
    })
    if (res.ok) sent++
    else failed++
    results.push({ customerId: item.customerId, ok: res.ok, ...(res.error && { error: res.error }) })
  }

  return { sent, failed, results }
}
