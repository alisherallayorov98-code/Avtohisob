// EkoHisob — nazorat (monitoring) sof mantiqi (DB'siz, testlanadi).

import { uztParts, shiftMonth, currentMonthUz } from './uzt'

/**
 * "Joriy oy tugamagan" qoidasi: joriy oy faqat oyning ma'lum kunidan KEYIN
 * "to'lanmagan" deb hisoblanadi. Aks holda oyning 3-kunida hamma mijoz
 * "to'xtagan"dek ko'rinardi.
 *
 * Kesim kuni = max(paymentDueDay, MIN_CUTOFF_DAY): to'lov muddati sozlamasi (standart 1)
 * juda erta bo'lsa ham, mijozga kamida oy o'rtasigacha vaqt beriladi.
 */
export const MIN_CUTOFF_DAY = 15

export function cutoffDay(paymentDueDay: number | null | undefined): number {
  const d = Math.floor(Number(paymentDueDay) || 1)
  return Math.min(28, Math.max(MIN_CUTOFF_DAY, d))
}

/** Joriy oy baholash davriga kiradimi (UZT kun > kesim kuni). */
export function includeCurrentMonth(now: Date, paymentDueDay: number | null | undefined): boolean {
  const p = uztParts(now)
  if (!p) return false
  return p.day > cutoffDay(paymentDueDay)
}

/**
 * Tekshiriladigan oylar (o'sish tartibida, oxirgisi — oxirgi BAHOLANADIGAN oy).
 * Joriy oy hali kesim kunidan o'tmagan bo'lsa davr oldingi oy bilan tugaydi.
 */
export function evaluationMonths(count: number, now: Date, paymentDueDay: number | null | undefined): string[] {
  const n = Math.max(1, Math.floor(Number(count) || 1))
  const cur = currentMonthUz(now)
  const end = includeCurrentMonth(now, paymentDueDay) ? cur : shiftMonth(cur, -1)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(end, -i))
  return out
}
