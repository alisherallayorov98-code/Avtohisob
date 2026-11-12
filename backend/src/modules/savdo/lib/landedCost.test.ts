import { computeLandedCost, computeLandedCostGrouped } from './landedCost'
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

describe('har bir birlikka xarajat', () => {
  it('so\'m/birlik har qator miqdoriga ko\'paytiriladi', () => {
    const r = computeLandedCost([{ quantity: 10, price: 1 }, { quantity: 30, price: 5 }], 1, 0, 'value', 100)
    expect(r[0].extraCost).toBe(1000)
    expect(r[1].extraCost).toBe(3000)
    expect(r[0].unitCost).toBe(101)
    expect(r[1].unitCost).toBe(105)
  })
  it('umumiy + birlik birga', () => {
    const r = computeLandedCost([{ quantity: 10, price: 1 }, { quantity: 10, price: 1 }], 1, 200, 'value', 10)
    expect(r[0].extraCost).toBe(100 + 100)
    expect(r[0].extraCost + r[1].extraCost).toBe(200 + 200)
  })
  it('manfiy birlik xarajati xato', () => {
    expect(() => computeLandedCost([{ quantity: 1, price: 1 }], 1, 0, 'value', -1)).toThrow()
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

describe('guruhli xarajat (bojxona / qo\'shimcha)', () => {
  const lines = [{ quantity: 10, price: 100, fixedExtra: 500 }, { quantity: 30, price: 100 }]
  it('guruhlar alohida taqsimlanadi, yig\'indisi aniq', () => {
    const r = computeLandedCostGrouped(lines, 1, { customs: { total: 400, perUnit: 0 }, other: { total: 800, perUnit: 0 } })
    expect(r[0].extraCustoms + r[1].extraCustoms).toBe(400)
    expect(r[0].extraOther + r[1].extraOther).toBe(800)
    expect(r[0].extraCustoms).toBe(100)   // 25% qiymat
    expect(r[0].extraOther).toBe(200)
  })
  it('yig\'im faqat o\'z qatoriga, jami xarajat = bojxona + qo\'shimcha + yig\'im', () => {
    const r = computeLandedCostGrouped(lines, 1, { customs: { total: 400, perUnit: 0 }, other: { total: 0, perUnit: 10 } })
    expect(r[0].levy).toBe(500)
    expect(r[1].levy).toBe(0)
    expect(r[0].extraCost).toBe(r[0].extraCustoms + r[0].extraOther + 500)
    expect(r[0].extraOther).toBe(100)     // 10 so'm × 10 dona
    const totalExtra = r[0].extraCost + r[1].extraCost
    expect(totalExtra).toBe(400 + 400 + 500) // bojxona 400 + birlikka 10×40 + yig'im 500
  })
  it('guruhsiz natija eski hisob bilan mos', () => {
    const g = computeLandedCostGrouped(lines, 1, { customs: { total: 0, perUnit: 0 }, other: { total: 600, perUnit: 0 } })
    const old = computeLandedCost(lines.map(l => ({ quantity: l.quantity, price: l.price, fixedExtra: l.fixedExtra })), 1, 600)
    expect(g.map(x => x.unitCost)).toEqual(old.map(x => x.unitCost))
  })
})
