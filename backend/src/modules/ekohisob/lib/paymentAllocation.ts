// EkoHisob — to'lovni oylar bo'yicha taqsimlash (FIFO).
//
// Nega kerak: inspektor naqd pul oladi va bitta oyni tanlaydi. Agar to'lovchi
// qolgan qarzdan KO'P bersa, ortiqcha summa eng eski qarzdan boshlab yopilishi
// kerak — buxgalteriyadagi odatiy tartib. Ilgari ortiqcha summa tanlangan
// oyning hisobida qolib ketardi, modal esa "keyingi oyga o'tkaziladi" deb
// yozardi: eski oy ochiq qolar, tashkilot qarzdor ko'rinishda qolaverardi.
//
// Bu real mijozlarning pulidir — o'zgartirishdan oldin test.

/** Bir oy uchun qolgan qarz. Manba rejimga bog'liq: charge yoki talon yig'indisi. */
export interface DebtMonth {
  month: string
  /** shu oyda qolgan qarz (so'm), 0 yoki manfiy bo'lsa e'tiborga olinmaydi */
  debt: number
}

export interface Allocation {
  month: string
  amount: number
}

export interface AllocationResult {
  /** Oylar bo'yicha taqsimot — har biriga alohida to'lov yozuvi yaratiladi. */
  allocations: Allocation[]
  /** Barcha qarz yopilgandan keyin ortib qolgan summa (avans, tanlangan oyga yoziladi). */
  advance: number
  /** Tanlangan oydan tashqari yopilgan qarz (UI "eski qarzga o'tdi" deb ko'rsatadi). */
  appliedToOlder: number
}

const num = (v: number | string | null | undefined): number => Math.trunc(Number(v) || 0)

/**
 * To'lovni oylarga taqsimlaydi:
 *  1. avval TANLANGAN oyning qarzi yopiladi;
 *  2. ortgani eng ESKI qarzdan boshlab (oy o'sish tartibida) yopiladi;
 *  3. barcha qarz yopilgandan keyin qolgani tanlangan oyga avans bo'lib qo'shiladi.
 *
 * Oddiy holat (summa ≤ tanlangan oy qarzi) — bitta taqsimot, xatti-harakat
 * avvalgidek. Qarzsiz tashkilot (`debts` bo'sh) ham bitta taqsimot oladi.
 */
export function allocatePayment(
  amount: number | string,
  selectedMonth: string,
  debts: DebtMonth[],
): AllocationResult {
  let left = num(amount)
  if (left <= 0) return { allocations: [], advance: 0, appliedToOlder: 0 }

  const allocations: Allocation[] = []
  const push = (month: string, value: number) => {
    if (value <= 0) return
    const existing = allocations.find(a => a.month === month)
    if (existing) existing.amount += value
    else allocations.push({ month, amount: value })
  }

  // 1. Tanlangan oy
  const selected = debts.find(d => d.month === selectedMonth)
  const selectedDebt = Math.max(0, num(selected?.debt))
  const toSelected = Math.min(left, selectedDebt)
  push(selectedMonth, toSelected)
  left -= toSelected

  // 2. Qolgan qarzlar — eng eskisidan
  let appliedToOlder = 0
  if (left > 0) {
    const others = debts
      .filter(d => d.month !== selectedMonth && num(d.debt) > 0)
      .sort((a, b) => a.month.localeCompare(b.month))
    for (const d of others) {
      if (left <= 0) break
      const take = Math.min(left, num(d.debt))
      push(d.month, take)
      appliedToOlder += take
      left -= take
    }
  }

  // 3. Avans — tanlangan oyda qoladi
  const advance = left
  if (advance > 0) push(selectedMonth, advance)

  // Tanlangan oy doim birinchi qatorda (kvitansiya shu oy nomiga yoziladi),
  // qolganlari oy tartibida — inspektor natijani o'qiy olsin.
  allocations.sort((a, b) => {
    if (a.month === selectedMonth) return -1
    if (b.month === selectedMonth) return 1
    return a.month.localeCompare(b.month)
  })

  return { allocations, advance, appliedToOlder }
}
