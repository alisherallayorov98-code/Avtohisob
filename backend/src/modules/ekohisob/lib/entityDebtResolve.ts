// Tashkilot qarzini kanonik SQL qatoridan (reportQueries.queryEntityDebts) yagona shaklga keltiradi.
// Pure (DB'siz) — testlanadi. Kartochka, eslatma, SMS, kunlik xulosa, faktura va hisobot
// SHU orqali bir xil qarz ko'rsatadi.

import { computeEntityDebt } from './debtMath'

/** queryEntityDebts qatori shakli (reportQueries.EntityDebtRow bilan mos). */
export interface CanonRowLike {
  debt: number
  advance: number
  months: number
  unpaidMonths: string[]
}

export interface ResolvedDebt {
  totalDebt: number
  unpaidMonths: string[]
  debtMonths: number
  /** ortiqcha to'lov (avans); totalDebt > 0 bo'lsa 0 */
  advance: number
}

/**
 * monthly_fixed / talon: kanonik qator (qatori yo'q = qarz ham avans ham 0).
 * variable: qarz to'planmaydi — faqat joriy oy holati (debtMath.computeEntityDebt).
 */
export function resolveEntityDebt(
  billingMode: string,
  row: CanonRowLike | undefined | null,
  ctx?: { currentMonth?: string; paidCurrentMonth?: boolean },
): ResolvedDebt {
  if (billingMode === 'monthly_fixed' || billingMode === 'talon') {
    return {
      totalDebt: row?.debt ?? 0,
      unpaidMonths: row?.unpaidMonths ?? [],
      debtMonths: row?.months ?? 0,
      advance: row?.advance ?? 0,
    }
  }
  const v = computeEntityDebt({
    billingMode, currentMonth: ctx?.currentMonth, paidCurrentMonth: ctx?.paidCurrentMonth,
  })
  return { totalDebt: v.totalDebt, unpaidMonths: v.unpaidMonths, debtMonths: v.debtMonths, advance: 0 }
}
