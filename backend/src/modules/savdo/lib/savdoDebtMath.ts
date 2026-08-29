// Savdo — mijoz qarzini hisoblashning YAGONA yadrosi. Qarz saqlanmaydi,
// har doim sotuv+to'lov massividan qayta hisoblanadi (EkoHisob debtMath.ts
// bilan bir xil yondashuv — chargeRowStatus).

export interface SaleForDebt {
  id: string
  totalAmount: number
  status: 'completed' | 'cancelled'
}

export interface PaymentForDebt {
  saleId: string | null
  amount: number
}

export interface SaleDebt {
  saleId: string
  totalAmount: number
  paid: number
  balance: number
}

export interface CustomerDebtResult {
  saleDebts: SaleDebt[]
  /** Fakturaga bog'lanmagan (avans) to'lovlar yig'indisi — umumiy qarzni kamaytiradi */
  advanceCredit: number
  /** Yakuniy qarz: Σ balance − advanceCredit, manfiyga tushmaydi */
  totalDebt: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Har bir faktura (sale) bo'yicha qolgan qarzni hisoblaydi */
export function computeSaleDebts(sales: SaleForDebt[], payments: PaymentForDebt[]): SaleDebt[] {
  const paidBySale = new Map<string, number>()
  for (const p of payments) {
    if (!p.saleId) continue
    paidBySale.set(p.saleId, (paidBySale.get(p.saleId) || 0) + p.amount)
  }

  return sales
    .filter(s => s.status !== 'cancelled')
    .map(s => {
      const paid = round2(paidBySale.get(s.id) || 0)
      const balance = Math.max(0, round2(s.totalAmount - paid))
      return { saleId: s.id, totalAmount: s.totalAmount, paid, balance }
    })
}

/**
 * Mijozning umumiy qarzi: barcha fakturalar qoldig'i yig'indisi, ortiqcha
 * (fakturaga bog'lanmagan) to'lovlar hisobga olingan holda kamaytiriladi.
 */
export function computeCustomerDebt(sales: SaleForDebt[], payments: PaymentForDebt[]): CustomerDebtResult {
  const saleDebts = computeSaleDebts(sales, payments)
  const grossDebt = round2(saleDebts.reduce((sum, d) => sum + d.balance, 0))
  const advanceCredit = round2(payments.filter(p => !p.saleId).reduce((sum, p) => sum + p.amount, 0))
  const totalDebt = Math.max(0, round2(grossDebt - advanceCredit))
  return { saleDebts, advanceCredit, totalDebt }
}
