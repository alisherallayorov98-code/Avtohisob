// EkoHisob — to'lovni oylar bo'yicha taqsimlash (FIFO).
//
// Nega kerak: inspektor naqd pul oladi va bitta oyni tanlaydi. Agar to'lovchi
// qolgan qarzdan KO'P bersa, ortiqcha summa eng eski qarzdan boshlab yopilishi
// kerak — buxgalteriyadagi odatiy tartib. Ilgari ortiqcha summa tanlangan
// oyning hisobida qolib ketardi, modal esa "keyingi oyga o'tkaziladi" deb
// yozardi: eski oy ochiq qolar, tashkilot qarzdor ko'rinishda qolaverardi.
//
// INVARIANTLAR (testlanadi):
//  (i)  Σ allocations.amount == amount (aynan, bir tiyin ham yo'qolmaydi/ortmaydi);
//  (ii) har oyga taqsimot shu oyning qarzidan oshmaydi — AVANS bundan mustasno
//       (u tanlangan oyda, qarz yopilgandan KEYIN qoladigan qism);
//  (iii) barcha summalar butun va manfiy emas, NaN/Infinity yo'q.
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

/** Har qanday kirishni xavfsiz butun songa (>= 0) aylantiradi. NaN/Infinity/manfiy → 0. */
const num = (v: number | string | null | undefined): number => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

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

  // Bir oy bir necha marta kelsa (ikki manba) — qarzlar YIG'ILADI.
  const debtByMonth = new Map<string, number>()
  for (const d of debts) {
    const v = num(d.debt)
    if (v > 0) debtByMonth.set(d.month, (debtByMonth.get(d.month) ?? 0) + v)
  }

  const allocations: Allocation[] = []
  const push = (month: string, value: number) => {
    if (value <= 0) return
    const existing = allocations.find(a => a.month === month)
    if (existing) existing.amount += value
    else allocations.push({ month, amount: value })
  }

  // 1. Tanlangan oy
  const toSelected = Math.min(left, debtByMonth.get(selectedMonth) ?? 0)
  push(selectedMonth, toSelected)
  left -= toSelected

  // 2. Qolgan qarzlar — eng eskisidan
  let appliedToOlder = 0
  if (left > 0) {
    const others = [...debtByMonth.entries()]
      .filter(([m]) => m !== selectedMonth)
      .sort((a, b) => a[0].localeCompare(b[0]))
    for (const [month, debt] of others) {
      if (left <= 0) break
      const take = Math.min(left, debt)
      push(month, take)
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
