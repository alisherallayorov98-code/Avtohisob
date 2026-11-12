import { computeLandedCost } from './landedCost'
import { applyVat, normalizeVatRate } from './vatMath'
import { recommendPrice, overheadPercent, marginPercent } from './costingCalc'
import { numberizeQty, parseQty, round3 } from './qty'

describe('computeLandedCost', () => {
  it('kursni qo\'llaydi, xarajat yo\'q', () => {
    const r = computeLandedCost([{ quantity: 10, price: 2 }], 12000, 0)
    expect(r[0].unitCost).toBe(24000)
  })
  it('xarajatni qiymat bo\'yicha taqsimlaydi va yig\'indi aniq', () => {
    const r = computeLandedCost([{ quantity: 10, price: 1 }, { quantity: 10, price: 3 }], 10000, 400000)
    expect(r[0].extraCost + r[1].extraCost).toBe(400000)
    expect(r[0].extraCost).toBe(100000)
    expect(r[0].unitCost).toBe(10000 + 10000)
  })
  it('miqdor bo\'yicha taqsimlaydi', () => {
    const r = computeLandedCost([{ quantity: 10, price: 1 }, { quantity: 30, price: 1 }], 1, 400, 'quantity')
    expect(r[0].extraCost).toBe(100)
    expect(r[1].extraCost).toBe(300)
  })
  it('kasr miqdor', () => {
    const r = computeLandedCost([{ quantity: 2.5, price: 4 }], 1, 5)
    expect(r[0].unitCost).toBe(6)
  })
  it('noto\'g\'ri kurs xato', () => {
    expect(() => computeLandedCost([{ quantity: 1, price: 1 }], 0, 0)).toThrow()
  })
})

describe('vat', () => {
  it('QQSsiz', () => expect(applyVat(1000, null)).toEqual({ vatAmount: 0, total: 1000 }))
  it('12%', () => expect(applyVat(1000, 12)).toEqual({ vatAmount: 120, total: 1120 }))
  it('normalize', () => {
    expect(normalizeVatRate('')).toBeNull()
    expect(normalizeVatRate(0)).toBeNull()
    expect(normalizeVatRate('12')).toBe(12)
    expect(() => normalizeVatRate(150)).toThrow()
  })
})

describe('costing', () => {
  it('tavsiya narx', () => expect(recommendPrice(100, 10, 20)).toBe(132))
  it('xarajat ulushi', () => expect(overheadPercent(50, 1000)).toBe(5))
  it('marja', () => expect(marginPercent(200, 150)).toBe(25))
})

describe('qty', () => {
  it('parse', () => { expect(parseQty('2.5')).toBe(2.5); expect(parseQty(0)).toBeNull(); expect(parseQty('x')).toBeNull() })
  it('round3', () => expect(round3(0.1 + 0.2)).toBe(0.3))
  it('numberizeQty', () => {
    expect(numberizeQty({ quantity: '5.000', unitCost: '10.00', lines: [{ remainingQty: '1.500' }] }))
      .toEqual({ quantity: 5, unitCost: '10.00', lines: [{ remainingQty: 1.5 }] })
  })
})
