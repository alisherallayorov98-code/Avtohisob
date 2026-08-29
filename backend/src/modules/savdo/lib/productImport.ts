// Savdo — mahsulot katalogini Excel orqali ommaviy yuklash uchun SOF mantiq.
// Bu fayl DB'ga bog'liq emas: faqat qatorlarni tekshiradi va xulosa hisoblaydi.
// Controller (controllers/productImport.ts) fayldan o'qiydi va shu funksiyalarni chaqiradi.

export interface RawProductRow {
  sku: unknown
  name: unknown
  category: unknown
  unit: unknown
  wholesalePrice: unknown
  retailPrice: unknown
}

export interface ParsedProductRow {
  rowNumber: number
  sku: string
  name: string
  category: string | null
  unit: string
  wholesalePrice: number
  retailPrice: number
  errors: string[]
}

export interface ImportSummary {
  toCreate: number
  toUpdate: number
  invalid: number
  total: number
}

const DEFAULT_UNIT = 'dona'

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  // ExcelJS ba'zan {text, result, richText} obyekt qaytaradi — matnini olamiz.
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text.trim()
    if (obj.result !== undefined) return String(obj.result).trim()
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((r: any) => String(r?.text ?? '')).join('').trim()
    }
  }
  return String(value).trim()
}

/**
 * Narxni o'qiydi. Bo'sh bo'lsa 0. Raqam bo'lmasa yoki manfiy bo'lsa xato qaytaradi.
 * Qaytadi: [qiymat, xato|null]
 */
function parsePrice(value: unknown, label: string): [number, string | null] {
  const text = toText(value).replace(/\s/g, '').replace(/,/g, '.')
  if (text === '') return [0, null]
  const num = Number(text)
  if (!Number.isFinite(num)) return [0, `${label} raqam bo'lishi kerak`]
  if (num < 0) return [0, `${label} manfiy bo'lishi mumkin emas`]
  return [num, null]
}

/**
 * Excel qatorlarini tekshiradi va normallashtiradi.
 * @param rows  xom qatorlar (sarlavha qatorisiz)
 * @param startRow  birinchi qatorning Excel'dagi raqami (sarlavha 1-qator bo'lgani uchun standart 2)
 */
export function parseProductRows(rows: RawProductRow[], startRow = 2): ParsedProductRow[] {
  const seenSkus = new Set<string>()
  const result: ParsedProductRow[] = []

  rows.forEach((raw, index) => {
    const errors: string[] = []

    const sku = toText(raw.sku)
    const name = toText(raw.name)
    const categoryText = toText(raw.category)
    const unitText = toText(raw.unit)

    if (!sku) {
      errors.push('SKU bo\'sh')
    } else {
      const key = sku.toLowerCase()
      if (seenSkus.has(key)) errors.push('Faylda SKU takrorlangan')
      else seenSkus.add(key)
    }

    if (!name) errors.push('Nomi bo\'sh')

    const [wholesalePrice, wErr] = parsePrice(raw.wholesalePrice, 'Optom narx')
    if (wErr) errors.push(wErr)
    const [retailPrice, rErr] = parsePrice(raw.retailPrice, 'Chakana narx')
    if (rErr) errors.push(rErr)

    result.push({
      rowNumber: startRow + index,
      sku,
      name,
      category: categoryText || null,
      unit: unitText || DEFAULT_UNIT,
      wholesalePrice,
      retailPrice,
      errors,
    })
  })

  return result
}

/** Tekshirilgan qatorlar bo'yicha xulosa: nechtasi yangi, nechtasi yangilanadi, nechtasi xato. */
export function summarizeImport(parsed: ParsedProductRow[], existingSkus: Set<string>): ImportSummary {
  let toCreate = 0
  let toUpdate = 0
  let invalid = 0

  for (const row of parsed) {
    if (row.errors.length > 0) { invalid++; continue }
    if (existingSkus.has(row.sku)) toUpdate++
    else toCreate++
  }

  return { toCreate, toUpdate, invalid, total: parsed.length }
}
