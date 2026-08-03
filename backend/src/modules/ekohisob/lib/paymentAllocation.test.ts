import { allocatePayment } from './paymentAllocation'

describe('allocatePayment', () => {
  const debts = [
    { month: '2026-01', debt: 100_000 },
    { month: '2026-02', debt: 100_000 },
    { month: '2026-03', debt: 100_000 },
  ]

  it('summa tanlangan oy qarzidan kam — faqat shu oyga', () => {
    const r = allocatePayment(40_000, '2026-03', debts)
    expect(r.allocations).toEqual([{ month: '2026-03', amount: 40_000 }])
    expect(r.advance).toBe(0)
    expect(r.appliedToOlder).toBe(0)
  })

  it('summa tanlangan oy qarziga teng — bitta taqsimot', () => {
    const r = allocatePayment(100_000, '2026-03', debts)
    expect(r.allocations).toEqual([{ month: '2026-03', amount: 100_000 }])
    expect(r.appliedToOlder).toBe(0)
  })

  it('ortiqcha summa eng ESKI qarzdan boshlab yopiladi', () => {
    const r = allocatePayment(250_000, '2026-03', debts)
    expect(r.allocations).toEqual([
      { month: '2026-03', amount: 100_000 },
      { month: '2026-01', amount: 100_000 },
      { month: '2026-02', amount: 50_000 },
    ])
    expect(r.appliedToOlder).toBe(150_000)
    expect(r.advance).toBe(0)
  })

  it('barcha qarz yopilgandan keyin ortgani avans sifatida tanlangan oyga qo\'shiladi', () => {
    const r = allocatePayment(350_000, '2026-02', debts)
    const byMonth = Object.fromEntries(r.allocations.map(a => [a.month, a.amount]))
    expect(byMonth['2026-02']).toBe(150_000)  // 100k qarz + 50k avans
    expect(byMonth['2026-01']).toBe(100_000)
    expect(byMonth['2026-03']).toBe(100_000)
    expect(r.advance).toBe(50_000)
    expect(r.appliedToOlder).toBe(200_000)
  })

  it('taqsimot yig\'indisi doim to\'lov summasiga teng', () => {
    for (const amount of [1, 99_999, 100_000, 123_456, 400_000, 1_000_000]) {
      const r = allocatePayment(amount, '2026-02', debts)
      const sum = r.allocations.reduce((s, a) => s + a.amount, 0)
      expect(sum).toBe(amount)
    }
  })

  it('qarzsiz tashkilot — hammasi tanlangan oyga (avans)', () => {
    const r = allocatePayment(200_000, '2026-05', [])
    expect(r.allocations).toEqual([{ month: '2026-05', amount: 200_000 }])
    expect(r.advance).toBe(200_000)
    expect(r.appliedToOlder).toBe(0)
  })

  it('tanlangan oy qarzlar ro\'yxatida yo\'q — avval eski qarz yopiladi', () => {
    const r = allocatePayment(150_000, '2026-05', debts)
    expect(r.allocations).toEqual([
      { month: '2026-01', amount: 100_000 },
      { month: '2026-02', amount: 50_000 },
    ])
    expect(r.appliedToOlder).toBe(150_000)
    expect(r.advance).toBe(0)
  })

  it('nol yoki manfiy summa — taqsimot yo\'q', () => {
    expect(allocatePayment(0, '2026-01', debts).allocations).toEqual([])
    expect(allocatePayment(-5000, '2026-01', debts).allocations).toEqual([])
  })

  it('manfiy/nol qarz qatorlari e\'tiborga olinmaydi', () => {
    const r = allocatePayment(50_000, '2026-03', [
      { month: '2026-01', debt: 0 },
      { month: '2026-02', debt: -10_000 },
      { month: '2026-03', debt: 20_000 },
    ])
    expect(r.allocations).toEqual([{ month: '2026-03', amount: 50_000 }])
    expect(r.advance).toBe(30_000)
  })
})
