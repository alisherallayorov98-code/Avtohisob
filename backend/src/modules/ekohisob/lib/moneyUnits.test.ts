import { computeDebtLevel } from './chargeMath'
import { getEntityBalance, applySurplusFifo, talonPaidPart } from './debtMath'
import { computeTalonAmount, parseVolume, applyToTalons } from './talonPay'
import {
  formatReceiptNumber, generateVerifyToken, isValidVerifyToken, parseReceiptNumber,
} from './receiptNumber'
import { parsePaymentMethod, parseReason } from './money'
import { buildReconciliation, reconciliationVerdict } from './reconciliation'
import { computeOpenDebts } from './paymentPlan'

describe('getEntityBalance — avans qoidasi (qaror)', () => {
  it('ortiqcha to\'langan oy eng ESKI qarzni qoplaydi', () => {
    const b = getEntityBalance({
      billingMode: 'monthly_fixed',
      charges: [
        { month: '2026-01', expectedAmount: 100, paidAmount: 0 },
        { month: '2026-02', expectedAmount: 100, paidAmount: 0 },
        { month: '2026-03', expectedAmount: 100, paidAmount: 150 },
      ],
    })
    expect(b.totalDebt).toBe(150)           // 200 − 50 avans
    expect(b.months.map(m => m.debt)).toEqual([50, 100, 0])
    expect(b.unpaidMonths).toEqual(['2026-01', '2026-02'])
    expect(b.advance).toBe(0)
  })

  it('avans qarzdan katta bo\'lsa — qarz 0, qoldiq avans', () => {
    const b = getEntityBalance({
      billingMode: 'monthly_fixed',
      charges: [
        { month: '2026-01', expectedAmount: 100, paidAmount: 40 },
        { month: '2026-02', expectedAmount: 100, paidAmount: 300 },
      ],
    })
    expect(b.totalDebt).toBe(0)
    expect(b.advance).toBe(140)
  })

  it('to\'lovi bor, lekin hisobi yo\'q oy avans bo\'ladi (payments berilsa)', () => {
    const b = getEntityBalance({
      billingMode: 'monthly_fixed',
      charges: [{ month: '2026-01', expectedAmount: 100, paidAmount: 0 }],
      payments: [{ month: '2026-02', amount: 60 }],
    })
    expect(b.totalDebt).toBe(40)
    expect(b.advance).toBe(0)
  })

  it('variable: barcha to\'lov avans balansi', () => {
    const b = getEntityBalance({ billingMode: 'variable', payments: [{ month: '2026-01', amount: 70 }, { month: '2026-02', amount: 30 }] })
    expect(b.advance).toBe(100)
    expect(b.totalDebt).toBe(0)
  })

  it('applySurplusFifo yig\'indini saqlaydi', () => {
    const r = applySurplusFifo([{ month: '2026-02', shortfall: 50 }, { month: '2026-01', shortfall: 30 }], 60)
    expect(r.debts.get('2026-01')).toBe(0)
    expect(r.debts.get('2026-02')).toBe(20)
    expect(r.advance).toBe(0)
  })
})

describe('talon qisman to\'lov', () => {
  it('talonPaidPart: paid=true eski yozuv (paidAmount 0) → to\'liq', () => {
    expect(talonPaidPart({ amount: 500, paid: true, paidAmount: 0 })).toBe(500)
    expect(talonPaidPart({ amount: 500, paid: false, paidAmount: 700 })).toBe(500)
    expect(talonPaidPart({ amount: 500, paid: false, paidAmount: -5 })).toBe(0)
    expect(talonPaidPart({ amount: 500, paid: false, paidAmount: null })).toBe(0)
  })

  it('FIFO sana bo\'yicha, qisman yopish', () => {
    const talons = [
      { id: 'b', date: '2026-03-10', amount: 300, paidAmount: 0, paid: false },
      { id: 'a', date: '2026-03-02', amount: 200, paidAmount: 50, paid: false },
    ]
    const r = applyToTalons(talons, 250)
    expect(r.updates).toEqual([
      { id: 'a', delta: 150, paidAmount: 200, paid: true },
      { id: 'b', delta: 100, paidAmount: 100, paid: false },
    ])
    expect(r.closed).toBe(1)
    expect(r.leftover).toBe(0)
  })

  it('computeTalonAmount: float xatosiz butun so\'m', () => {
    expect(computeTalonAmount(2.5, 155000)).toBe(387500)
    expect(computeTalonAmount(0.1, 3)).toBe(0)           // 0.3 → 0 (round) — chaqiruvchi 0 ni rad etadi
    expect(computeTalonAmount(1.005, 1000)).toBe(1005)
    expect(computeTalonAmount(0.333, 100000)).toBe(33300)
    expect(Number.isInteger(computeTalonAmount(7.777, 12345))).toBe(true)
  })

  it('parseVolume qat\'iy', () => {
    expect(parseVolume('2.5')).toBe(2.5)
    expect(parseVolume(3)).toBe(3)
    for (const bad of ['2.5abc', '1e3', '-1', '0', '1.2345', '', 'x', null, undefined, NaN]) {
      expect(parseVolume(bad as any)).toBeNull()
    }
  })
})

describe('computeOpenDebts', () => {
  it('fixed: tanlangan oyda hisob yo\'q → oylik to\'lov qarz', () => {
    const d = computeOpenDebts({ billingMode: 'monthly_fixed', monthlyFee: 100, selectedMonth: '2026-05', charges: [] })
    expect(d).toEqual([{ month: '2026-05', debt: 100 }])
  })
  it('talon: qisman to\'langan talon qoldig\'i', () => {
    const d = computeOpenDebts({
      billingMode: 'talon', monthlyFee: 0, selectedMonth: '2026-05',
      talons: [{ id: 'a', date: '2026-05-03', amount: 300, paidAmount: 120, paid: false }],
    })
    expect(d).toEqual([{ month: '2026-05', debt: 180 }])
  })
})

describe('chargeMath.computeDebtLevel — dueDay', () => {
  it('default (dueDay=1) avvalgi xatti-harakat', () => {
    expect(computeDebtLevel(0)).toBe('current')
    expect(computeDebtLevel(1)).toBe('warning')
    expect(computeDebtLevel(2)).toBe('overdue')
    expect(computeDebtLevel(5)).toBe('critical')
  })
  it('joriy oy muddatidan oldin sanalmaydi', () => {
    const ctx = { unpaidMonths: ['2026-10', '2026-11'], currentMonth: '2026-11', todayDay: 5 }
    expect(computeDebtLevel(2, 10, ctx)).toBe('warning')          // 5-kun < 10 → joriy oy sanalmaydi
    expect(computeDebtLevel(2, 10, { ...ctx, todayDay: 10 })).toBe('overdue')
    expect(computeDebtLevel(1, 10, { ...ctx, unpaidMonths: ['2026-11'] })).toBe('current')
    expect(computeDebtLevel(2, 1, ctx)).toBe('overdue')            // dueDay=1 → o'zgarmaydi
    expect(computeDebtLevel(2, 10)).toBe('overdue')                // ctx yo'q → o'zgarmaydi
  })
})

describe('receiptNumber / token / money', () => {
  it('raqam format/parse', () => {
    expect(formatReceiptNumber(2026, 7)).toBe('EKO-2026-00007')
    expect(parseReceiptNumber('eko-2026-00007')).toEqual({ year: 2026, num: 7 })
    expect(parseReceiptNumber('EKO-26-1')).toBeNull()
    expect(parseReceiptNumber('xyz')).toBeNull()
  })
  it('verifyToken: 16+ belgi, tasodifiy, yaroqli', () => {
    const set = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const t = generateVerifyToken()
      expect(t.length).toBeGreaterThanOrEqual(16)
      expect(isValidVerifyToken(t)).toBe(true)
      expect(parseReceiptNumber(t)).toBeNull()
      set.add(t)
    }
    expect(set.size).toBe(500)
    expect(isValidVerifyToken('short')).toBe(false)
    expect(isValidVerifyToken('a'.repeat(30) + '!')).toBe(false)
  })
  it('method va sabab', () => {
    expect(parsePaymentMethod(undefined)).toBe('cash')
    expect(parsePaymentMethod('card')).toBe('card')
    expect(parsePaymentMethod('bitcoin')).toBeNull()
    expect(parseReason('  ab  ')).toBeNull()
    expect(parseReason('  xato kiritilgan  ')).toBe('xato kiritilgan')
    expect(parseReason(undefined)).toBeNull()
  })
})

describe('reconciliation — xulosa va UZT kuni', () => {
  it('verdict saldo bilan mos', () => {
    expect(reconciliationVerdict(150)).toEqual({ kind: 'debt', amount: 150 })
    expect(reconciliationVerdict(-40)).toEqual({ kind: 'advance', amount: 40 })
    expect(reconciliationVerdict(0)).toEqual({ kind: 'settled', amount: 0 })
  })
  it('to\'lov kuni O\'zbekiston vaqti bo\'yicha (UTC 20:00 = ertasi 01:00 UZT)', () => {
    const r = buildReconciliation({
      billingMode: 'monthly_fixed',
      charges: [{ month: '2026-06', expectedAmount: 100 }],
      payments: [{ paidAt: '2026-06-30T20:00:00.000Z', amount: 100, month: '2026-06' }],
    })
    expect(r.rows.find(x => x.kind === 'payment')!.date).toBe('2026-07-01')
    expect(r.closingDebt).toBe(0)
  })
})
