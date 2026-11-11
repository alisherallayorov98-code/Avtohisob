// EkoHisob qarz mantiqi — yagona kanonik manba (DB'siz, testlanadi).
//
// Nega kerak: qarz hisobi ilgari 6 joyda mustaqil takrorlanardi (ledger, kunlik ro'yxat,
// xarita, SMS eslatmasi, scheduler qarz darajasi, hisobot) va ular bir-biriga zid edi:
//  - ledger bir oydagi bir necha to'lovdan faqat oxirgisini olardi (qisman to'lov yo'qolardi);
//  - talon (bajarilgan ish) qarzi faqat SMS'da ko'rinardi, qolgan joyda 0 edi.
// Endi uchala to'lov rejimi (monthly_fixed | variable | talon) uchun qarz shu yerda,
// bitta funksiyada hisoblanadi. Bu real mijozlarning pulidir — o'zgartirishdan oldin test.

import { computeChargeStatus } from './chargeMath'

export type BillingMode = 'monthly_fixed' | 'variable' | 'talon' | string

/** Bir oydagi to'lovlar yig'indisi. */
export interface MonthlyPayment {
  paid: number
  count: number
  lastPaidAt: Date | null
}

export interface PaymentLike {
  month: string
  amount: number | string
  paidAt?: Date | string | null
}

export interface ChargeLike {
  month: string
  expectedAmount: number | string
  paidAmount: number | string
}

export interface TalonLike {
  date: Date | string
  amount: number | string
  paid?: boolean
  /** Qisman to'lov: shu talon bo'yicha to'langan summa (qarz = amount - paidAmount). */
  paidAmount?: number | string | null
}

const num = (v: number | string | null | undefined): number => Number(v) || 0

/**
 * To'lovlarni oy bo'yicha YIG'ADI (oxirgisini olmaydi).
 * Schema bir oyga bir necha to'lov yozuvini ataylab qo'llab-quvvatlaydi (qisman to'lov),
 * shuning uchun oy → to'lov moslashuvi doim yig'indi bo'lishi shart.
 */
export function sumPaymentsByMonth(payments: PaymentLike[]): Map<string, MonthlyPayment> {
  const out = new Map<string, MonthlyPayment>()
  for (const p of payments) {
    const cur = out.get(p.month) ?? { paid: 0, count: 0, lastPaidAt: null }
    cur.paid += num(p.amount)
    cur.count += 1
    if (p.paidAt) {
      const d = p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt)
      if (!Number.isNaN(d.getTime()) && (!cur.lastPaidAt || d > cur.lastPaidAt)) cur.lastPaidAt = d
    }
    out.set(p.month, cur)
  }
  return out
}

/** Sana → "YYYY-MM" (UTC bo'yicha — talon sanasi @db.Date, vaqt mintaqasi yo'q). */
export function talonMonth(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Talonning HAQIQIY to'langan summasi (0..amount).
 * `paid=true` bo'lsa — to'liq (eski yozuvlarda paidAmount ustuni yo'q edi, 0 turadi);
 * aks holda paidAmount, lekin amount dan oshmaydi va manfiy bo'lmaydi.
 */
export function talonPaidPart(t: Pick<TalonLike, 'amount' | 'paid' | 'paidAmount'>): number {
  const amount = Math.max(0, Math.trunc(num(t.amount)))
  if (t.paid) return amount
  return Math.min(amount, Math.max(0, Math.trunc(num(t.paidAmount))))
}

export interface TalonMonthSummary {
  /** shu oydagi barcha talonlar summasi */
  expected: number
  /** shu oydagi to'lanmagan talonlar summasi */
  unpaid: number
  /** shu oydagi to'langan talonlar summasi */
  paid: number
  count: number
  volume: number
}

/**
 * Talonlarni sanasi bo'yicha oyga guruhlaydi — talon qarzi ham "necha oy qarzdor"
 * ko'rinishida (monthly_fixed kabi) ko'rsatilishi uchun.
 */
export function groupTalonsByMonth(
  talons: (TalonLike & { volume?: number | string })[],
): Map<string, TalonMonthSummary> {
  const out = new Map<string, TalonMonthSummary>()
  for (const t of talons) {
    const m = talonMonth(t.date)
    if (!m) continue
    const cur = out.get(m) ?? { expected: 0, unpaid: 0, paid: 0, count: 0, volume: 0 }
    const amount = num(t.amount)
    const paidPart = talonPaidPart(t)
    cur.expected += amount
    cur.paid += paidPart
    cur.unpaid += Math.max(0, amount - paidPart)
    cur.count += 1
    cur.volume += num(t.volume)
    out.set(m, cur)
  }
  return out
}

/** Tashkilotning qarz holati — uchala rejim uchun bir xil shakl. */
export interface EntityDebt {
  /** jami qarz (so'm) */
  totalDebt: number
  /** qarz qolgan oylar, o'sish tartibida ("YYYY-MM") */
  unpaidMonths: string[]
  /** qarzdor oylar soni = unpaidMonths.length (qarz darajasi shundan) */
  debtMonths: number
}

export interface EntityDebtInput {
  billingMode: BillingMode
  /** monthly_fixed: hisoblar (ochiq/qisman yoki hammasi — funksiya o'zi filtrlaydi) */
  charges?: ChargeLike[]
  /** talon: tashkilotning talonlari */
  talons?: TalonLike[]
  /** variable: shu oy to'lov qilinganmi (qarz to'planmaydi, faqat joriy oy holati) */
  paidCurrentMonth?: boolean
  /** joriy oy "YYYY-MM" — variable rejimi uchun */
  currentMonth?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// KANONIK BALANS — qarzning YAGONA manbasi.
//
// QOIDA (qaror): ortiqcha to'langan oy (to'langan > kutilgan) AVANS hosil qiladi va
// u eng ESKI qarzdor oylarni qoplaydi (FIFO, xronologiyadan qat'i nazar).
//   qarz   = max(0, Σkutilgan − Σto'langan)
//   avans  = max(0, Σto'langan − Σkutilgan)
// Bu aynan akt sverkaning yakuniy saldosi (Σhisoblandi − Σto'landi) bilan mos:
// computeEntityDebt, akt sverka va oylik hisobot BIR dataset'da BIR XIL qarz beradi.
// Ilgari computeEntityDebt har oyni alohida qirqardi (max(0, kutilgan−to'langan)),
// ya'ni bir oydagi ortiqcha to'lov boshqa oy qarzini qoplamasdi — akt sverka esa
// qoplardi, ikki joyda ikki xil qarz chiqardi.
// ─────────────────────────────────────────────────────────────────────────────

export interface BalanceMonth {
  month: string
  expected: number
  paid: number
  /** avans qoplashdan KEYIN shu oyda qolgan qarz */
  debt: number
  /** shu oyning o'z ortiqcha to'lovi (avans manbai) */
  surplus: number
}

export interface EntityBalance {
  billingMode: BillingMode
  totalExpected: number
  totalPaid: number
  /** jami qarz (so'm, butun, >= 0) */
  totalDebt: number
  /** ortiqcha to'lov (avans) balansi (>= 0). totalDebt va advance bir vaqtda > 0 bo'lmaydi. */
  advance: number
  /** oylar bo'yicha taqsimot, oy o'sish tartibida (faqat ma'lumoti bor oylar) */
  months: BalanceMonth[]
  unpaidMonths: string[]
  debtMonths: number
}

export interface BalanceInput {
  billingMode: BillingMode
  /** monthly_fixed: hisoblar */
  charges?: ChargeLike[]
  /** talon: talonlar (amount, paid, paidAmount) */
  talons?: TalonLike[]
  /**
   * Ixtiyoriy: haqiqiy to'lovlar. monthly_fixed'da berilsa har oyning "to'langan"i
   * shu to'lovlardan olinadi (charge.paidAmount o'rniga) — to'lovi bor, lekin hisobi
   * yo'q oy ham avans bo'ladi. variable'da ular avans balansini beradi.
   * talon'da faqat `advance` (talonga tatbiq qilinmagan to'lov) uchun.
   */
  payments?: PaymentLike[]
}

const int = (v: unknown): number => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? n : 0
}

/** Avansni (surplus) eng eski qarzlarga FIFO bo'yicha qo'llaydi. Pure; yig'indi saqlanadi. */
export function applySurplusFifo(
  rows: { month: string; shortfall: number }[],
  surplus: number,
): { debts: Map<string, number>; advance: number } {
  let pool = Math.max(0, int(surplus))
  const debts = new Map<string, number>()
  for (const r of [...rows].sort((a, b) => a.month.localeCompare(b.month))) {
    const short = Math.max(0, int(r.shortfall))
    const take = Math.min(pool, short)
    pool -= take
    debts.set(r.month, (debts.get(r.month) ?? 0) + (short - take))
  }
  return { debts, advance: pool }
}

export function getEntityBalance(input: BalanceInput): EntityBalance {
  const { billingMode } = input
  const expectedBy = new Map<string, number>()
  const paidBy = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)

  const paymentsByMonth = new Map<string, number>()
  for (const p of input.payments ?? []) {
    if (!p.month) continue
    add(paymentsByMonth, p.month, Math.max(0, int(p.amount)))
  }

  if (billingMode === 'monthly_fixed') {
    for (const c of input.charges ?? []) {
      add(expectedBy, c.month, Math.max(0, int(c.expectedAmount)))
      if (!input.payments) add(paidBy, c.month, Math.max(0, int(c.paidAmount)))
    }
    if (input.payments) {
      for (const [m, v] of paymentsByMonth) add(paidBy, m, v)
    }
  } else if (billingMode === 'talon') {
    for (const t of input.talons ?? []) {
      const m = talonMonth(t.date)
      if (!m) continue
      add(expectedBy, m, Math.max(0, int(t.amount)))
      add(paidBy, m, talonPaidPart(t))
    }
  } else {
    // variable: oldindan majburiyat yo'q — qarz to'planmaydi.
    // Barcha to'lovlar kredit (avans) balansi sifatida hisoblanadi.
    const totalPaid = [...paymentsByMonth.values()].reduce((s, v) => s + v, 0)
    return {
      billingMode, totalExpected: 0, totalPaid, totalDebt: 0, advance: totalPaid,
      months: [...paymentsByMonth].sort((a, b) => a[0].localeCompare(b[0])).map(([month, paid]) => (
        { month, expected: 0, paid, debt: 0, surplus: paid }
      )),
      unpaidMonths: [], debtMonths: 0,
    }
  }

  const monthsAll = [...new Set([...expectedBy.keys(), ...paidBy.keys()])].sort()
  let surplusTotal = 0
  const shorts: { month: string; shortfall: number }[] = []
  const draft = monthsAll.map((month) => {
    const expected = expectedBy.get(month) ?? 0
    const paid = paidBy.get(month) ?? 0
    const surplus = Math.max(0, paid - expected)
    surplusTotal += surplus
    shorts.push({ month, shortfall: Math.max(0, expected - paid) })
    return { month, expected, paid, surplus }
  })

  const { debts, advance } = applySurplusFifo(shorts, surplusTotal)
  const months: BalanceMonth[] = draft.map(d => ({ ...d, debt: debts.get(d.month) ?? 0 }))
  const unpaidMonths = months.filter(m => m.debt > 0).map(m => m.month)
  const totalDebt = months.reduce((s, m) => s + m.debt, 0)

  // talon: talonga tatbiq etilmagan to'lov = avans (talon holati o'zi qisman yopilgan)
  let adv = advance
  if (billingMode === 'talon' && input.payments) {
    const applied = months.reduce((s, m) => s + m.paid, 0)
    const all = [...paymentsByMonth.values()].reduce((s, v) => s + v, 0)
    adv = Math.max(adv, Math.max(0, all - applied))
  }

  return {
    billingMode,
    totalExpected: months.reduce((s, m) => s + m.expected, 0),
    totalPaid: months.reduce((s, m) => s + m.paid, 0),
    totalDebt,
    advance: adv,
    months,
    unpaidMonths,
    debtMonths: unpaidMonths.length,
  }
}

/**
 * Tashkilot qarzi — yagona kirish nuqtasi (getEntityBalance ustiga qurilgan).
 *  - monthly_fixed / talon: kanonik balans (avans eng eski qarzlarni qoplaydi);
 *  - variable: qarz tushunchasi yo'q — faqat joriy oy to'lanmagan bo'lsa belgilanadi.
 */
export function computeEntityDebt(input: EntityDebtInput): EntityDebt {
  const { billingMode } = input

  if (billingMode === 'monthly_fixed' || billingMode === 'talon') {
    const b = getEntityBalance({
      billingMode, charges: input.charges, talons: input.talons,
    })
    return { totalDebt: b.totalDebt, unpaidMonths: b.unpaidMonths, debtMonths: b.debtMonths }
  }

  // variable — har oy summasi oldindan noma'lum, qarz to'planmaydi.
  // Faqat "shu oy hali to'lamagan" holati ko'rsatiladi (summa 0).
  const cur = input.currentMonth
  const unpaid = input.paidCurrentMonth === false && cur ? [cur] : []
  return { totalDebt: 0, unpaidMonths: unpaid, debtMonths: unpaid.length }
}

/**
 * DB'dagi charge.status lug'ati: 'open' | 'partial' | 'paid'.
 * chargeMath.computeChargeStatus — UI/tasma lug'ati ('unpaid'/'none' ham bor),
 * u so'rov filtrlariga (status: {in:['open','partial']}) mos kelmaydi. Charge
 * qatoriga YOZILADIGAN holat doim shu funksiyadan olinsin.
 */
export function chargeRowStatus(
  expectedAmount: number | string,
  paidAmount: number | string,
): 'open' | 'partial' | 'paid' {
  const expected = num(expectedAmount)
  const paid = num(paidAmount)
  if (paid <= 0) return 'open'
  return paid < expected ? 'partial' : 'paid'
}

/**
 * To'lov o'chirilganda (yoki talon "to'landi" bekor qilinganda) charge'ni qaytaradi.
 * Ilgari deletePayment charge'ga umuman tegmasdi — natijada tashkilot abadiy
 * "to'langan" bo'lib qolardi. paidAmount hech qachon manfiy bo'lmaydi.
 */
export function applyPaymentReversal(
  charge: { expectedAmount: number | string; paidAmount: number | string },
  amount: number | string,
): { paidAmount: number; status: 'open' | 'partial' | 'paid' } {
  const paidAmount = Math.max(0, int(charge.paidAmount) - Math.max(0, int(amount)))
  return { paidAmount, status: chargeRowStatus(charge.expectedAmount, paidAmount) }
}

/**
 * Ledger (oylar tasmasi) qatori — bitta oy uchun kutilgan/to'langan/holat.
 * Bu yerda `paid` DOIM oy yig'indisi (chargeMath.computeChargeStatus UI holatini beradi).
 */
export interface LedgerRow {
  month: string
  expected: number | null
  paid: number
  status: ReturnType<typeof computeChargeStatus>
  paidAt: Date | null
  /** shu oyda nechta to'lov yozuvi bor (qisman to'lov ko'rsatkichi) */
  paymentCount: number
}

/**
 * Oylar tasmasini yig'adi. Kutilgan summa manbai rejimga bog'liq:
 *  - monthly_fixed: charge.expectedAmount, bo'lmasa tashkilot monthlyFee;
 *  - talon: shu oydagi talonlar summasi;
 *  - variable: kutilmaydi (null).
 */
export function buildLedger(input: {
  months: string[]
  billingMode: BillingMode
  monthlyFee?: number
  payments: PaymentLike[]
  charges?: ChargeLike[]
  talons?: (TalonLike & { volume?: number | string })[]
}): LedgerRow[] {
  const payByMonth = sumPaymentsByMonth(input.payments)
  const chargeByMonth = new Map<string, ChargeLike>((input.charges ?? []).map(c => [c.month, c]))
  const talonByMonth = groupTalonsByMonth(input.talons ?? [])

  return input.months.map((month) => {
    const pay = payByMonth.get(month)
    const paid = pay?.paid ?? 0

    let expected: number | null
    if (input.billingMode === 'monthly_fixed') {
      const charge = chargeByMonth.get(month)
      expected = charge ? num(charge.expectedAmount) : num(input.monthlyFee)
    } else if (input.billingMode === 'talon') {
      const t = talonByMonth.get(month)
      expected = t ? t.expected : null
    } else {
      expected = null
    }

    return {
      month,
      expected,
      paid,
      // talon rejimi ham kutilgan summaga ega — 'monthly_fixed' kabi baholanadi
      status: computeChargeStatus(
        expected,
        paid,
        input.billingMode === 'talon' && expected ? 'monthly_fixed' : input.billingMode,
      ),
      paidAt: pay?.lastPaidAt ?? null,
      paymentCount: pay?.count ?? 0,
    }
  })
}
