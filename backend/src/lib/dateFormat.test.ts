import { formatUzDate, formatUzDateTime } from './dateFormat'

describe('dateFormat', () => {
  it('UTC+5 ga o\'tkazadi', () => {
    expect(formatUzDateTime(new Date('2026-11-10T09:30:00Z'))).toBe('10.11.2026 14:30')
  })
  it('kun chegarasi: UTC 20:00 = ertasi kun 01:00', () => {
    expect(formatUzDate('2026-11-09T20:00:00Z')).toBe('10.11.2026')
    expect(formatUzDateTime('2026-12-31T19:05:00Z')).toBe('01.01.2027 00:05')
  })
  it('string va number qabul qiladi', () => {
    expect(formatUzDate('2026-11-10')).toBe('10.11.2026')
    expect(formatUzDate(Date.UTC(2026, 0, 5, 6, 0))).toBe('05.01.2026')
  })
  it('noto\'g\'ri qiymat', () => {
    expect(formatUzDate('abc')).toBe('—')
    expect(formatUzDate(null)).toBe('—')
    expect(formatUzDateTime(undefined)).toBe('—')
    expect(formatUzDate('')).toBe('—')
  })
})
