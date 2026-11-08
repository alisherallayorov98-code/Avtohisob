import { evaluateReview, typicalGapDays, priceDiffPct, daysBetween, ReviewInput, ReviewItemInput } from './maintenanceReview'

const item = (over: Partial<ReviewItemInput> = {}): ReviewItemInput => ({
  itemId: 'i1', name: 'Kolodka', quantity: 1, unitCost: 240000, refPrice: 240000, stock: 5,
  lastOnVehicle: null, pastDates: [], alsoPending: false, ...over,
})
const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  installationDate: '2026-11-08T00:00:00Z', vehicleKm: 130000, evidenceCount: 2, items: [item()], workerRepeatCount: 0, workerName: 'Ali', ...over,
})

describe('maintenanceReview', () => {
  it('toza ariza — ok', () => {
    const r = evaluateReview(base())
    expect(r.risk).toBe('ok')
    expect(r.flags).toHaveLength(0)
  })

  it('1 oy oldin shu qism — qizil (takror)', () => {
    const r = evaluateReview(base({ items: [item({ lastOnVehicle: { date: '2026-10-09T00:00:00Z', vehicleKm: 128000, worker: 'Vali', unitCost: 240000, quantity: 1 } })] }))
    expect(r.risk).toBe('suspicious')
    expect(r.flags[0].code).toBe('repeat_recent')
    expect(r.flags[0].text).toContain('30 kun oldin')
    expect(r.flags[0].text).toContain('2 000 km oldin')
  })

  it('60 kun oldin — sariq; 200 kun oldin — faqat ma\'lumot', () => {
    expect(evaluateReview(base({ items: [item({ lastOnVehicle: { date: '2026-09-09T00:00:00Z', vehicleKm: null, worker: null, unitCost: 1, quantity: 1 } })] })).risk).toBe('check')
    const old = evaluateReview(base({ items: [item({ lastOnVehicle: { date: '2026-04-01T00:00:00Z', vehicleKm: null, worker: null, unitCost: 1, quantity: 1 } })] }))
    expect(old.risk).toBe('ok')
    expect(old.flags[0].level).toBe('info')
  })

  it('odatdagi oraliqdan ancha erta — sariq', () => {
    // odatda ~300 kunda almashadi, bu safar 100 kunda
    const r = evaluateReview(base({ items: [item({
      lastOnVehicle: { date: '2026-07-31T00:00:00Z', vehicleKm: null, worker: null, unitCost: 1, quantity: 1 },
      pastDates: ['2025-01-01T00:00:00Z', '2025-11-01T00:00:00Z', '2026-07-31T00:00:00Z'],
    })] }))
    expect(r.flags.some(f => f.text.includes('odatda'))).toBe(true)
    expect(r.risk).toBe('check')
  })

  it('narx kirimdan +40% sariq, +80% qizil, kirim narxi yo\'q — belgi yo\'q', () => {
    expect(evaluateReview(base({ items: [item({ unitCost: 336000 })] })).risk).toBe('check')
    expect(evaluateReview(base({ items: [item({ unitCost: 432000 })] })).risk).toBe('suspicious')
    expect(evaluateReview(base({ items: [item({ unitCost: 999999, refPrice: null })] })).risk).toBe('ok')
    expect(evaluateReview(base({ items: [item({ unitCost: 100000 })] })).risk).toBe('ok') // arzon — muammo emas
  })

  it('ombor yetmaydi / dalil yo\'q / boshqa kutayotgan ariza — qizil', () => {
    expect(evaluateReview(base({ items: [item({ stock: 0 })] })).flags[0].code).toBe('stock_low')
    expect(evaluateReview(base({ evidenceCount: 0 })).flags[0].code).toBe('no_evidence')
    expect(evaluateReview(base({ items: [item({ alsoPending: true })] })).flags[0].code).toBe('duplicate_pending')
  })

  it('usta takrori — sariq', () => {
    expect(evaluateReview(base({ workerRepeatCount: 2 })).risk).toBe('check')
    expect(evaluateReview(base({ workerRepeatCount: 5, workerName: null })).risk).toBe('ok')
  })

  it('flaglar og\'irlik bo\'yicha tartiblanadi', () => {
    const r = evaluateReview(base({ evidenceCount: 0, workerRepeatCount: 3 }))
    expect(r.flags.map(f => f.level)).toEqual(['critical', 'warning'])
  })

  it('yordamchilar', () => {
    expect(typicalGapDays(['2026-01-01'])).toBeNull()
    expect(typicalGapDays(['2026-01-01', '2026-01-31', '2026-03-02'])).toBe(30)
    expect(priceDiffPct(150, 100)).toBe(50)
    expect(priceDiffPct(5, 0)).toBeNull()
    expect(daysBetween('2026-11-08', '2026-11-01')).toBe(7)
  })
})
