import { savdoDateRange } from './dateRange'

describe('savdoDateRange (UTC+5)', () => {
  it('bir kunlik oraliq butun kunni qamrab oladi', () => {
    const r = savdoDateRange('2026-11-12', '2026-11-12')!
    expect(r.gte!.toISOString()).toBe('2026-11-11T19:00:00.000Z')
    expect(r.lte!.toISOString()).toBe('2026-11-12T18:59:59.999Z')
  })
  it('kechki sotuv (UTC+5 23:30) oxirgi kunga kiradi', () => {
    const r = savdoDateRange(undefined, '2026-11-12')!
    expect(new Date('2026-11-12T18:30:00Z').getTime()).toBeLessThanOrEqual(r.lte!.getTime())
  })
  it('vaqt bilan berilsa o\'zgarishsiz', () => {
    expect(savdoDateRange('2026-11-12T10:00:00Z')!.gte!.toISOString()).toBe('2026-11-12T10:00:00.000Z')
  })
  it('bo\'sh yoki noto\'g\'ri — undefined', () => {
    expect(savdoDateRange()).toBeUndefined()
    expect(savdoDateRange('xx', 'yy')).toBeUndefined()
  })
})
