// EkoHisob — oyma-oy hisobot mantiqi (DB'siz, testlanadi).
//
// Nega kerak: hisobot sahifasi ilgari faqat DAVRNING OXIRGI oyi bo'yicha
// ko'rsatkich berardi (yig'im foizi, qarz, tuman kesimi), oylar bo'yicha esa
// faqat "qancha yig'ildi" grafigi bor edi. "Yanvarda qancha kutilgan edi,
// qanchasi yig'ildi, qanchasi qarz qoldi" degan savolga javob yo'q edi —
// buxgalteriya va rahbar yig'ilishi aynan shu jadvalni so'raydi.
//
// Ko'rsatkichlar TARIXAN to'g'ri: kutilgan summa o'sha oyning hisob (charge)
// va talon yozuvlaridan olinadi, tashkilotning BUGUNGI oylik to'lovidan emas.

export interface MonthAgg {
  /** shu oy uchun hisoblangan summa (charge.expectedAmount yig'indisi) */
  chargeExpected?: number
  /** shu oy hisoblari bo'yicha to'langan (charge.paidAmount yig'indisi) */
  chargePaid?: number
  /** shu oyda bajarilgan talon ishlari summasi */
  talonExpected?: number
  /** shu oydagi to'lanmagan talonlar summasi */
  talonUnpaid?: number
  /** shu oy uchun kassaga tushgan summa (payment.amount yig'indisi) */
  collected?: number
  /** to'lov yozuvlari soni */
  payments?: number
  /** shu oy uchun to'lov qilgan tashkilotlar soni */
  payers?: number
}

export interface MonthlyRow {
  month: string
  /** kutilgan = hisob + talon */
  expected: number
  expectedCharge: number
  expectedTalon: number
  collected: number
  /** shu oydan qolgan qarz (bugungi holatga ko'ra) */
  debt: number
  /** yig'ilgan / kutilgan, %. null — shu oyda kutilgan summa yo'q. */
  collectRate: number | null
  payments: number
  payers: number
}

export interface MonthlyReport {
  rows: MonthlyRow[]
  totals: {
    expected: number
    collected: number
    debt: number
    payments: number
    collectRate: number | null
  }
}

const num = (v: number | string | null | undefined): number => Number(v) || 0

/**
 * Oylar ro'yxati + agregatlardan hisobot jadvalini yig'adi.
 *
 * `collectRate` 100% dan OSHISHI mumkin va bu xato emas: to'lov taqsimoti
 * (FIFO) eski qarzni yopganda pul o'sha eski oyga yoziladi, natijada o'sha oy
 * "kutilganidan ko'p yig'ilgan" bo'lib chiqadi. Shuning uchun kesib
 * tashlanmaydi — aks holda undirilgan eski qarz hisobotdan yo'qoladi.
 */
export function buildMonthlyReport(
  months: string[],
  agg: Map<string, MonthAgg>,
): MonthlyReport {
  const rows: MonthlyRow[] = months.map((month) => {
    const a = agg.get(month) ?? {}
    const expectedCharge = num(a.chargeExpected)
    const expectedTalon = num(a.talonExpected)
    const expected = expectedCharge + expectedTalon
    const collected = num(a.collected)
    const debt = Math.max(0, expectedCharge - num(a.chargePaid)) + num(a.talonUnpaid)

    return {
      month,
      expected,
      expectedCharge,
      expectedTalon,
      collected,
      debt,
      collectRate: expected > 0 ? Math.round((collected * 100) / expected) : null,
      payments: num(a.payments),
      payers: num(a.payers),
    }
  })

  const expected = rows.reduce((s, r) => s + r.expected, 0)
  const collected = rows.reduce((s, r) => s + r.collected, 0)

  return {
    rows,
    totals: {
      expected,
      collected,
      debt: rows.reduce((s, r) => s + r.debt, 0),
      payments: rows.reduce((s, r) => s + r.payments, 0),
      collectRate: expected > 0 ? Math.round((collected * 100) / expected) : null,
    },
  }
}

/** Sana (talon `@db.Date`) → "YYYY-MM", UTC bo'yicha. */
export function monthOf(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
