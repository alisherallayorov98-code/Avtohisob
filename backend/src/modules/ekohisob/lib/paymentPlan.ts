// EkoHisob — to'lov va bekor qilishning PURE rejasi (DB'siz, testlanadi).
//
// paymentService / paymentReversal faqat holatni o'qiydi, shu funksiyalardan REJA oladi va
// uni tranzaksiyada yozadi. Shunday qilib butun pul mantiqi (taqsimot, charge/talon
// yangilanishi, qaytarish) DB'siz tekshiriladi: to'lov + bekor qilish = dastlabki holat.

import {
  chargeRowStatus, getEntityBalance, talonMonth, talonPaidPart,
} from './debtMath'
import { allocatePayment, Allocation, DebtMonth } from './paymentAllocation'
import {
  applyToTalons, reduceTalonPaid, talonReductionForMonth, TalonRow, TalonUpdate,
} from './talonPay'
import { ReversalRow, sumRowsByMonth } from './reversal'

export interface ChargeState {
  month: string
  expectedAmount: number
  paidAmount: number
}

export interface PlanInput {
  billingMode: string
  monthlyFee: number
  selectedMonth: string
  amount: number
  /** monthly_fixed: tashkilotning BARCHA hisoblari */
  charges?: ChargeState[]
  /** talon: tashkilotning talonlari (to'langanlari ham bo'lsa mayli) */
  talons?: TalonRow[]
}

export interface ChargeOp {
  month: string
  /** shu oyga qo'shiladigan to'lov */
  amount: number
  /** hisob (charge) yozuvi yo'q bo'lsa — yaratiladigan kutilgan summa; aks holda null */
  createExpected: number | null
}

export interface TalonOp extends TalonUpdate {
  month: string
}

export interface PaymentPlan {
  /** To'lovdan OLDIN oylar bo'yicha qarz (taqsimot shundan) */
  debtsBefore: DebtMonth[]
  allocations: Allocation[]
  advance: number
  appliedToOlder: number
  chargeOps: ChargeOp[]
  talonOps: TalonOp[]
  talonsClosed: number
}

/**
 * Ochiq qarzlar (oylar kesimida) — to'lov taqsimotining manbai.
 *  - monthly_fixed: kanonik balans (avans eng eski qarzlarni qoplaydi); tanlangan oyda
 *    hisob yozuvi hali bo'lmasa, belgilangan oylik to'lov qarz sifatida qo'shiladi;
 *  - talon: to'lanmagan talonlar (amount − paidAmount), sanasi bo'yicha oyga guruhlangan;
 *  - variable: qarz to'planmaydi — bo'sh.
 */
export function computeOpenDebts(input: Omit<PlanInput, 'amount'>): DebtMonth[] {
  if (input.billingMode === 'monthly_fixed') {
    const charges = [...(input.charges ?? [])]
    if (!charges.some(c => c.month === input.selectedMonth) && input.monthlyFee > 0) {
      charges.push({ month: input.selectedMonth, expectedAmount: input.monthlyFee, paidAmount: 0 })
    }
    const b = getEntityBalance({ billingMode: 'monthly_fixed', charges })
    return b.months.filter(m => m.debt > 0).map(m => ({ month: m.month, debt: m.debt }))
  }
  if (input.billingMode === 'talon') {
    const byMonth = new Map<string, number>()
    for (const t of input.talons ?? []) {
      const m = talonMonth(t.date)
      if (!m) continue
      const debt = Math.max(0, Math.trunc(Number(t.amount) || 0)) - talonPaidPart(t)
      if (debt > 0) byMonth.set(m, (byMonth.get(m) ?? 0) + debt)
    }
    return [...byMonth].sort((a, b) => a[0].localeCompare(b[0])).map(([month, debt]) => ({ month, debt }))
  }
  return []
}

export function planPayment(input: PlanInput): PaymentPlan {
  const debtsBefore = computeOpenDebts(input)
  const { allocations, advance, appliedToOlder } = allocatePayment(input.amount, input.selectedMonth, debtsBefore)

  const chargeOps: ChargeOp[] = []
  const talonOps: TalonOp[] = []
  let talonsClosed = 0

  for (const alloc of allocations) {
    if (input.billingMode === 'monthly_fixed') {
      const exists = (input.charges ?? []).some(c => c.month === alloc.month)
      chargeOps.push({
        month: alloc.month,
        amount: alloc.amount,
        createExpected: !exists && input.monthlyFee > 0 ? input.monthlyFee : null,
      })
    } else if (input.billingMode === 'talon') {
      const monthTalons = (input.talons ?? []).filter(t => talonMonth(t.date) === alloc.month)
      const r = applyToTalons(monthTalons, alloc.amount)
      talonsClosed += r.closed
      for (const u of r.updates) talonOps.push({ ...u, month: alloc.month })
    }
  }
  return { debtsBefore, allocations, advance, appliedToOlder, chargeOps, talonOps, talonsClosed }
}

/** Reja natijasini holatga qo'llaydi (testlar va simulyatsiya uchun; DB yozuvi emas). */
export function applyPlanToState(
  state: { charges: ChargeState[]; talons: TalonRow[] },
  plan: PaymentPlan,
  monthlyFee: number,
): { charges: ChargeState[]; talons: TalonRow[] } {
  const charges = state.charges.map(c => ({ ...c }))
  for (const op of plan.chargeOps) {
    const c = charges.find(x => x.month === op.month)
    if (c) c.paidAmount += op.amount
    else if (op.createExpected != null) {
      charges.push({ month: op.month, expectedAmount: op.createExpected ?? monthlyFee, paidAmount: op.amount })
    }
  }
  const talons = state.talons.map(t => ({ ...t }))
  for (const op of plan.talonOps) {
    const t = talons.find(x => x.id === op.id)
    if (t) { t.paidAmount = op.paidAmount; t.paid = op.paid }
  }
  return { charges, talons }
}

export interface ReversalPlanInput {
  billingMode: string
  rows: ReversalRow[]
  charges?: ChargeState[]
  talons?: TalonRow[]
  /** Guruh qatorlari O'CHIRILGANDAN KEYIN har oyda qolgan to'lovlar yig'indisi (talon uchun) */
  remainingPaymentsByMonth?: Map<string, number>
  /** Birinchi navbatda to'lovi kamaytiriladigan talonlar (talonni "to'lanmagan"ga qaytarishda) */
  preferTalonIds?: string[]
}

export interface ReversalPlan {
  chargeOps: { month: string; paidAmount: number; status: 'open' | 'partial' | 'paid' }[]
  talonOps: TalonOp[]
  totalAmount: number
}

export function planReversal(input: ReversalPlanInput): ReversalPlan {
  const byMonth = sumRowsByMonth(input.rows)
  const totalAmount = [...byMonth.values()].reduce((s, v) => s + v, 0)
  const chargeOps: ReversalPlan['chargeOps'] = []
  const talonOps: TalonOp[] = []

  for (const [month, reversed] of byMonth) {
    const charge = (input.charges ?? []).find(c => c.month === month)
    if (charge) {
      const paidAmount = Math.max(0, Math.trunc(charge.paidAmount) - reversed)
      chargeOps.push({ month, paidAmount, status: chargeRowStatus(charge.expectedAmount, paidAmount) })
    }
    if (input.billingMode === 'talon') {
      const monthTalons = (input.talons ?? []).filter(t => talonMonth(t.date) === month)
      const remaining = input.remainingPaymentsByMonth?.get(month) ?? 0
      const reduceBy = talonReductionForMonth(monthTalons, remaining, reversed)
      for (const u of reduceTalonPaid(monthTalons, reduceBy, input.preferTalonIds ?? []).updates) talonOps.push({ ...u, month })
    }
  }
  return { chargeOps, talonOps, totalAmount }
}
