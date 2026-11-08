// Hisobot sana oralig'i — O'zbekiston kuni (UTC+5) chegarasi bilan.
// Muammo: frontend "2026-11-08" yuboradi, `new Date('2026-11-08')` esa 00:00 UTC (= 05:00 UZT) bo'ladi.
// "gacha" sanasi uchun bu butun oxirgi kunni tashlab yuborar edi (bugungi yozuvlar hisobotda ko'rinmasdi).

const UZT_OFFSET_MS = 5 * 3600 * 1000
const DAY_MS = 86400000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function parseDateOnly(s: string): number | null {
  if (!DATE_ONLY.test(s)) return null
  const t = Date.parse(`${s}T00:00:00Z`)
  return Number.isNaN(t) ? null : t
}

/** "Dan" — kunning boshi (UZT 00:00). To'liq ISO berilsa o'zgarishsiz. Noto'g'ri qiymat — undefined */
export function reportFrom(s?: string | null): Date | undefined {
  if (!s) return undefined
  const d = parseDateOnly(s)
  if (d != null) return new Date(d - UZT_OFFSET_MS)
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? undefined : t
}

/** "Gacha" — kunning oxiri (UZT 23:59:59.999), shu kun to'liq kiradi. To'liq ISO berilsa o'zgarishsiz. */
export function reportTo(s?: string | null): Date | undefined {
  if (!s) return undefined
  const d = parseDateOnly(s)
  if (d != null) return new Date(d - UZT_OFFSET_MS + DAY_MS - 1)
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? undefined : t
}

/** Prisma uchun { gte, lte } yoki hech narsa */
export function reportRange(from?: string | null, to?: string | null): { gte?: Date; lte?: Date } | undefined {
  const gte = reportFrom(from)
  const lte = reportTo(to)
  if (!gte && !lte) return undefined
  return { ...(gte && { gte }), ...(lte && { lte }) }
}

/**
 * Oldingi teng davr: [from, to] uchun uning oldidagi xuddi shu uzunlikdagi davr.
 * Davr ikkala chegarasi bilan berilgan bo'lsagina qaytadi.
 */
export function previousRange(from?: string | null, to?: string | null): { gte: Date; lte: Date } | null {
  const gte = reportFrom(from)
  const lte = reportTo(to)
  if (!gte || !lte || lte < gte) return null
  const span = lte.getTime() - gte.getTime() + 1
  return { gte: new Date(gte.getTime() - span), lte: new Date(gte.getTime() - 1) }
}
