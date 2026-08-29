import { computeAverageCost, computeCountDiff } from './inventoryAdjust'

describe('computeAverageCost', () => {
  it('bitta qatlam — o\'sha narx qaytadi', () => {
    expect(computeAverageCost([{ unitCost: 1000, remainingQty: 10 }])).toBe(1000)
  })

  it('ikkita qatlam — og\'irlikli o\'rtacha', () => {
    // (10*1000 + 5*1200) / 15 = 16000/15 = 1066.666... -> 1066.67
    expect(computeAverageCost([
      { unitCost: 1000, remainingQty: 10 },
      { unitCost: 1200, remainingQty: 5 },
    ])).toBe(1066.67)
  })

  it('qatlam yo\'q bo\'lsa 0', () => {
    expect(computeAverageCost([])).toBe(0)
  })

  it('barcha qatlam remainingQty=0 bo\'lsa 0', () => {
    expect(computeAverageCost([{ unitCost: 500, remainingQty: 0 }])).toBe(0)
  })
})

describe('computeCountDiff', () => {
  it('kamomad (counted < system) — manfiy diff', () => {
    const result = computeCountDiff(50, 45, [{ unitCost: 1000, remainingQty: 50 }])
    expect(result.diffQty).toBe(-5)
    expect(result.unitCost).toBe(1000)
    expect(result.diffValue).toBe(-5000)
  })

  it('ortiqcha (counted > system) — musbat diff', () => {
    const result = computeCountDiff(50, 55, [{ unitCost: 1000, remainingQty: 50 }])
    expect(result.diffQty).toBe(5)
    expect(result.diffValue).toBe(5000)
  })

  it('mos kelsa diff 0', () => {
    const result = computeCountDiff(50, 50, [{ unitCost: 1000, remainingQty: 50 }])
    expect(result.diffQty).toBe(0)
    expect(result.diffValue).toBe(0)
  })
})
