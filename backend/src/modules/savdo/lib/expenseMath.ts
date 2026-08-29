// Savdo — xarajat hisobga olish uchun SOF (DB'siz) hisob yadrosi.
// Sof foyda = yalpi foyda (sotuv - tannarx) - davr xarajatlari.
// Bu yerda faqat pure funksiyalar — kontroller ham, dashboard ham shu yadroni
// import qiladi (mantiq ikki joyda takrorlanmasligi uchun).

export const EXPENSE_CATEGORIES: readonly string[] = [
  'ijara',
  'transport',
  'ish_haqi',
  'kommunal',
  'soliq',
  'boshqa',
]

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  ijara: 'Ijara',
  transport: 'Transport',
  ish_haqi: 'Ish haqi',
  kommunal: 'Kommunal',
  soliq: 'Soliq',
  boshqa: 'Boshqa',
}

/** Pul summasini 2 xonagacha yaxlitlaydi (suzuvchi nuqta xatosisiz). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function isValidCategory(c: unknown): boolean {
  return typeof c === 'string' && EXPENSE_CATEGORIES.includes(c)
}

/**
 * Xarajatlar yig'indisi. Bekor qilingan yozuvlar HISOBGA OLINMAYDI —
 * bekor qilish o'chirmaydi (audit izi qoladi), lekin summaga qo'shilmaydi.
 */
export function sumExpenses(rows: { amount: number; cancelled?: boolean }[]): number {
  let total = 0
  for (const r of rows) {
    if (r.cancelled) continue
    const amount = Number(r.amount)
    if (!Number.isFinite(amount)) continue
    total += amount
  }
  return round2(total)
}

export interface ExpenseCategoryGroup {
  category: string
  label: string
  total: number
  share: number
}

/**
 * Kategoriya bo'yicha guruhlash: summa va umumiy xarajatdagi ulush (foizda).
 * Umumiy summa 0 bo'lsa ulush 0 (nolga bo'lish yo'q).
 * Natija summa bo'yicha kamayish tartibida.
 */
export function groupExpensesByCategory(
  rows: { category: string; amount: number; cancelled?: boolean }[]
): ExpenseCategoryGroup[] {
  const totals = new Map<string, number>()
  for (const r of rows) {
    if (r.cancelled) continue
    const amount = Number(r.amount)
    if (!Number.isFinite(amount)) continue
    const key = isValidCategory(r.category) ? r.category : 'boshqa'
    totals.set(key, (totals.get(key) || 0) + amount)
  }

  const grand = Array.from(totals.values()).reduce((a, b) => a + b, 0)

  return Array.from(totals.entries())
    .map(([category, sum]) => ({
      category,
      label: EXPENSE_CATEGORY_LABELS[category] || category,
      total: round2(sum),
      share: grand > 0 ? round2((sum / grand) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
}

/** Sof foyda = yalpi foyda - xarajatlar. Salbiy bo'lishi mumkin (zarar). */
export function computeNetProfit(grossProfit: number, totalExpenses: number): number {
  const gross = Number.isFinite(Number(grossProfit)) ? Number(grossProfit) : 0
  const expenses = Number.isFinite(Number(totalExpenses)) ? Number(totalExpenses) : 0
  return round2(gross - expenses)
}
