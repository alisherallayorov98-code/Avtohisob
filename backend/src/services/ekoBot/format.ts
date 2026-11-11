// Bot xabarlari yagona uslubi (pure). Birinchi qator: bitta holat emoji + sarlavha;
// keyin "Yorliq: qiymat" qatorlari. Chiziqlar yo'q, oy "Iyul 2026", sana "10.11.2026".

import { uzDate, uzMonth, uzNum } from '../../modules/ekohisob/lib/dateFormat'
import { uztParts } from '../../modules/ekohisob/lib/uzt'

export type Status = 'ok' | 'warn' | 'error'
const EMOJI: Record<Status, string> = { ok: '✅', warn: '⚠️', error: '❌' }

/** Apostrof variantlarini bitta ko'rinishga keltiradi. */
export function normApos(s: string): string {
  return s.replace(/[’‘ʻʼ`´]/g, "'")
}

export function esc(s: unknown): string {
  return normApos(String(s ?? '')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** "150 000 so'm" */
export function sum(n: number): string { return `${uzNum(n)} so'm` }

export function head(status: Status, title: string): string { return `${EMOJI[status]} <b>${esc(title)}</b>` }

export function kv(label: string, value: string): string { return `${label}: ${value}` }

export function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join('\n')
}

export function monthList(months: string[]): string { return months.map(m => uzMonth(m)).join(', ') }

export function uzTime(d: Date | string): string {
  const p = uztParts(d)
  return p ? `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` : '—'
}

export function clip(s: string, n: number): string {
  const t = normApos(s)
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// ── Xato shabloni ───────────────────────────────────────────────────────────

export interface ErrInfo { reason: string; kind: 'network' | 'db' | 'forbidden' | 'validation' | 'unknown'; retryable: boolean }

const NET_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ESOCKETTIMEDOUT', 'EPIPE', 'EFATAL'])

const PAYMENT_REASONS: Record<string, string> = {
  INVALID_AMOUNT: "summa noto'g'ri",
  AMOUNT_TOO_LARGE: 'summa juda katta',
  INVALID_MONTH: "oy noto'g'ri",
  FUTURE_MONTH: "kelajak oyiga to'lov yozib bo'lmaydi",
  ENTITY_INACTIVE: 'tashkilot faol emas',
  ENTITY_NOT_FOUND: 'tashkilot topilmadi',
  IDEMPOTENCY_CONFLICT: "so'rov to'qnashdi, qaytadan boshlang",
  INVALID_KEY: "so'rov kaliti noto'g'ri, qaytadan boshlang",
  INVALID_METHOD: "to'lov usuli noto'g'ri",
  TALON_NOT_FOUND: 'talon topilmadi',
  TALON_ALREADY_PAID: "talon allaqachon to'langan",
}

export function describeError(err: any): ErrInfo {
  if (err?.name === 'PaymentError') {
    if (err.code === 'FORBIDDEN') return { reason: 'Bu tashkilot sizning tumaningizda emas', kind: 'forbidden', retryable: false }
    return { reason: PAYMENT_REASONS[err.code] ?? String(err.message ?? 'tekshiruvdan o\'tmadi'), kind: 'validation', retryable: false }
  }
  const msg = String(err?.message ?? '')
  const code = String(err?.code ?? '')
  if (NET_CODES.has(code) || /ETELEGRAM|socket hang up|fetch failed|network|ESOCKET/i.test(msg)) {
    return { reason: "tarmoq xatosi, aloqani tekshirib qayta urinib ko'ring", kind: 'network', retryable: true }
  }
  if (/^P\d{4}$/.test(code) || /^PrismaClient/.test(String(err?.name ?? ''))) {
    return { reason: "ma'lumotlar bazasi javob bermadi, birozdan keyin urinib ko'ring", kind: 'db', retryable: true }
  }
  return { reason: 'server ichki xatosi, administratorga xabar bering', kind: 'unknown', retryable: true }
}

/** Yagona xato matni: "❌ Bajarilmadi: {sabab}." */
export function failText(reason: string): string {
  const r = normApos(reason).replace(/\.+$/, '')
  return `❌ <b>Bajarilmadi:</b> ${esc(r)}.`
}

// ── To'lov xabarlari ────────────────────────────────────────────────────────

export interface ConfirmInput {
  entityName: string; month: string; amount: number; debt: number; debtMonths: string[]
}

export function confirmText(i: ConfirmInput): string {
  const over = i.debt > 0 && i.amount > i.debt ? i.amount - i.debt : 0
  return lines(
    head('warn', "To'lovni tasdiqlang"),
    kv('Tashkilot', esc(i.entityName)),
    kv('Oy', uzMonth(i.month)),
    kv('Summa', `<b>${sum(i.amount)}</b>`),
    i.debt > 0 ? kv('Joriy qarz', sum(i.debt)) : null,
    over > 0 ? `Ortiqcha ${sum(over)} eng eski qarzga yoki avansga o'tadi.` : null,
    i.debt === 0 ? "Qarz yo'q: summa avans bo'lib yoziladi." : null,
  )
}

export interface SuccessInput {
  entityName: string; month: string; amount: number; allocations: { month: string; amount: number }[]
  talonsClosed: number; remaining: number; receiptNumber: string; inspector: string; replay: boolean
}

export function successText(i: SuccessInput): string {
  const multi = i.allocations.length > 1
  return lines(
    i.replay ? head('warn', "Bu to'lov allaqachon yozilgan") : head('ok', "To'lov qabul qilindi"),
    kv('Tashkilot', esc(i.entityName)),
    kv('Oy', uzMonth(i.month)),
    kv('Summa', `<b>${sum(i.amount)}</b>`),
    multi ? kv('Taqsimot', i.allocations.map(a => `${uzMonth(a.month)} ${sum(a.amount)}`).join('; ')) : null,
    i.talonsClosed > 0 ? kv('Yopilgan talon', `${i.talonsClosed} ta`) : null,
    kv('Qolgan qarz', i.remaining > 0 ? `<b>${sum(i.remaining)}</b>` : "yo'q"),
    kv('Qabul qildi', esc(i.inspector)),
    i.receiptNumber ? kv('Kvitansiya', `<code>${esc(i.receiptNumber)}</code>`) : null,
  )
}

export function duplicateText(d: { amount?: number; paidAt?: Date | string; receiptNumber?: string | null } | null, month: string): string {
  return lines(
    head('warn', "Takroriy to'lov bo'lishi mumkin"),
    `Shu tashkilotga ${uzMonth(month)} uchun aynan shunday summa bir necha daqiqa oldin yozilgan.`,
    d?.amount ? kv('Oldingi summa', sum(d.amount)) : null,
    d?.paidAt ? kv('Vaqti', `${uzDate(d.paidAt)} ${uzTime(d.paidAt)}`) : null,
    d?.receiptNumber ? kv('Kvitansiya', `<code>${esc(d.receiptNumber)}</code>`) : null,
    "Agar bu haqiqatan yangi to'lov bo'lsa, \"Baribir yozish\" ni bosing.",
  )
}

/** Hisobot/ro'yxat sarlavhasi uchun holat. */
export function statusFor(needsAttention: boolean): Status { return needsAttention ? 'warn' : 'ok' }

export function receiptVerifyUrl(token: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!token) return null
  const base = (env.APP_PUBLIC_URL || env.FRONTEND_URL || 'https://avtohisob.uz').replace(/\/$/, '')
  if (!/^https:\/\//i.test(base)) return null
  return `${base}/ekohisob/kvitansiya/${encodeURIComponent(token)}`
}
