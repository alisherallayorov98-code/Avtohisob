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
    cur.expected += amount
    if (t.paid) cur.paid += amount
    else cur.unpaid += amount
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

/**
 * Tashkilot qarzi — yagona kirish nuqtasi.
 *  - monthly_fixed: kutilgan − to'langan, hisob (charge) yozuvlari bo'yicha;
 *  - talon: to'lanmagan talonlar, sanasi bo'yicha oyga guruhlanadi;
 *  - variable: qarz tushunchasi yo'q — faqat joriy oy to'lanmagan bo'lsa belgilanadi.
 */
export function computeEntityDebt(input: EntityDebtInput): EntityDebt {
  const { billingMode } = input

  if (billingMode === 'monthly_fixed') {
    const months: string[] = []
    let total = 0
    for (const c of input.charges ?? []) {
      const debt = Math.max(0, num(c.expectedAmount) - num(c.paidAmount))
      if (debt > 0) {
        total += debt
        months.push(c.month)
      }
    }
    months.sort()
    return { totalDebt: total, unpaidMonths: months, debtMonths: months.length }
  }

  if (billingMode === 'talon') {
    const byMonth = groupTalonsByMonth(input.talons ?? [])
    const months: string[] = []
    let total = 0
    for (const [month, s] of byMonth) {
      if (s.unpaid > 0) {
        total += s.unpaid
        months.push(month)
      }
    }
    months.sort()
    return { totalDebt: total, unpaidMonths: months, debtMonths: months.length }
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
  const paidAmount = Math.max(0, num(charge.paidAmount) - num(amount))
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
