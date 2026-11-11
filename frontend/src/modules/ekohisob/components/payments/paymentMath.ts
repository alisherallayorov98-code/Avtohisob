/**
 * To'lov modalining sof hisob yordamchilari (React'siz).
 * Haqiqiy taqsimotni backend (`paymentAllocation.allocatePayment`) qaytaradi;
 * bu yerdagi `previewAllocation` faqat to'lovdan OLDIN ko'rsatish uchun va
 * backend qoidasi bilan bir xil: tanlangan oy -> eng eski qarz -> avans.
 */

export interface Allocation { month: string; amount: number }
export interface OpenDebt { month: string; debt: number }

export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** "150 000" / "150000" / 150000 -> 150000 (raqam bo'lmasa 0) */
export function parseAmount(v: string | number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0
  return parseInt(String(v).replace(/\D/g, ''), 10) || 0
}

/** Jami ochiq qarz = tanlangan oy qoldig'i + boshqa ochiq qarz oylari. */
export function totalDebt(monthRemaining: number, openDebts: OpenDebt[]): number {
  return Math.max(0, monthRemaining) + openDebts.reduce((s, d) => s + Math.max(0, d.debt), 0)
}

export function previewAllocation(
  amount: number,
  selectedMonth: string,
  selectedRemaining: number,
  openDebts: OpenDebt[],
): Allocation[] {
  let left = amount
  const out: Allocation[] = []
  const add = (month: string, value: number) => {
    if (value <= 0) return
    const found = out.find(a => a.month === month)
    if (found) found.amount += value
    else out.push({ month, amount: value })
  }
  const toSelected = Math.min(left, Math.max(0, selectedRemaining))
  add(selectedMonth, toSelected)
  left -= toSelected
  for (const d of [...openDebts].sort((a, b) => a.month.localeCompare(b.month))) {
    if (left <= 0) break
    const take = Math.min(left, d.debt)
    add(d.month, take)
    left -= take
  }
  if (left > 0) add(selectedMonth, left)   // avans
  return out
}

/** Taqsimotdan avans (barcha qarz yopilgandan ortgani) */
export function advanceOf(amount: number, monthRemaining: number, openDebts: OpenDebt[]): number {
  return Math.max(0, amount - totalDebt(monthRemaining, openDebts))
}

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Naqd' },
  { value: 'card', label: 'Karta' },
  { value: 'transfer', label: "O'tkazma" },
  { value: 'online', label: 'Onlayn' },
] as const
export type PaymentMethod = typeof PAYMENT_METHODS[number]['value']
