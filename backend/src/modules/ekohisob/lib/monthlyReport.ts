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
  // ── Majburiyat modeli (reportAggregate): hamma raqam BIR XIL tashkilotlar to'plamidan ──
  /** majburiyat bo'yicha yopilgan summa (tashkilot bo'yicha min(to'langan, kutilgan)) */
  applied?: number
  /** majburiyatdan qolgan (kutilgan − yopilgan) */
  remaining?: number
  /** shu oyda KASSAGA tushgan (paidAt, UZT oy chegarasi) */
  collectedCash?: number
  obliged?: number
  settled?: number
}

export interface MonthlyRow {
  month: string
  /** kutilgan = hisob + talon */
  expected: number
  expectedCharge: number
  expectedTalon: number
  /** "Shu oyga tegishli" — payment.month = shu oy (FIFO eski qarzga yozilganlar o'sha eski oyda) */
  collected: number
  /** "Kassaga tushdi" — paidAt shu UZT oyida (qaysi oyga tegishli bo'lishidan qat'i nazar) */
  collectedCash: number
  /** majburiyat bo'yicha yopilgan: yopilgan + qoldiq == kutilgan */
  applied: number
  /** avans/ortiqcha: collected − applied (>0 bo'lsa), foizni 100 da kesmasdan alohida */
  advance: number
  /** shu oydan qolgan qarz */
  debt: number
  /** yopilgan / kutilgan, % (surat va maxraj bir to'plamdan; 100 dan oshishi mumkin emas, avans alohida). null — kutilgan yo'q. */
  collectRate: number | null
  /** to'liq yopgan tashkilotlar / majburiyati borlar, % */
  settleRate: number | null
  obliged: number
  settled: number
  payments: number
  payers: number
}

export interface MonthlyReport {
  rows: MonthlyRow[]
  totals: {
    expected: number
    collected: number
    collectedCash: number
    applied: number
    advance: number
    /**
     * JAMI QARZ — KANONIK: Σ tashkilot qarzi (har tashkilot ichida netto: ortiqcha to'langan oy
     * eng eski qarzni qoplaydi), butun tarix bo'yicha, hisobot KPI'si va kartochka bilan BIR XIL.
     * `canonicalDebt` berilmasa — eski xatti-harakat (oylar yig'indisi).
     */
    debt: number
    /**
     * Davr oylari bo'yicha "ochiq qoldiq" yig'indisi (har oy alohida: kutilgan − yopilgan, NETTOSIZ).
     * `debt` dan KATTA bo'lishi mumkin (boshqa oydagi ortiqcha to'lov qoplagan qismi) yoki KICHIK
     * (davrdan oldingi qarzlar). Oyma-oy qatorlar shu ochiq qoldiqni ko'rsatadi.
     */
    periodOpenDebt: number
    payments: number
    collectRate: number | null
  }
}

export interface MonthlyReportOptions {
  /** Σ tashkilot kanonik qarzi (reportQueries.queryDebtGroups → summarizeDebt) */
  canonicalDebt?: number
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
  opts: MonthlyReportOptions = {},
): MonthlyReport {
  const rows: MonthlyRow[] = months.map((month) => {
    const a = agg.get(month) ?? {}
    const expectedCharge = num(a.chargeExpected)
    const expectedTalon = num(a.talonExpected)
    const expected = expectedCharge + expectedTalon
    const collected = num(a.collected)
    const hasModel = a.applied !== undefined
    // Majburiyat modeli berilgan bo'lsa: yopilgan + qoldiq == kutilgan (aniq).
    const applied = hasModel ? Math.min(num(a.applied), expected) : Math.min(collected, expected)
    const debt = hasModel
      ? (a.remaining !== undefined ? num(a.remaining) : Math.max(0, expected - applied))
      : Math.max(0, expectedCharge - num(a.chargePaid)) + num(a.talonUnpaid)
    const rate = (x: number, y: number) => (y > 0 ? Math.round((x * 100) / y) : null)

    return {
      month,
      expected,
      expectedCharge,
      expectedTalon,
      collected,
      collectedCash: num(a.collectedCash),
      applied,
      advance: Math.max(0, collected - applied),
      debt,
      collectRate: hasModel ? rate(applied, expected) : rate(collected, expected),
      settleRate: rate(num(a.settled), num(a.obliged)),
      obliged: num(a.obliged),
      settled: num(a.settled),
      payments: num(a.payments),
      payers: num(a.payers),
    }
  })

  const sum = (f: (r: MonthlyRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  const expected = sum(r => r.expected)
  const collected = sum(r => r.collected)
  const applied = sum(r => r.applied)
  const modelled = months.some(m => agg.get(m)?.applied !== undefined)

  return {
    rows,
    totals: {
      expected,
      collected,
      collectedCash: sum(r => r.collectedCash),
      applied,
      advance: sum(r => r.advance),
      debt: opts.canonicalDebt !== undefined ? Math.max(0, Math.round(num(opts.canonicalDebt))) : sum(r => r.debt),
      periodOpenDebt: sum(r => r.debt),
      payments: sum(r => r.payments),
      collectRate: expected > 0 ? Math.round(((modelled ? applied : collected) * 100) / expected) : null,
    },
  }
}

/** Sana (talon `@db.Date`) → "YYYY-MM", UTC bo'yicha. */
export function monthOf(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
