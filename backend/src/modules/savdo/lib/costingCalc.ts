// Sotishdan oldin narx belgilash: tannarx + ulushli xarajat + ustama (marja).
const r2 = (n: number): number => Math.round(n * 100) / 100

/** Tavsiya narx = tannarx * (1 + xarajat%) * (1 + ustama%). */
export function recommendPrice(cost: number, overheadPct: number, markupPct: number): number {
  if (!(cost >= 0)) return 0
  return r2(cost * (1 + Math.max(0, overheadPct) / 100) * (1 + Math.max(0, markupPct) / 100))
}

/** Davr xarajatlarining sotilgan tovar tannarxiga nisbati (%), 0..500 ga chegaralangan. */
export function overheadPercent(expensesTotal: number, cogsTotal: number): number {
  if (!(cogsTotal > 0) || !(expensesTotal > 0)) return 0
  return Math.min(500, r2((expensesTotal / cogsTotal) * 100))
}

/** Sotuv narxidan foyda ulushi (%): narx > 0 bo'lsa. */
export function marginPercent(price: number, fullCost: number): number {
  if (!(price > 0)) return 0
  return r2(((price - fullCost) / price) * 100)
}
