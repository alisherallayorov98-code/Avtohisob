import { buildReconciliation, amountInWords } from './reconciliation'

const charges = [
  { month: '2026-05', expectedAmount: 450000 },
  { month: '2026-06', expectedAmount: 450000 },
  { month: '2026-07', expectedAmount: 450000 },
]
const payments = [
  { paidAt: '2026-05-14', amount: 450000, month: '2026-05', receiptNumber: 'EKO-2026-00001' },
  { paidAt: '2026-06-20', amount: 200000, month: '2026-06', receiptNumber: 'EKO-2026-00042' },
]

describe('buildReconciliation — asosiy hisob', () => {
  it('yugurib boruvchi saldo har qatordan keyin to\'g\'ri', () => {
    const r = buildReconciliation({ billingMode: 'monthly_fixed', charges, payments })
    expect(r.rows.map(x => [x.date, x.debit, x.credit, x.balance])).toEqual([
      ['2026-05-01', 450000, 0, 450000],
      ['2026-05-14', 0, 450000, 0],
      ['2026-06-01', 450000, 0, 450000],
      ['2026-06-20', 0, 200000, 250000],
      ['2026-07-01', 450000, 0, 700000],
    ])
  })

  it('yakuniy saldo = boshlang\'ich + hisoblandi − to\'landi', () => {
    const r = buildReconciliation({ billingMode: 'monthly_fixed', charges, payments })
    expect(r.totals).toEqual({ debit: 1350000, credit: 650000 })
    expect(r.closingBalance).toBe(700000)
    expect(r.openingBalance).toBe(0)
  })

  it('davr berilmasa boshlang\'ich qoldiq 0 va barcha hujjatlar kiradi', () => {
    const r = buildReconciliation({ billingMode: 'monthly_fixed', charges, payments })
    expect(r.openingBalance).toBe(0)
    expect(r.rows).toHaveLength(5)
    expect(r.periodFrom).toBe('2026-05-01')
    expect(r.periodTo).toBe('2026-07-01')
  })
})

describe('buildReconciliation — davr chegaralari', () => {
  it('davr boshidan oldingi hujjatlar boshlang\'ich qoldiqqa yig\'iladi', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed', charges, payments,
      from: '2026-06-01', to: '2026-07-31',
    })
    // May: +450 000 hisoblandi, −450 000 to'landi → 0
    expect(r.openingBalance).toBe(0)
    expect(r.rows).toHaveLength(3)
    expect(r.closingBalance).toBe(700000)
  })

  it('to\'lanmagan oy boshlang\'ich qoldiqda qoladi', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed', charges, payments,
      from: '2026-07-01',
    })
    // May to'liq yopildi (0), iyun 250 000 qoldi
    expect(r.openingBalance).toBe(250000)
    expect(r.rows).toHaveLength(1)
    expect(r.closingBalance).toBe(700000)
  })

  it('davr oxiridan keyingi hujjatlar kirmaydi', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed', charges, payments, to: '2026-06-30',
    })
    expect(r.rows).toHaveLength(4)
    expect(r.closingBalance).toBe(250000)
  })

  it('bo\'sh davr — qatorlar yo\'q, saldo o\'zgarmaydi', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed', charges, payments,
      from: '2026-09-01', to: '2026-09-30',
    })
    expect(r.rows).toHaveLength(0)
    expect(r.openingBalance).toBe(700000)
    expect(r.closingBalance).toBe(700000)
    expect(r.totals).toEqual({ debit: 0, credit: 0 })
  })
})

describe('buildReconciliation — tartib qoidasi', () => {
  it('bir kunda hisob to\'lovdan OLDIN turadi (saldo mantiqsiz sakramasin)', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed',
      charges: [{ month: '2026-07', expectedAmount: 300000 }],
      payments: [{ paidAt: '2026-07-01', amount: 300000, month: '2026-07' }],
    })
    expect(r.rows.map(x => x.kind)).toEqual(['charge', 'payment'])
    expect(r.rows.map(x => x.balance)).toEqual([300000, 0])
  })

  it('talon hisobdan keyin, to\'lovdan oldin', () => {
    const r = buildReconciliation({
      billingMode: 'talon',
      charges: [{ month: '2026-07', expectedAmount: 100000 }],
      talons: [{ date: '2026-07-01', amount: 200000, volume: 5 }],
      payments: [{ paidAt: '2026-07-01', amount: 50000 }],
    })
    expect(r.rows.map(x => x.kind)).toEqual(['charge', 'talon', 'payment'])
  })
})

describe('buildReconciliation — talon rejimi', () => {
  it('talon summasi hisoblangan tomonga tushadi, hajm izohda ko\'rinadi', () => {
    const r = buildReconciliation({
      billingMode: 'talon',
      talons: [
        { date: '2026-06-05', amount: 175000, volume: 5 },
        { date: '2026-07-03', amount: 280000, volume: 8, note: 'qurilish chiqindisi' },
      ],
      payments: [{ paidAt: '2026-06-10', amount: 175000, receiptNumber: 'EKO-2026-00100' }],
    })
    expect(r.totals).toEqual({ debit: 455000, credit: 175000 })
    expect(r.closingBalance).toBe(280000)
    expect(r.rows[0].description).toContain('5 m³')
    expect(r.rows[2].description).toContain('qurilish chiqindisi')
  })
})

describe('buildReconciliation — chekka holatlar', () => {
  it('ortiqcha to\'lov manfiy saldo (avans) beradi va nolga qirqilmaydi', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed',
      charges: [{ month: '2026-07', expectedAmount: 100000 }],
      payments: [{ paidAt: '2026-07-05', amount: 300000 }],
    })
    expect(r.closingBalance).toBe(-200000)
  })

  it("o'zgaruvchan rejim — payments_only, faqat to'lovlar", () => {
    const r = buildReconciliation({
      billingMode: 'variable',
      payments: [{ paidAt: '2026-07-05', amount: 80000 }],
    })
    expect(r.mode).toBe('payments_only')
    expect(r.rows).toHaveLength(1)
    expect(r.totals.debit).toBe(0)
  })

  it('nol summali va yaroqsiz sanali hujjatlar tashlanadi', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed',
      charges: [{ month: '2026-07', expectedAmount: 0 }, { month: 'buzuq', expectedAmount: 500 }],
      talons: [{ date: 'buzuq', amount: 1000 }],
      payments: [{ paidAt: '', amount: 100 }, { paidAt: '2026-07-05', amount: 0 }],
    })
    expect(r.rows).toHaveLength(0)
  })

  it('hech qanday hujjat yo\'q — bo\'sh natija', () => {
    const r = buildReconciliation({ billingMode: 'monthly_fixed' })
    expect(r).toMatchObject({
      openingBalance: 0, closingBalance: 0, rows: [],
      totals: { debit: 0, credit: 0 }, periodFrom: null, periodTo: null,
    })
  })

  it('Prisma Decimal (satr) qiymatlar to\'g\'ri qo\'shiladi', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed',
      charges: [{ month: '2026-07', expectedAmount: '450000' as any }],
      payments: [{ paidAt: '2026-07-10', amount: '200000' as any }],
    })
    expect(r.closingBalance).toBe(250000)
  })
})

describe('amountInWords — rasmiy hujjat uchun', () => {
  it('asosiy sonlar', () => {
    expect(amountInWords(0)).toBe('nol')
    expect(amountInWords(7)).toBe('yetti')
    expect(amountInWords(15)).toBe("o'n besh")
    expect(amountInWords(450000)).toBe("to'rt yuz ellik ming")
  })

  it('million va milliard', () => {
    expect(amountInWords(1_200_000)).toBe('bir million ikki yuz ming')
    expect(amountInWords(2_000_000_000)).toBe('ikki milliard')
  })

  it('manfiy summa (avans)', () => {
    expect(amountInWords(-50000)).toBe('minus ellik ming')
  })
})
