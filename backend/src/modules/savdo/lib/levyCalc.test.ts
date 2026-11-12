import { computeLevy, levyRate } from './levyCalc'
import { computeLandedCost } from './landedCost'

describe('computeLevy', () => {
  it('kg bo\'yicha: miqdor × og\'irlik × (eng kam oylik × foiz)', () => {
    // 100 dona, har biri 10 kg, eng kam oylik 1 000 000, 2% => 20 000 so'm/kg
    const r = computeLevy({ basis: 'per_kg', minWage: 1_000_000, percent: 2, quantity: 100, unitWeightKg: 10 })
    expect(r.basisQty).toBe(1000)
    expect(r.rate).toBe(20000)
    expect(r.amount).toBe(20_000_000)
  })
  it('dona bo\'yicha og\'irlik kerak emas', () => {
    const r = computeLevy({ basis: 'per_unit', minWage: 1_000_000, percent: 5, quantity: 12 })
    expect(r.amount).toBe(600_000)
  })
  it('kasr foiz va kasr og\'irlik', () => {
    const r = computeLevy({ basis: 'per_kg', minWage: 1_271_000, percent: 0.5, quantity: 3, unitWeightKg: 2.25 })
    expect(r.basisQty).toBe(6.75)
    expect(r.amount).toBe(42896.25)
  })
  it('kg uchun og\'irliksiz xato', () => {
    expect(() => computeLevy({ basis: 'per_kg', minWage: 1000, percent: 1, quantity: 1 })).toThrow()
  })
  it('eng kam oylik kiritilmasa xato', () => {
    expect(() => computeLevy({ basis: 'per_unit', minWage: 0, percent: 1, quantity: 1 })).toThrow()
  })
  it('levyRate', () => expect(levyRate(2_000_000, 1.5)).toBe(30000))
})

describe('yig\'im tannarxga qo\'shiladi (qatorga xos)', () => {
  it('fixedExtra faqat o\'sha qatorga tushadi', () => {
    const r = computeLandedCost(
      [{ quantity: 10, price: 100, fixedExtra: 5000 }, { quantity: 10, price: 100 }], 1, 0, 'value', 0,
    )
    expect(r[0].extraCost).toBe(5000)
    expect(r[0].unitCost).toBe(600)
    expect(r[1].extraCost).toBe(0)
    expect(r[1].unitCost).toBe(100)
  })
  it('umumiy xarajat va yig\'im birga', () => {
    const r = computeLandedCost(
      [{ quantity: 10, price: 100, fixedExtra: 1000 }, { quantity: 10, price: 100 }], 1, 200, 'value',
    )
    expect(r[0].extraCost).toBe(1100)
    expect(r[1].extraCost).toBe(100)
  })
})
