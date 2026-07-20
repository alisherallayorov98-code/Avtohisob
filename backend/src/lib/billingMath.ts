// Billing davr hisobi — pure (DB'siz) mantiq. Bu sessiyada tuzatilgan xatoning
// (yillik to'lovchiga 12 oy o'rniga 1 oy berilishi) yadrosi shu yerda va test bilan
// qotiriladi. approveSubscription controller shu funksiyalarni ishlatadi.

/**
 * Kutilayotgan invoys summasi tarifning YILLIK narxiga tengmi?
 * Yillik va oylik narx bir xil bo'lsa (yillik chegirma yo'q) — hech qachon "yillik"
 * deb hisoblanmaydi (aks holda oylik to'lovchi ham 12 oy olib qolardi).
 */
export function isYearlyPayment(
  invoiceAmount: number | null | undefined,
  priceYearly: number | null | undefined,
  priceMonthly: number | null | undefined,
): boolean {
  const amt = Number(invoiceAmount)
  const yearly = Number(priceYearly)
  const monthly = Number(priceMonthly)
  return amt > 0 && yearly > 0 && amt === yearly && yearly !== monthly
}

/** Boshlanish sanasidan davr oxirini hisoblaydi: yillik → +12 oy, oylik → +1 oy. */
export function computePeriodEnd(start: Date, yearly: boolean): Date {
  const end = new Date(start)
  end.setMonth(end.getMonth() + (yearly ? 12 : 1))
  return end
}
