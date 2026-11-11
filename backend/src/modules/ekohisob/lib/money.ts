// EkoHisob — pul kiritish validatsiyasi (pure, testlanadi).
//
// Barcha pul — BUTUN so'm. Float yo'q: "1500.75", "1e6", "12 000", "0x10", "-5" rad etiladi
// (parseInt("1500.75") jimgina 1500 ga aylantirardi — pul yo'qolardi).

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'online'] as const
export type PaymentMethod = typeof PAYMENT_METHODS[number]

/** Faqat musbat BUTUN son (number yoki faqat raqamdan iborat string). Aks holda null. */
export function parseMoneyAmount(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isSafeInteger(v) && v > 0 ? v : null
  }
  if (typeof v === 'string') {
    const t = v.trim()
    if (!/^\d{1,15}$/.test(t)) return null
    const n = Number(t)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }
  return null
}

/** To'lov usuli; berilmasa 'cash'. Noto'g'ri qiymat → null. */
export function parsePaymentMethod(v: unknown): PaymentMethod | null {
  if (v === undefined || v === null || v === '') return 'cash'
  return (PAYMENT_METHODS as readonly string[]).includes(String(v)) ? (v as PaymentMethod) : null
}

/** Idempotency kaliti: 8..100 belgi, xavfsiz alfavit. */
export function parseIdempotencyKey(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return /^[A-Za-z0-9._:-]{8,100}$/.test(t) ? t : null
}

/** Bekor qilish sababi: kamida 5 belgi (bo'sh joylarsiz), eng ko'pi 300. Yaroqsiz → null. */
export function parseReason(v: unknown, min = 5): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ')
  if (t.length < min) return null
  return t.slice(0, 300)
}
