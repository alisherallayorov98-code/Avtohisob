import { monthKey, lastMonthKeys, buildMonthlySeries, computeConsumption, docStatus } from './vehicleOverviewMath'

describe('vehicleOverviewMath', () => {
  it('monthKey UTC+5 chegarasini hisobga oladi', () => {
    expect(monthKey(new Date('2026-10-31T20:00:00Z'))).toBe('2026-11')
    expect(monthKey(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10')
  })
  it('lastMonthKeys yil chegarasidan otadi', () => {
    expect(lastMonthKeys(new Date('2026-02-10T00:00:00Z'), 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
  it('buildMonthlySeries oylarga yigadi, oraliqdan tashqarini tashlaydi', () => {
    const s = buildMonthlySeries(new Date('2026-11-08T00:00:00Z'), 3, {
      maintenance: [{ date: '2026-11-02T00:00:00Z', amount: 100 }, { date: '2025-01-01T00:00:00Z', amount: 999 }],
      fuel: [{ date: '2026-10-05T00:00:00Z', amount: 50 }, { date: '2026-11-03T00:00:00Z', amount: 25 }],
      expenses: [],
    })
    expect(s.map(p => p.month)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(s[2]).toMatchObject({ maintenance: 100, fuel: 25, total: 125 })
    expect(s[1].total).toBe(50)
    expect(s[0].total).toBe(0)
  })
  it('computeConsumption fill-to-fill va meyor bilan solishtiradi', () => {
    const c = computeConsumption([
      { liters: 50, odometer: 1000, date: '2026-01-01' },
      { liters: 30, odometer: 1200, date: '2026-01-05' },
      { liters: 30, odometer: 1400, date: '2026-01-10' },
    ], 10)!
    expect(c.l100).toBe(15)
    expect(c.overPct).toBe(50)
    expect(c.level).toBe('critical')
  })
  it('computeConsumption malumot yetarli bolmasa null', () => {
    expect(computeConsumption([{ liters: 10, odometer: 100, date: 'x' }], 10)).toBeNull()
    expect(computeConsumption([{ liters: 10, odometer: 100, date: 'x' }, { liters: 10, odometer: 150, date: 'y' }], 10)).toBeNull()
    expect(computeConsumption([{ liters: 10, odometer: 0, date: 'x' }, { liters: 10, odometer: 500, date: 'y' }], 10)).toBeNull()
  })
  it('computeConsumption meyor yoq bolsa level null', () => {
    const c = computeConsumption([{ liters: 10, odometer: 1000, date: 'x' }, { liters: 20, odometer: 1300, date: 'y' }], null)!
    expect(c.level).toBeNull()
    expect(c.normPer100).toBeNull()
  })
  it('docStatus', () => {
    const now = new Date('2026-11-08T00:00:00Z')
    expect(docStatus(null, now)).toBeNull()
    expect(docStatus('2026-11-01T00:00:00Z', now)!.level).toBe('expired')
    expect(docStatus('2026-11-20T00:00:00Z', now)!.level).toBe('soon')
    expect(docStatus('2027-06-01T00:00:00Z', now)!.level).toBe('ok')
  })
})
