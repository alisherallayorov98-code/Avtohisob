// EkoHisob pul mantiqi — yagona kanonik manba (DB'siz, testlanadi).
// Charge holati va qarz darajasi avval 3 joyda takrorlanardi (payments.recordPayment,
// charges timeline, scheduler.updateEkoDebtLevels) — endi bitta joyda, test bilan.
// Bular real foydalanuvchilarning qarzi, qora ro'yxati va SMS eslatmasiga ta'sir qiladi.

/**
 * To'lov holati: kutilgan (expected) va to'langan (paid) summadan.
 *  - to'lov bor (paid > 0): to'liqmi → 'paid', kammi → 'partial'
 *  - to'lov yo'q (paid = 0): monthly_fixed yoki kutilgan summa bor → 'unpaid';
 *    variable (kutilmaydigan) → 'none'
 * INVARIANT: EkoHisob to'lovlari doim amount > 0 (recordPayment tekshiradi),
 * shuning uchun "to'lov bor" ⟺ paid > 0.
 */
export function computeChargeStatus(
  expectedAmount: number | null | undefined,
  paidAmount: number | null | undefined,
  billingMode?: string,
): 'paid' | 'partial' | 'unpaid' | 'none' {
  const paid = Number(paidAmount) || 0
  const expected = expectedAmount == null ? null : Number(expectedAmount)
  if (paid > 0) {
    return expected != null && paid < expected ? 'partial' : 'paid'
  }
  // To'lov yo'q — asl timeline mantig'iga aynan mos: faqat billingMode'ga qaraymiz
  // (kutilgan summa bo'lsa ham, variable tashkilotda 'none' qoladi).
  return billingMode === 'monthly_fixed' ? 'unpaid' : 'none'
}

/**
 * Qarz darajasi: ochiq (to'lanmagan/qisman) hisoblar soniga qarab.
 * 0 → joriy (qarzsiz), 1 → ogohlantirish, 2 → muddati o'tgan, 3+ → kritik.
 * Bu daraja qora ro'yxat va eslatma bosqichlarini belgilaydi.
 *
 * `dueDay` (ixtiyoriy, default 1) — to'lov muddati (oyning kuni). dueDay > 1 bo'lsa va
 * `ctx` berilsa: JORIY oy hisobi hali muddatiga yetmagan (bugun < dueDay) bo'lsa u
 * qarz darajasiga sanalmaydi. dueDay = 1 yoki ctx yo'q → avvalgi xatti-harakat.
 */
export function computeDebtLevel(
  openChargeCount: number,
  dueDay: number = 1,
  ctx?: { unpaidMonths: string[]; currentMonth: string; todayDay: number },
): 'current' | 'warning' | 'overdue' | 'critical' {
  let count = Number.isFinite(openChargeCount) ? Math.trunc(openChargeCount) : 0
  const due = Number.isFinite(dueDay) ? Math.min(31, Math.max(1, Math.trunc(dueDay))) : 1
  if (due > 1 && ctx && ctx.todayDay < due && ctx.unpaidMonths.includes(ctx.currentMonth)) {
    count -= 1
  }
  if (count <= 0) return 'current'
  if (count === 1) return 'warning'
  if (count === 2) return 'overdue'
  return 'critical'
}
