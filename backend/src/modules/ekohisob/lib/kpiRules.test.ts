import {
  computeBonus, computeScore, finalScore, achievementPercent, monthBoundsUzt, dayKeyUzt,
  decideClose, checkBonusAdjustment, bonusAdjustmentLimit, validateAdjustmentReason,
  ADJUST_MAX_PERCENT, MIN_ADJUST_REASON, KpiDirection,
} from './kpiMath'
import { monthBoundsUz, dayOfUz } from './uzt'
import {
  countCreditedEntities, countPaymentEvents, sumValidPayments, activeDayKeys, stirKey,
} from './kpiAuto'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const ri = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

describe('bonus "jarlik" (biznes qarori — o\'zgartirilmagan, qotirilgan)', () => {
  const base = { bonusMax: 1_000_000, minScore: 50 }
  it('49.99 → 0, 50.00 → bonusMax × 50% (jarlik)', () => {
    expect(computeBonus({ ...base, score: 49.99 })).toBe(0)
    expect(computeBonus({ ...base, score: 49.9 })).toBe(0)
    expect(computeBonus({ ...base, score: 50 })).toBe(500_000)
    expect(computeBonus({ ...base, score: 50.01 })).toBe(500_100)
  })
  it('minScore=0 — har qanday ball bonus beradi', () => {
    expect(computeBonus({ bonusMax: 1000, minScore: 0, score: 0 })).toBe(0)
    expect(computeBonus({ bonusMax: 1000, minScore: 0, score: 10 })).toBe(100)
  })
  it('ball 1 xonaga yaxlitlanadi: 49.96 ko\'rsatkich 50.0 ga aylanib bonus oladi', () => {
    // 1 ta ko'rsatkich: qiymat/maqsad = 49.96% → achievement round1 = 50.0
    const sc = computeScore([{ id: 'i', name: 'x', weight: 100, target: 10000, direction: 'higher', value: 4996 }])
    expect(sc.baseScore).toBe(50)
    expect(computeBonus({ ...base, score: sc.baseScore })).toBe(500_000)
  })
  it('bonus butun so\'m (kasr yo\'q)', () => {
    expect(Number.isInteger(computeBonus({ bonusMax: 333_333, minScore: 0, score: 33.3 }))).toBe(true)
  })
})

describe('UZT chegaralari lib/uzt.ts bilan bir xil', () => {
  it('oy chegaralari barcha oylarda mos', () => {
    for (let y = 2024; y <= 2030; y++) {
      for (let m = 1; m <= 12; m++) {
        const month = `${y}-${String(m).padStart(2, '0')}`
        const a = monthBoundsUzt(month), b = monthBoundsUz(month)!
        expect(a.start.getTime()).toBe(b.start.getTime())
        expect(a.end.getTime()).toBe(b.end.getTime())
      }
    }
  })
  it('kun kaliti: UZT yarim tun = 19:00 UTC', () => {
    expect(dayKeyUzt(new Date('2026-11-09T18:59:59.999Z'))).toBe('2026-11-09')
    expect(dayKeyUzt(new Date('2026-11-09T19:00:00.000Z'))).toBe('2026-11-10')
    expect(dayKeyUzt('2026-12-31T19:00:00Z')).toBe('2027-01-01')
  })
  it('250 tasodifiy vaqt: dayKeyUzt === dayOfUz', () => {
    const r = mulberry32(42)
    for (let i = 0; i < 250; i++) {
      const t = new Date(Date.UTC(2025, 0, 1) + ri(r, 0, 3 * 365 * 24 * 3600) * 1000)
      expect(dayKeyUzt(t)).toBe(dayOfUz(t))
    }
  })
})

describe('oyni yopish qoidasi', () => {
  const ok = { month: '2026-10', currentMonth: '2026-11', alreadyClosed: false, missingTotal: 0, force: false }
  it("o'tgan oy, kiritilmagan yo'q — yopiladi", () => expect(decideClose(ok)).toEqual({ ok: true, forced: false }))
  it('joriy oy yopilmaydi', () => {
    expect(decideClose({ ...ok, month: '2026-11' })).toMatchObject({ ok: false, status: 400, code: 'NOT_PAST' })
  })
  it('kelajak oy yopilmaydi', () => {
    expect(decideClose({ ...ok, month: '2027-01' })).toMatchObject({ ok: false, code: 'NOT_PAST' })
  })
  it('yil almashinuvi: 2026-12 joriy bo\'lganda 2026-11 yopiladi, 2026-12 yo\'q', () => {
    expect(decideClose({ ...ok, month: '2026-11', currentMonth: '2026-12' }).ok).toBe(true)
    expect(decideClose({ ...ok, month: '2026-12', currentMonth: '2026-12' }).ok).toBe(false)
    expect(decideClose({ ...ok, month: '2026-12', currentMonth: '2027-01' }).ok).toBe(true)
  })
  it('yopilgan oy — 409', () => {
    expect(decideClose({ ...ok, alreadyClosed: true })).toMatchObject({ ok: false, status: 409, code: 'ALREADY_CLOSED' })
  })
  it('kiritilmagan qiymat bor — force talab qilinadi (409 + ro\'yxat)', () => {
    expect(decideClose({ ...ok, missingTotal: 2 })).toMatchObject({ ok: false, status: 409, code: 'MISSING_VALUES' })
    expect(decideClose({ ...ok, missingTotal: 2, force: true })).toEqual({ ok: true, forced: true })
  })
  it("noto'g'ri oy — 400", () => {
    expect(decideClose({ ...ok, month: '2026-13' })).toMatchObject({ ok: false, status: 400, code: 'INVALID_MONTH' })
  })
})

describe('bonus tuzatish chegarasi', () => {
  it('chegara = bonusMax × 50%', () => {
    expect(ADJUST_MAX_PERCENT).toBe(50)
    expect(bonusAdjustmentLimit(1_000_000)).toBe(500_000)
    expect(bonusAdjustmentLimit(0)).toBe(0)
    expect(bonusAdjustmentLimit(-5)).toBe(0)
  })
  it('chegara ichida ruxsat, oshsa rad', () => {
    expect(checkBonusAdjustment({ bonusMax: 1_000_000, existingNetDelta: 0, newDelta: 500_000 }).ok).toBe(true)
    expect(checkBonusAdjustment({ bonusMax: 1_000_000, existingNetDelta: 0, newDelta: -500_000 }).ok).toBe(true)
    expect(checkBonusAdjustment({ bonusMax: 1_000_000, existingNetDelta: 0, newDelta: 500_001 }).ok).toBe(false)
  })
  it('oylik JAMI (sof) hisobga olinadi', () => {
    expect(checkBonusAdjustment({ bonusMax: 1_000_000, existingNetDelta: 300_000, newDelta: 200_000 }).ok).toBe(true)
    expect(checkBonusAdjustment({ bonusMax: 1_000_000, existingNetDelta: 300_000, newDelta: 200_001 }).ok).toBe(false)
    // qarama-qarshi tuzatish sof jamini kamaytiradi
    expect(checkBonusAdjustment({ bonusMax: 1_000_000, existingNetDelta: 500_000, newDelta: -100_000 }).ok).toBe(true)
  })
  it('bonusMax = 0 bo\'lsa har qanday so\'m tuzatish rad', () => {
    expect(checkBonusAdjustment({ bonusMax: 0, existingNetDelta: 0, newDelta: 1 }).ok).toBe(false)
  })
  it('0 tuzatish har doim ok', () => {
    expect(checkBonusAdjustment({ bonusMax: 0, existingNetDelta: 0, newDelta: 0 }).ok).toBe(true)
  })
  it('sabab kamida 10 belgi', () => {
    expect(MIN_ADJUST_REASON).toBe(10)
    expect(validateAdjustmentReason('qisqa')).not.toBeNull()
    expect(validateAdjustmentReason('         x     ')).not.toBeNull()
    expect(validateAdjustmentReason('Alohida rag\'bat — katta shartnoma')).toBeNull()
    expect(validateAdjustmentReason(undefined)).not.toBeNull()
  })
})

describe('invariantlar (seeded PRNG, 250 stsenariy)', () => {
  it('ball [0, cap]; hissalar yig\'indisi ≈ ball; bonus [0, bonusMax×cap/100 + tuzatish]', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 977)
      const cap = ri(r, 100, 200)
      const n = ri(r, 0, 8)
      const inds = Array.from({ length: n }, (_, i) => ({
        id: `i${i}`, name: `n${i}`, weight: ri(r, 0, 60), target: ri(r, 0, 50), unit: '',
        direction: (r() < 0.3 ? 'lower' : 'higher') as KpiDirection,
        value: r() < 0.2 ? null : ri(r, 0, 200) * (r() < 0.05 ? -1 : 1),
      }))
      const sc = computeScore(inds, cap)
      expect(sc.baseScore).toBeGreaterThanOrEqual(0)
      expect(sc.baseScore).toBeLessThanOrEqual(cap)
      for (const it of sc.items) {
        if (it.achievement !== null) { expect(it.achievement).toBeGreaterThanOrEqual(0); expect(it.achievement).toBeLessThanOrEqual(cap) }
      }
      const pts = sc.items.reduce((s, i) => s + (i.points ?? 0), 0)
      expect(Math.abs(pts - sc.baseScore)).toBeLessThanOrEqual(0.05 * Math.max(1, sc.items.length))

      const adj = ri(r, -150, 150)
      const fin = finalScore(sc.baseScore, adj, cap)
      expect(fin).toBeGreaterThanOrEqual(0)
      expect(fin).toBeLessThanOrEqual(cap)

      const bonusMax = ri(r, 0, 5_000_000)
      const minScore = ri(r, 0, 100)
      const b = computeBonus({ score: fin, bonusMax, minScore })
      expect(b).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(b)).toBe(true)
      expect(b).toBeLessThanOrEqual(Math.ceil((bonusMax * cap) / 100))
      if (cap === 100) expect(b).toBeLessThanOrEqual(bonusMax)
      // bonusDelta bilan ham manfiy emas
      expect(computeBonus({ score: fin, bonusMax, minScore, bonusDelta: ri(r, -3_000_000, 3_000_000) })).toBeGreaterThanOrEqual(0)
    }
  })

  it('achievementPercent har doim [0, cap]', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 13)
      const cap = ri(r, 100, 200)
      const a = achievementPercent(ri(r, -50, 500), ri(r, -5, 100), r() < 0.5 ? 'higher' : 'lower', cap)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(cap)
    }
  })

  it('bonus tuzatish: qabul qilingan tuzatishlar yig\'indisi hech qachon chegaradan oshmaydi', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 271)
      const bonusMax = ri(r, 0, 4_000_000)
      const limit = bonusAdjustmentLimit(bonusMax)
      let net = 0
      for (let step = 0; step < 20; step++) {
        const d = ri(r, -2_500_000, 2_500_000)
        const c = checkBonusAdjustment({ bonusMax, existingNetDelta: net, newDelta: d })
        if (c.ok) net += d
        expect(Math.abs(net)).toBeLessThanOrEqual(limit)
      }
    }
  })
})

describe('avto-ko\'rsatkichlar: manipulyatsiyaga chidamli hisob', () => {
  const day1 = '2026-11-02T06:00:00Z'
  describe('new_entities', () => {
    const e = (id: string, stir: string | null, status = 'active', createdAt = day1) => ({ id, stir, status, createdAt })
    it('qoralama va nofaol sanalmaydi', () => {
      const c = [e('a', null), e('b', null, 'draft'), e('c', null, 'inactive')]
      expect(countCreditedEntities(c, c)).toBe(1)
    })
    it('takroriy STIR (ilgari kiritilgan) sanalmaydi', () => {
      const orig = e('o', '123456789', 'active', '2026-10-01T00:00:00Z')
      const dup = e('d', '123456789')
      expect(countCreditedEntities([dup], [orig, dup])).toBe(0)
    })
    it('bir xil STIR bilan ikkita yangi — faqat birinchisi sanaladi', () => {
      const a = e('a', '123456789', 'active', '2026-11-02T05:00:00Z')
      const b = e('b', '123456789', 'active', '2026-11-02T06:00:00Z')
      expect(countCreditedEntities([a, b], [a, b])).toBe(1)
    })
    it('STIR formatlari (probel/tire) bir xil deb olinadi', () => {
      expect(stirKey('123 456 789')).toBe('123456789')
      expect(stirKey('12')).toBeNull()
      expect(stirKey(null)).toBeNull()
    })
    it('STIR yo\'q tashkilotlar alohida-alohida sanaladi', () => {
      const c = [e('a', null), e('b', ''), e('c', null)]
      expect(countCreditedEntities(c, c)).toBe(3)
    })
    it('qora ro\'yxatga o\'tgan real tashkilot sanaladi', () => {
      const c = [e('a', null, 'blacklisted')]
      expect(countCreditedEntities(c, c)).toBe(1)
    })
  })

  describe('payments_count', () => {
    const p = (entityId: string, paidAt: string, amount = 1000, groupId: string | null = null) => ({ entityId, paidAt, amount, groupId })
    it("bir tashkilotga bir kunda bir nechta to'lov — 1 ta", () => {
      expect(countPaymentEvents([p('a', '2026-11-02T05:00:00Z'), p('a', '2026-11-02T08:00:00Z'), p('a', '2026-11-02T09:00:00Z')])).toBe(1)
    })
    it('boshqa tashkilot yoki boshqa kun — alohida', () => {
      expect(countPaymentEvents([p('a', '2026-11-02T05:00:00Z'), p('b', '2026-11-02T05:00:00Z'), p('a', '2026-11-03T05:00:00Z')])).toBe(3)
    })
    it('UZT kun chegarasi: 18:59 va 19:00 UTC — turli kun', () => {
      expect(countPaymentEvents([p('a', '2026-11-02T18:59:00Z'), p('a', '2026-11-02T19:00:00Z')])).toBe(2)
    })
    it("bir kassa operatsiyasi bir necha oyga bo'lingan — 1 ta", () => {
      expect(countPaymentEvents([
        p('a', '2026-11-02T05:00:00Z', 500, 'g1'), p('a', '2026-11-02T05:00:00Z', 500, 'g1'), p('a', '2026-11-02T05:00:00Z', 500, 'g1'),
      ])).toBe(1)
    })
    it("nol va manfiy summa sanalmaydi", () => {
      expect(countPaymentEvents([p('a', day1, 0), p('b', day1, -5)])).toBe(0)
      expect(sumValidPayments([p('a', day1, 1000), p('b', day1, -5), p('c', day1, 0)])).toBe(1000)
    })
  })

  describe('active_days', () => {
    it('UZT kunlar, takrorsiz', () => {
      const s = activeDayKeys(['2026-11-02T18:00:00Z', '2026-11-02T19:30:00Z'], ['2026-11-03T01:00:00Z'])
      expect([...s].sort()).toEqual(['2026-11-02', '2026-11-03'])
    })
  })

  it('invariant: payments_count ≤ to\'lovlar soni; new_entities ≤ nomzodlar (250 stsenariy)', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 53)
      const pays = Array.from({ length: ri(r, 0, 40) }, () => ({
        entityId: `e${ri(r, 1, 6)}`, paidAt: new Date(Date.UTC(2026, 10, ri(r, 1, 28), ri(r, 0, 23))),
        amount: ri(r, -100, 1000), groupId: r() < 0.3 ? `g${ri(r, 1, 4)}` : null,
      }))
      const n = countPaymentEvents(pays)
      expect(n).toBeLessThanOrEqual(pays.filter(x => x.amount > 0).length)
      expect(n).toBeGreaterThanOrEqual(0)

      const ents = Array.from({ length: ri(r, 0, 20) }, (_, i) => ({
        id: `x${i}`, stir: r() < 0.5 ? String(100000000 + ri(r, 0, 5)) : null,
        status: ['active', 'draft', 'inactive', 'blacklisted'][ri(r, 0, 3)], createdAt: new Date(Date.UTC(2026, 10, ri(r, 1, 28))),
      }))
      const credited = countCreditedEntities(ents, ents)
      expect(credited).toBeLessThanOrEqual(ents.length)
      // bir xil STIR bilan hisobga olingan ko'pi bilan 1 ta
      const distinctStir = new Set(ents.filter(e => stirKey(e.stir)).map(e => stirKey(e.stir))).size
      const noStir = ents.filter(e => !stirKey(e.stir) && ['active', 'blacklisted'].includes(e.status)).length
      expect(credited).toBeLessThanOrEqual(distinctStir + noStir)
    }
  })
})
