import { accuracyOf, applyAccuracy } from './accuracy'
import { computePriority } from './engine'

describe('qoida aniqligi (admin hukmlaridan)', () => {
  test('3 tadan kam hukmda foiz chiqarilmaydi', () => {
    expect(accuracyOf(1, 1, 5).pct).toBeNull()
    expect(accuracyOf(7, 3, 0).pct).toBe(70)
  })
  test("ko'pincha noto'g'ri bo'lsa — past aniqlik", () => {
    expect(accuracyOf(1, 4, 0).low).toBe(true)
    expect(accuracyOf(5, 3, 0).low).toBe(false)
    expect(accuracyOf(0, 2, 0).low).toBe(false) // hali kam
  })
  test('past aniqlikdagi savol "Taxmin"ga tushadi va asosi aytiladi', () => {
    const stats = new Map([['repairs.clutch_repeat', accuracyOf(1, 4, 0)], ['fuel.over_tank', accuracyOf(5, 0, 1)]])
    const [a, b, c] = applyAccuracy([
      { ruleKey: 'repairs.clutch_repeat', confidence: 'strong' as const, basis: 'x' },
      { ruleKey: 'fuel.over_tank', confidence: 'fact' as const, basis: 'y' },
      { ruleKey: 'gps.no_signal', confidence: 'fact' as const, basis: 'z' },
    ], stats)
    expect(a).toMatchObject({ confidence: 'guess', lowAccuracy: true })
    expect(a.basis).toMatch(/1 to'g'ri, 4 noto'g'ri/)
    expect(b).toMatchObject({ confidence: 'fact', ruleAccuracy: { pct: 100 } })
    expect(b.lowAccuracy).toBeUndefined()
    expect(c.ruleAccuracy).toBeUndefined()
  })
  test('past aniqlik ustuvorlikni pasaytiradi', () => {
    const base = { severity: 'warning' as const, impactUzs: 1_000_000, vehicleId: 'v1', confidence: 'guess' as const }
    expect(computePriority({ ...base, lowAccuracy: true })).toBeLessThan(computePriority(base))
  })
})
