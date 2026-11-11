// EkoHisob dala-bot — qat'iy son kiritish (pure, testlanadi).
// Pul faqat musbat BUTUN son. "1500.75", "1e6", "-5", "0x10", "1,5" rad etiladi.

/** paymentService.MAX_PAYMENT bilan bir xil (pure modul prisma import qilmasligi uchun nusxa). */
export const BOT_MAX_AMOUNT = 500_000_000

export type AmountFail = 'empty' | 'not_integer' | 'not_positive' | 'too_large'
export type AmountParse = { ok: true; value: number } | { ok: false; reason: AmountFail }

export function parseBotAmount(text: unknown): AmountParse {
  if (typeof text !== 'string') return { ok: false, reason: 'empty' }
  // Bo'shliq (oddiy, nbsp, ingichka) ajratgichlari olib tashlanadi
  let s = text.trim().replace(/[\s   ]+/g, '')
  if (!s) return { ok: false, reason: 'empty' }
  if (s.includes(',')) {
    // vergul faqat minglik ajratgich bo'lishi mumkin: 1,500,000
    if (!/^\d{1,3}(,\d{3})+$/.test(s)) return { ok: false, reason: 'not_integer' }
    s = s.replace(/,/g, '')
  }
  if (!/^\d+$/.test(s)) return { ok: false, reason: 'not_integer' }
  if (/^0+$/.test(s)) return { ok: false, reason: 'not_positive' }
  if (s.startsWith('0')) return { ok: false, reason: 'not_integer' }
  if (s.length > 12) return { ok: false, reason: 'too_large' }
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n > BOT_MAX_AMOUNT) return { ok: false, reason: 'too_large' }
  return { ok: true, value: n }
}

export function amountErrorText(reason: AmountFail): string {
  switch (reason) {
    case 'empty': return 'summani yozing'
    case 'not_positive': return "summa noldan katta bo'lishi kerak"
    case 'too_large': return "summa juda katta (eng ko'pi 500 000 000 so'm)"
    default: return 'faqat butun son yozing, masalan 150000'
  }
}

export const MAX_PLAN_TARGET = 1000

/** Plan maqsadi: 1..1000 butun son. */
export function parsePlanTarget(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const s = text.trim().replace(/\s+/g, '')
  if (!/^[1-9]\d{0,3}$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= MAX_PLAN_TARGET ? n : null
}

export const MAX_BOT_VOLUME = 1000

/** Talon kubi: 0 < v <= 1000, ko'pi bilan 3 xona kasr; vergul ham nuqta kabi. */
export function parseCubeVolume(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const s = text.trim().replace(',', '.')
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 && n <= MAX_BOT_VOLUME ? n : null
}

/** Yarmi: yaxlit; qarz 2 so'mdan kam bo'lsa null. */
export function halfOf(debt: number): number | null {
  if (!Number.isFinite(debt) || debt < 2) return null
  return Math.round(debt / 2)
}

/** Tezkor summa tugmalari: qarz bo'lsa qarz, aks holda oylik. */
export function quickAmounts(debt: number, monthlyFee: number): { full: number | null; half: number | null } {
  const base = debt > 0 ? debt : monthlyFee > 0 ? monthlyFee : 0
  if (base <= 0 || base > BOT_MAX_AMOUNT) return { full: null, half: null }
  return { full: base, half: halfOf(base) }
}
