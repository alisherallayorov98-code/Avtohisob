import {
  achievementPercent, computeScore, finalScore, computeBonus, monthBoundsUzt, dayKeyUzt,
  validateIndicatorInput, AUTO_METRICS, IndicatorInput,
} from './kpiMath'

describe('achievementPercent', () => {
  it('higher: oddiy nisbat', () => {
    expect(achievementPercent(50, 100, 'higher')).toBe(50)
    expect(achievementPercent(100, 100, 'higher')).toBe(100)
  })
  it('higher: cap dan oshmaydi', () => {
    expect(achievementPercent(500, 100, 'higher')).toBe(120)
    expect(achievementPercent(500, 100, 'higher', 150)).toBe(150)
  })
  it('higher: maqsad 0 bo\'lsa mazmunsiz — qiymat bor/yo\'q', () => {
    expect(achievementPercent(5, 0, 'higher')).toBe(100)
    expect(achievementPercent(0, 0, 'higher')).toBe(0)
  })
  it('lower: maqsad ichida 100, oshsa kamayadi, 2×maqsadda 0', () => {
    expect(achievementPercent(3, 5, 'lower')).toBe(100)
    expect(achievementPercent(5, 5, 'lower')).toBe(100)
    expect(achievementPercent(7.5, 5, 'lower')).toBe(50)
    expect(achievementPercent(10, 5, 'lower')).toBe(0)
    expect(achievementPercent(50, 5, 'lower')).toBe(0)
  })
  it('lower: maqsad 0 — bitta oshish ham 0 ga tushiradi', () => {
    expect(achievementPercent(0, 0, 'lower')).toBe(100)
    expect(achievementPercent(1, 0, 'lower')).toBe(0)
  })
  it('manfiy va NaN qiymat 0 deb olinadi', () => {
    expect(achievementPercent(-5, 100, 'higher')).toBe(0)
    expect(achievementPercent(NaN, 100, 'higher')).toBe(0)
  })
})

const ind = (over: Partial<IndicatorInput>): IndicatorInput => ({
  id: 'x', name: 'x', weight: 50, target: 100, direction: 'higher', value: 100, ...over,
})

describe('computeScore', () => {
  it('vaznli o\'rtacha', () => {
    const r = computeScore([
      ind({ id: 'a', weight: 60, value: 100 }),   // 100%
      ind({ id: 'b', weight: 40, value: 50 }),    // 50%
    ])
    expect(r.baseScore).toBe(80) // 0.6*100 + 0.4*50
    expect(r.usedWeight).toBe(100)
  })

  it('vaznlar 100 ga teng bo\'lmasa ham normallashadi', () => {
    const r = computeScore([
      ind({ id: 'a', weight: 20, value: 100 }),
      ind({ id: 'b', weight: 20, value: 0 }),
    ])
    expect(r.baseScore).toBe(50)
  })

  it('qiymati kiritilmagan ko\'rsatkich hisobdan chiqadi va belgilanadi', () => {
    const r = computeScore([
      ind({ id: 'a', weight: 50, value: 100 }),
      ind({ id: 'm', weight: 50, value: null }),
    ])
    expect(r.baseScore).toBe(100)
    expect(r.missingCount).toBe(1)
    expect(r.items.find(i => i.id === 'm')!.excluded).toBe(true)
  })

  it('vazni 0 ko\'rsatkich ballga ta\'sir qilmaydi', () => {
    const r = computeScore([
      ind({ id: 'a', weight: 100, value: 100 }),
      ind({ id: 'z', weight: 0, value: 0 }),
    ])
    expect(r.baseScore).toBe(100)
    expect(r.missingCount).toBe(0)
  })

  it('hammasi bo\'sh — ball 0', () => {
    expect(computeScore([]).baseScore).toBe(0)
    expect(computeScore([ind({ value: null })]).baseScore).toBe(0)
  })

  it('ortiqcha bajarish cap bilan cheklanadi, boshqasini yopmaydi', () => {
    const r = computeScore([
      ind({ id: 'a', weight: 50, value: 1000 }), // 120% (cap)
      ind({ id: 'b', weight: 50, value: 0 }),    // 0%
    ])
    expect(r.baseScore).toBe(60)
  })

  it('hissa ballari yig\'indisi umumiy ballga teng', () => {
    const r = computeScore([
      ind({ id: 'a', weight: 30, value: 80 }),
      ind({ id: 'b', weight: 70, value: 60 }),
    ])
    const sum = r.items.reduce((s, i) => s + (i.points ?? 0), 0)
    expect(Math.abs(sum - r.baseScore)).toBeLessThan(0.2)
  })
})

describe('finalScore', () => {
  it('tuzatish qo\'shiladi', () => expect(finalScore(80, 5)).toBe(85))
  it('0 dan pastga tushmaydi', () => expect(finalScore(10, -50)).toBe(0))
  it('cap dan oshmaydi', () => expect(finalScore(110, 30)).toBe(120))
})

describe('computeBonus', () => {
  it('ball × bonusMax', () => {
    expect(computeBonus({ score: 80, bonusMax: 1_000_000, minScore: 50 })).toBe(800_000)
  })
  it('100% = to\'liq bonus, 120% = 1.2×', () => {
    expect(computeBonus({ score: 100, bonusMax: 500_000, minScore: 50 })).toBe(500_000)
    expect(computeBonus({ score: 120, bonusMax: 500_000, minScore: 50 })).toBe(600_000)
  })
  it('minScore dan past ball — bonus yo\'q', () => {
    expect(computeBonus({ score: 49.9, bonusMax: 1_000_000, minScore: 50 })).toBe(0)
    expect(computeBonus({ score: 50, bonusMax: 1_000_000, minScore: 50 })).toBe(500_000)
  })
  it('admin tuzatishi qo\'shiladi, lekin bonus manfiy bo\'lmaydi', () => {
    expect(computeBonus({ score: 80, bonusMax: 1_000_000, minScore: 50, bonusDelta: 100_000 })).toBe(900_000)
    expect(computeBonus({ score: 80, bonusMax: 1_000_000, minScore: 50, bonusDelta: -5_000_000 })).toBe(0)
    expect(computeBonus({ score: 10, bonusMax: 1_000_000, minScore: 50, bonusDelta: 200_000 })).toBe(200_000)
  })
  it('bonusMax manfiy yoki 0 bo\'lsa 0', () => {
    expect(computeBonus({ score: 100, bonusMax: 0, minScore: 0 })).toBe(0)
    expect(computeBonus({ score: 100, bonusMax: -5, minScore: 0 })).toBe(0)
  })
})

describe('monthBoundsUzt / dayKeyUzt', () => {
  it('oy UZT (UTC+5) bo\'yicha boshlanadi', () => {
    const { start, end } = monthBoundsUzt('2026-03')
    expect(start.toISOString()).toBe('2026-02-28T19:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-31T19:00:00.000Z')
  })
  it('dekabr → yanvar yil almashinuvi', () => {
    expect(monthBoundsUzt('2026-12').end.toISOString()).toBe('2026-12-31T19:00:00.000Z')
  })
  it('UTC 20:00 — UZT da ertasi kun', () => {
    expect(dayKeyUzt(new Date('2026-03-10T20:00:00Z'))).toBe('2026-03-11')
    expect(dayKeyUzt(new Date('2026-03-10T18:59:00Z'))).toBe('2026-03-10')
  })
})

describe('validateIndicatorInput', () => {
  const ok = { name: 'A', weight: 10, target: 5, direction: 'higher' }
  it('to\'g\'ri', () => expect(validateIndicatorInput(ok)).toBeNull())
  it('nomsiz', () => expect(validateIndicatorInput({ ...ok, name: ' ' })).not.toBeNull())
  it('vazn 100 dan katta', () => expect(validateIndicatorInput({ ...ok, weight: 101 })).not.toBeNull())
  it('higher + maqsad 0', () => expect(validateIndicatorInput({ ...ok, target: 0 })).not.toBeNull())
  it('lower + maqsad 0 ruxsat', () => expect(validateIndicatorInput({ ...ok, direction: 'lower', target: 0 })).toBeNull())
  it('noma\'lum yo\'nalish', () => expect(validateIndicatorInput({ ...ok, direction: 'x' })).not.toBeNull())
})

describe('AUTO_METRICS katalogi', () => {
  it('kalitlar noyob', () => {
    const keys = AUTO_METRICS.map(m => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('standart vaznlar yig\'indisi 100', () => {
    expect(AUTO_METRICS.reduce((s, m) => s + m.defaultWeight, 0)).toBe(100)
  })
})
