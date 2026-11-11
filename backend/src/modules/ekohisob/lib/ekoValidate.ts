// Kiruvchi maydonlarni tekshirish — PURE (kontrollerlar shu yerdan oladi).

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

export const MAX_FEE = 1_000_000_000

/** Koordinata: ikkalasi ham chekli raqam, diapazonda, (0,0) "null island" emas. Raqam-matn ham qabul qilinadi. */
export function validateLatLon(lat: unknown, lon: unknown): Validated<{ lat: number; lon: number }> {
  const toNum = (v: unknown): number => {
    if (typeof v === 'number') return v
    if (typeof v === 'string' && v.trim() !== '') return Number(v.trim().replace(',', '.'))
    return NaN
  }
  const la = toNum(lat), lo = toNum(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return { ok: false, error: "Joylashuv koordinatalari noto'g'ri" }
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return { ok: false, error: "Joylashuv koordinatalari noto'g'ri" }
  if (la === 0 && lo === 0) return { ok: false, error: "Joylashuv koordinatalari noto'g'ri (0, 0)" }
  return { ok: true, value: { lat: la, lon: lo } }
}

/**
 * Pul summasi (oylik / kub narxi): butun, 0..1e9. undefined/null/'' → 0.
 * "450000" (matn) qabul qilinadi; "45.5", "abc", NaN, manfiy — rad.
 */
export function parseMoneyInt(v: unknown, label = 'Summa'): Validated<number> {
  if (v === undefined || v === null || v === '') return { ok: true, value: 0 }
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim().replace(/\s/g, '')) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: `${label} butun son bo'lishi kerak` }
  if (n < 0) return { ok: false, error: `${label} manfiy bo'lishi mumkin emas` }
  if (n > MAX_FEE) return { ok: false, error: `${label} juda katta (maksimum ${MAX_FEE.toLocaleString('en-US').replace(/,/g, ' ')})` }
  return { ok: true, value: n }
}

/** page/limit: NaN, manfiy, juda katta qiymatlardan himoya. */
export function parsePageParams(
  page: unknown,
  limit: unknown,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; skip: number } {
  const defLimit = opts.defaultLimit ?? 50
  const maxLimit = opts.maxLimit ?? 200
  const p = parseInt(String(page ?? ''), 10)
  const l = parseInt(String(limit ?? ''), 10)
  const pg = Number.isFinite(p) && p >= 1 ? Math.min(p, 1_000_000) : 1
  const lim = Number.isFinite(l) && l >= 1 ? Math.min(l, maxLimit) : defLimit
  return { page: pg, limit: lim, skip: (pg - 1) * lim }
}

/** Matn maydoni: trim, uzunlik chegarasi. Bo'sh → null. */
export function cleanText(v: unknown, max: number, label: string): Validated<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (typeof v !== 'string' && typeof v !== 'number') return { ok: false, error: `${label} matn bo'lishi kerak` }
  const s = String(v).trim()
  if (s.length > max) return { ok: false, error: `${label} ${max} belgidan oshmasligi kerak` }
  return { ok: true, value: s || null }
}

export const ENTITY_STATUS_FILTER = ['active', 'blacklisted', 'inactive', 'draft'] as const
export const BILLING_MODES = ['monthly_fixed', 'variable', 'talon'] as const

export function isEntityStatusFilter(v: unknown): v is (typeof ENTITY_STATUS_FILTER)[number] {
  return typeof v === 'string' && (ENTITY_STATUS_FILTER as readonly string[]).includes(v)
}

/** Excel kataklariga yoziladigan matnda formula in'ektsiyasidan himoya (= + - @ bilan boshlansa). */
export function safeCell(v: unknown): unknown {
  if (typeof v !== 'string') return v
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}
