import { computeCompleteness } from './entityCompleteness'

describe('computeCompleteness', () => {
  it("botdan kelgan chala tashkilot: faqat nom, tuman va joylashuv bor", () => {
    const r = computeCompleteness({
      name: 'Ilhom MChJ', districtId: 'd1', lat: 41.3, lon: 69.2,
      billingMode: 'variable', monthlyFee: 0,
    })
    expect(r.isReady).toBe(false)
    expect(r.missingRequired.map(f => f.key)).toEqual(['address', 'monthlyFee'])
    expect(r.missingOptional.map(f => f.key)).toContain('phone')
    expect(r.missingOptional.map(f => f.key)).not.toContain('location')
  })

  it("to'liq tashkilot: 100% va tayyor", () => {
    const r = computeCompleteness({
      name: 'A', address: 'x', districtId: 'd', mahallId: 'm', stir: '1', phone: '9',
      contactName: 'B', contractNumber: '5', lat: 1, lon: 2, billingMode: 'monthly_fixed', monthlyFee: 100,
    })
    expect(r.percent).toBe(100)
    expect(r.isReady).toBe(true)
    expect(r.missingRequired).toHaveLength(0)
    expect(r.missingOptional).toHaveLength(0)
  })

  it("talon rejimida oylik emas, kub narxi majburiy", () => {
    const r = computeCompleteness({
      name: 'A', address: 'x', districtId: 'd', billingMode: 'talon', monthlyFee: 500, cubicPrice: 0,
    })
    expect(r.missingRequired.map(f => f.key)).toEqual(['cubicPrice'])
  })

  it("bo'sh joy (probel) to'ldirilgan hisoblanmaydi", () => {
    const r = computeCompleteness({ name: '   ', address: ' ', districtId: 'd', monthlyFee: 1 })
    expect(r.missingRequired.map(f => f.key)).toEqual(['name', 'address'])
  })

  it('lat=0 yoki lon=0 ham joylashuv hisoblanadi (null emas)', () => {
    const r = computeCompleteness({ name: 'A', lat: 0, lon: 0 })
    expect(r.missingOptional.map(f => f.key)).not.toContain('location')
  })
})
