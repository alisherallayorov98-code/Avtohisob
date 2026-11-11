import { cutoffDay, includeCurrentMonth, evaluationMonths, MIN_CUTOFF_DAY } from './monitoringMath'
import { mulberry32, randInt } from './testRng'

describe('monitoringMath — tugamagan joriy oy', () => {
  it('cutoffDay: kamida 15, kopi bilan 28', () => {
    expect(cutoffDay(1)).toBe(MIN_CUTOFF_DAY)
    expect(cutoffDay(undefined)).toBe(MIN_CUTOFF_DAY)
    expect(cutoffDay(20)).toBe(20)
    expect(cutoffDay(99)).toBe(28)
  })

  it('oy boshida joriy oy kirmaydi, davr oldingi oy bilan tugaydi', () => {
    const now = new Date('2026-11-03T10:00:00Z')
    expect(includeCurrentMonth(now, 1)).toBe(false)
    expect(evaluationMonths(3, now, 1)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('kesim kunidan keyin joriy oy kiradi', () => {
    const now = new Date('2026-11-20T10:00:00Z')
    expect(evaluationMonths(3, now, 1)).toEqual(['2026-09', '2026-10', '2026-11'])
  })

  it('UZT kuni ishlatiladi: 15-kun 23:00 UTC = 16-kun 04:00 UZT', () => {
    expect(includeCurrentMonth(new Date('2026-11-15T23:00:00Z'), 1)).toBe(true)
    expect(includeCurrentMonth(new Date('2026-11-15T18:00:00Z'), 1)).toBe(false)
  })

  it('yil chegarasi', () => {
    expect(evaluationMonths(3, new Date('2027-01-05T00:00:00Z'), 1)).toEqual(['2026-10', '2026-11', '2026-12'])
  })

  it('300 tasodifiy: uzunlik == count, osish tartibi, takror yoq', () => {
    const rnd = mulberry32(11)
    for (let i = 0; i < 300; i++) {
      const now = new Date(Date.UTC(2025, 0, 1) + Math.floor(rnd() * 800 * 86400000))
      const n = randInt(rnd, 1, 24)
      const m = evaluationMonths(n, now, randInt(rnd, 1, 31))
      expect(m).toHaveLength(n)
      expect([...m].sort()).toEqual(m)
      expect(new Set(m).size).toBe(n)
    }
  })
})
