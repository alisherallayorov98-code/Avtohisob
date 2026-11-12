// Miqdorlar DB'da Decimal(14,3). Prisma Decimal'ni ichki hisobda oddiy songa
// aylantirish va 3 xonaga yaxlitlash yordamchilari (Decimal.valueOf() string
// qaytaradi — `+` va `<` bilan to'g'ridan-to'g'ri ishlatish xavfli).

export const qn = (v: unknown): number => Number(v ?? 0)

export const round3 = (v: number): number => Math.round((v + Number.EPSILON) * 1000) / 1000

/** Kiruvchi miqdorni tekshirib 3 xonaga yaxlitlaydi; noto'g'ri bo'lsa null. */
export function parseQty(v: unknown): number | null {
  const n = round3(Number(v))
  return Number.isFinite(n) && n > 0 ? n : null
}

const QTY_KEYS = new Set([
  'quantity', 'remainingQty', 'quantityOnHand', 'reorderLevel',
  'systemQty', 'countedQty', 'diffQty', 'receivedQuantity',
])

function isDecimalLike(v: unknown): boolean {
  return typeof v === 'string' || (!!v && typeof v === 'object' && !Array.isArray(v) && 'toFixed' in (v as any))
}

/**
 * API javobidagi miqdor maydonlarini (Decimal -> "5.000" matn) songa aylantiradi,
 * frontend `Number()` qilmasdan ishlatishi uchun. Pul maydonlariga tegmaydi.
 */
export function numberizeQty(value: any): any {
  if (Array.isArray(value)) return value.map(numberizeQty)
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value
    if (typeof (value as any).toFixed === 'function' && typeof (value as any).toJSON === 'function') return value
    const out: any = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = QTY_KEYS.has(k) && isDecimalLike(v) ? Number(v as any) : numberizeQty(v)
    }
    return out
  }
  return value
}
