// Eskiz.uz SMS integratsiyasi — qarzdorlarga SMS eslatma yuborish uchun.
// ENV: ESKIZ_EMAIL, ESKIZ_PASSWORD, ESKIZ_FROM (alfa-nom, default '4546' test).
//
// Bu qatlam FAQAT Eskiz bilan gaplashadi (past daraja). Byudjet, dedup, opt-out va
// jurnal — services/smsGateway.ts (`sendBudgetedSms`); to'g'ridan-to'g'ri sendSms'ni
// chaqirish MUMKIN EMAS (limitni chetlab o'tadi).
//
// Xato turlari (errorType): config | auth | transient | permanent — lib/smsBudget.ts.

import { classifyHttpFailure, SmsErrorType } from '../lib/smsBudget'

const ESKIZ_BASE = 'https://notify.eskiz.uz/api'
const REQUEST_TIMEOUT_MS = 10_000

// Token 30 kun amal qiladi — in-memory cache (25 kun xavfsizlik zaxirasi bilan).
let cachedToken: { value: string; expiresAt: number } | null = null

/**
 * O'zbekiston telefon raqamini 998XXXXXXXXX formatiga keltiradi.
 * Qabul qiladi: "901234567", "+998 90 123 45 67", "998901234567", "0901234567" ...
 * Noto'g'ri bo'lsa null qaytaradi.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 9) return '998' + digits
  if (digits.length === 10 && digits.startsWith('0')) return '998' + digits.slice(1)
  if (digits.length === 12 && digits.startsWith('998')) return digits
  return null
}

export interface SmsResult {
  ok: boolean
  msgId?: string
  error?: string
  errorType?: SmsErrorType
}

type TokenResult = { token: string } | { error: string; errorType: SmsErrorType }

async function getToken(forceFresh = false): Promise<TokenResult> {
  if (!forceFresh && cachedToken && cachedToken.expiresAt > Date.now()) return { token: cachedToken.value }
  const email = process.env.ESKIZ_EMAIL
  const password = process.env.ESKIZ_PASSWORD
  if (!email || !password) {
    return { error: "SMS xizmati sozlanmagan (Eskiz kaliti yo'q)", errorType: 'config' }
  }
  try {
    const form = new FormData()
    form.append('email', email)
    form.append('password', password)
    const res = await fetch(`${ESKIZ_BASE}/auth/login`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const json: any = await res.json().catch(() => ({}))
    const token = json?.data?.token
    if (res.ok && token) {
      cachedToken = { value: token, expiresAt: Date.now() + 25 * 24 * 60 * 60 * 1000 }
      return { token }
    }
    // Login rad etildi: parol xato/akkaunt bloklangan — bu "sozlanmagan" emas, AUTH xatosi
    const type = classifyHttpFailure(res.status)
    return {
      error: `Eskiz login xatosi (HTTP ${res.status})${json?.message ? ': ' + json.message : ''}`,
      errorType: type === 'permanent' ? 'auth' : type,
    }
  } catch (e: any) {
    return { error: `Eskiz login ulanmadi: ${e?.name === 'TimeoutError' ? 'vaqt tugadi' : (e?.message || 'tarmoq xatosi')}`, errorType: 'transient' }
  }
}

async function sendRequest(token: string, phone: string, message: string, from: string): Promise<globalThis.Response> {
  const form = new FormData()
  form.append('mobile_phone', phone)
  form.append('message', message)
  form.append('from', from)
  return fetch(`${ESKIZ_BASE}/message/sms/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * Bitta SMS yuboradi (past daraja — faqat Eskiz). Hech qachon xato tashlamaydi.
 * Byudjet/dedup/opt-out tekshiruvi YO'Q — `sendBudgetedSms` orqali chaqiring.
 */
export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, error: "Telefon raqami noto'g'ri", errorType: 'permanent' }

  const t = await getToken()
  if (!('token' in t)) return { ok: false, error: t.error, errorType: t.errorType }
  let token = t.token

  const from = process.env.ESKIZ_FROM || '4546'
  try {
    let res = await sendRequest(token, normalized, message, from)
    // Token eskirgan bo'lsa — bir marta qayta login va qayta urinish
    if (res.status === 401) {
      cachedToken = null
      const t2 = await getToken(true)
      if (!('token' in t2)) return { ok: false, error: t2.error, errorType: t2.errorType }
      token = t2.token
      res = await sendRequest(token, normalized, message, from)
    }
    const json: any = await res.json().catch(() => ({}))
    if (res.ok && (json?.id || json?.status === 'waiting' || json?.status === 'success')) {
      return { ok: true, msgId: json?.id != null ? String(json.id) : undefined }
    }
    const type = classifyHttpFailure(res.status)
    return {
      ok: false,
      error: json?.message || `Eskiz xato (HTTP ${res.status})`,
      errorType: res.ok ? 'permanent' : type,
    }
  } catch (e: any) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    return { ok: false, error: timeout ? 'SMS xizmati javob bermadi (10 s)' : (e?.message || 'SMS yuborishda xato'), errorType: 'transient' }
  }
}

/** SMS xizmati sozlanganmi (kalit bor-yo'qligi) — UI uchun. */
export function isSmsConfigured(): boolean {
  return !!(process.env.ESKIZ_EMAIL && process.env.ESKIZ_PASSWORD)
}
