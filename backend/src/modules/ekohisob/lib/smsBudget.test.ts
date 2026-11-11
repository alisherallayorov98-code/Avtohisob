import {
  dedupKey, escalationPeriodKey, remainingBudget, canSpend, decideReservation, ReservationInput,
  classifyHttpFailure, shouldAbortBatch, consumesAttempt, shouldRunAuto, sortCandidates,
  selectWithinBudget, isInSendWindow, decideEscalationRow, isSilentFirstSync,
  computeSmsEffectiveness, MAX_SMS_ATTEMPTS,
} from './smsBudget'

// Seeded PRNG (mulberry32) — tasodifiy stsenariylar takrorlanadigan bo'lishi uchun
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

describe("dedup kaliti", () => {
  it("(tashkilot, tur, davr) bo'yicha noyob", () => {
    expect(dedupKey('e1', 'auto', '2026-11')).toBe('e1|auto|2026-11')
    expect(dedupKey('e1', 'auto', '2026-11')).not.toBe(dedupKey('e1', 'escalation', '2026-11'))
    expect(dedupKey('e1', 'auto', '2026-11')).not.toBe(dedupKey('e1', 'auto', '2026-12'))
    expect(dedupKey('e1', 'auto', '2026-11')).not.toBe(dedupKey('e2', 'auto', '2026-11'))
  })
  it("eskalatsiya davri darajani o'z ichiga oladi", () => {
    expect(escalationPeriodKey('2026-11', 'critical')).not.toBe(escalationPeriodKey('2026-11', 'overdue'))
  })
})

describe("byudjet (segmentlar yig'indisi)", () => {
  const b = { monthlyLimit: 100, usedMonthSegments: 90, dailyMax: 50, usedTodaySegments: 10 }
  it("qoldiq = oylik va kunlik qoldiqning kichigi", () => {
    expect(remainingBudget(b)).toMatchObject({ monthly: 10, daily: 40, remaining: 10, limitedBy: 'monthly' })
    expect(remainingBudget({ ...b, usedMonthSegments: 0 })).toMatchObject({ remaining: 40, limitedBy: 'daily' })
  })
  it("oshib ketgan sarf manfiy qoldiq bermaydi", () => {
    expect(remainingBudget({ ...b, usedMonthSegments: 500 }).remaining).toBe(0)
  })
  it("3 segmentli SMS 2 segment qolganda sig'maydi (SMS soni emas, segment)", () => {
    const tight = { ...b, usedMonthSegments: 98 }
    expect(canSpend(tight, 2)).toBe(true)
    expect(canSpend(tight, 3)).toBe(false)
    expect(canSpend(tight, 0)).toBe(false)
  })
})

describe('decideReservation', () => {
  const ok: ReservationInput = {
    entityFound: true, entityStatus: 'active', smsOptOut: false, phoneValid: true, segments: 1,
    budget: { monthlyLimit: 100, usedMonthSegments: 0, dailyMax: 100, usedTodaySegments: 0 },
    duplicateExists: false, failedAttempts: 0, cooldownHit: false,
  }
  it('hamma shart joyida — ruxsat', () => expect(decideReservation(ok)).toEqual({ ok: true }))
  it.each([
    [{ entityFound: false }, 'not_found'],
    [{ entityStatus: 'blacklisted' }, 'bad_status'],
    [{ entityStatus: 'inactive' }, 'bad_status'],
    [{ entityStatus: 'draft' }, 'bad_status'],
    [{ smsOptOut: true }, 'opt_out'],
    [{ phoneValid: false }, 'no_phone'],
    [{ segments: 0 }, 'empty_message'],
    [{ duplicateExists: true }, 'duplicate'],
    [{ failedAttempts: MAX_SMS_ATTEMPTS }, 'max_attempts'],
    [{ cooldownHit: true }, 'cooldown'],
  ])('rad: %j → %s', (patch, reason) => {
    expect(decideReservation({ ...ok, ...(patch as object) })).toEqual({ ok: false, reason })
  })
  it("oylik limit va kunlik chegara alohida sabab", () => {
    expect(decideReservation({ ...ok, segments: 3, budget: { ...ok.budget, usedMonthSegments: 99 } }))
      .toEqual({ ok: false, reason: 'monthly_limit' })
    expect(decideReservation({ ...ok, segments: 3, budget: { ...ok.budget, usedTodaySegments: 99 } }))
      .toEqual({ ok: false, reason: 'daily_limit' })
  })
  it("opt-out byudjetdan oldin tekshiriladi (pul sarflanmaydi)", () => {
    expect(decideReservation({ ...ok, smsOptOut: true, segments: 9999 })).toEqual({ ok: false, reason: 'opt_out' })
  })
})

describe('Eskiz xato turlari', () => {
  it('HTTP → tur', () => {
    expect(classifyHttpFailure(401)).toBe('auth')
    expect(classifyHttpFailure(403)).toBe('auth')
    expect(classifyHttpFailure(429)).toBe('transient')
    expect(classifyHttpFailure(408)).toBe('transient')
    expect(classifyHttpFailure(500)).toBe('transient')
    expect(classifyHttpFailure(503)).toBe('transient')
    expect(classifyHttpFailure(400)).toBe('permanent')
    expect(classifyHttpFailure(422)).toBe('permanent')
  })
  it("config/auth — navbat darhol to'xtaydi; transient — 3 ketma-ket xatodan keyin", () => {
    expect(shouldAbortBatch('config', 0)).toBe(true)
    expect(shouldAbortBatch('auth', 0)).toBe(true)
    expect(shouldAbortBatch('transient', 2)).toBe(false)
    expect(shouldAbortBatch('transient', 3)).toBe(true)
    expect(shouldAbortBatch('permanent', 99)).toBe(false)
  })
  it("config/auth urinishni sarflamaydi", () => {
    expect(consumesAttempt('config')).toBe(false)
    expect(consumesAttempt('auth')).toBe(false)
    expect(consumesAttempt('transient')).toBe(true)
    expect(consumesAttempt('permanent')).toBe(true)
  })
})

describe('shouldRunAuto', () => {
  const base = { enabled: true, smsAutoDay: 10, todayDay: 10, smsAutoLastMonth: null, currentMonth: '2026-11' }
  it('aynan shu kuni ishlaydi', () => expect(shouldRunAuto(base)).toBe(true))
  it("kun o'tib ketgan, lekin shu oy ishlamagan — ishlaydi (davom etadi)", () => {
    expect(shouldRunAuto({ ...base, todayDay: 17 })).toBe(true)
    expect(shouldRunAuto({ ...base, todayDay: 31 })).toBe(true)
  })
  it('kun hali kelmagan — ishlamaydi', () => expect(shouldRunAuto({ ...base, todayDay: 9 })).toBe(false))
  it("shu oy to'liq ishlagan — qayta ishlamaydi", () => {
    expect(shouldRunAuto({ ...base, todayDay: 20, smsAutoLastMonth: '2026-11' })).toBe(false)
  })
  it("o'tgan oy ishlagan — yangi oyda yana ishlaydi", () => {
    expect(shouldRunAuto({ ...base, smsAutoLastMonth: '2026-10' })).toBe(true)
  })
  it("o'chirilgan — ishlamaydi", () => expect(shouldRunAuto({ ...base, enabled: false })).toBe(false))
})

describe('sortCandidates — levelRank (JS), keyin qarz kamayish', () => {
  it('critical > overdue > warning, ichida katta qarz oldin', () => {
    const list = [
      { id: 'a', debtLevel: 'warning', debt: 9_000_000 },
      { id: 'b', debtLevel: 'critical', debt: 100_000 },
      { id: 'c', debtLevel: 'overdue', debt: 500_000 },
      { id: 'd', debtLevel: 'critical', debt: 700_000 },
      { id: 'e', debtLevel: 'overdue', debt: 2_000_000 },
    ]
    expect(sortCandidates(list).map(x => x.id)).toEqual(['d', 'b', 'e', 'c', 'a'])
  })
  it("matn tartibidagi xatoni takrorlamaydi (alifbo bo'yicha 'warning' > 'critical')", () => {
    const s = sortCandidates([
      { id: '1', debtLevel: 'warning', debt: 1 }, { id: '2', debtLevel: 'critical', debt: 1 },
    ])
    expect(s[0].debtLevel).toBe('critical')
  })
  it("asl massivni o'zgartirmaydi va barqaror", () => {
    const l = [{ id: 'b', debtLevel: 'overdue', debt: 5 }, { id: 'a', debtLevel: 'overdue', debt: 5 }]
    const s = sortCandidates(l)
    expect(l[0].id).toBe('b')
    expect(s.map(x => x.id)).toEqual(['a', 'b'])
  })
})

describe('selectWithinBudget', () => {
  it("sig'maganini o'tkazib, kichigini oladi", () => {
    const r = selectWithinBudget([{ segments: 3 }, { segments: 3 }, { segments: 1 }, { segments: 2 }], 5)
    expect(r.spent).toBe(4)
    expect(r.chosen.map(c => c.segments)).toEqual([3, 1])
    expect(r.deferred.map(c => c.segments)).toEqual([3, 2])
  })
  it('qoldiq 0 — hech narsa', () => expect(selectWithinBudget([{ segments: 1 }], 0).chosen).toHaveLength(0))
})

describe('yuborish oynasi (UZT 10:00–18:00)', () => {
  it('chegaralar', () => {
    expect(isInSendWindow(9)).toBe(false)
    expect(isInSendWindow(10)).toBe(true)
    expect(isInSendWindow(17)).toBe(true)
    expect(isInSendWindow(18)).toBe(false)
    expect(isInSendWindow(2)).toBe(false)
  })
})

describe('eskalatsiya qayta urinish qoidalari', () => {
  it("qator yo'q → urinish", () => expect(decideEscalationRow(null)).toBe('try'))
  it("bajarilgan → o'tkazish", () => expect(decideEscalationRow({ status: 'done', attempts: 1 })).toBe('skip_done'))
  it('pending/failed va urinish < 3 → urinish', () => {
    expect(decideEscalationRow({ status: 'pending', attempts: 0 })).toBe('try')
    expect(decideEscalationRow({ status: 'failed', attempts: 2 })).toBe('try')
  })
  it('urinish chegarasi → taslim', () => expect(decideEscalationRow({ status: 'failed', attempts: 3 })).toBe('give_up'))
})

describe('import qilingan tashkilot — birinchi sinxronlash jim', () => {
  const now = new Date('2026-11-10T10:00:00Z')
  const fresh = new Date('2026-11-09T12:00:00Z')
  it('import + yangi + current → jim', () => {
    expect(isSilentFirstSync({ importBatchId: 'b1', oldLevel: 'current', createdAt: fresh, now })).toBe(true)
  })
  it("import emas (qo'lda kiritilgan) → jim EMAS", () => {
    expect(isSilentFirstSync({ importBatchId: null, oldLevel: 'current', createdAt: fresh, now })).toBe(false)
  })
  it("daraja allaqachon o'rnatilgan (birinchi emas) → jim emas", () => {
    expect(isSilentFirstSync({ importBatchId: 'b1', oldLevel: 'warning', createdAt: fresh, now })).toBe(false)
  })
  it('eski import → jim emas', () => {
    expect(isSilentFirstSync({ importBatchId: 'b1', oldLevel: 'current', createdAt: new Date('2026-10-01T00:00:00Z'), now })).toBe(false)
  })
})

describe('SMS samaradorligi (7 kun)', () => {
  const now = new Date('2026-11-30T00:00:00Z')
  const d = (s: string) => new Date(s + 'Z')
  it("SMS dan keyin 7 kun ichida to'laganlar ulushi", () => {
    const r = computeSmsEffectiveness(
      [{ entityId: 'a', at: d('2026-11-01T05:00:00') }, { entityId: 'b', at: d('2026-11-01T05:00:00') },
       { entityId: 'c', at: d('2026-11-01T05:00:00') }, { entityId: 'd', at: d('2026-11-01T05:00:00') }],
      [{ entityId: 'a', paidAt: d('2026-11-03T10:00:00'), amount: 100_000 },
       { entityId: 'b', paidAt: d('2026-11-07T04:59:59'), amount: 50_000 }],
      now,
    )
    expect(r).toMatchObject({ smsEntities: 4, evaluated: 4, paid: 2, ratePercent: 50, paidAmount: 150_000 })
  })
  it("SMS dan OLDIN yoki 7 kundan keyingi to'lov sanalmaydi (7*24 soat chegara kiritilmaydi)", () => {
    const r = computeSmsEffectiveness(
      [{ entityId: 'a', at: d('2026-11-10T05:00:00') }, { entityId: 'b', at: d('2026-11-10T05:00:00') }],
      [{ entityId: 'a', paidAt: d('2026-11-10T04:59:59'), amount: 1 },
       { entityId: 'b', paidAt: d('2026-11-17T05:00:00'), amount: 1 }],
      now,
    )
    expect(r.paid).toBe(0)
    expect(r.ratePercent).toBe(0)
  })
  it("hali 7 kun o'tmagan SMS baholanmaydi (ulush sun'iy tushmasin)", () => {
    const r = computeSmsEffectiveness([{ entityId: 'a', at: d('2026-11-28T05:00:00') }], [], now)
    expect(r).toMatchObject({ smsEntities: 1, evaluated: 0, paid: 0, ratePercent: null })
  })
  it("ko'p SMS / ko'p to'lov tashkilotni bir marta sanaydi", () => {
    const r = computeSmsEffectiveness(
      [{ entityId: 'a', at: d('2026-11-01T05:00:00') }, { entityId: 'a', at: d('2026-11-02T05:00:00') }],
      [{ entityId: 'a', paidAt: d('2026-11-03T05:00:00'), amount: 10 }, { entityId: 'a', paidAt: d('2026-11-04T05:00:00'), amount: 10 }],
      now,
    )
    expect(r).toMatchObject({ evaluated: 1, paid: 1, ratePercent: 100, paidAmount: 20 })
  })
})

// ─── Invariantlar: 250 tasodifiy stsenariy (mulberry32) ──────────────────────

describe('invariantlar (seeded PRNG)', () => {
  it("byudjet hech qachon oshmaydi; bir (tashkilot, tur, davr) ga ikki SMS yo'q", () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed)
      const monthlyLimit = ri(r, 0, 120)
      const dailyMax = ri(r, 0, 60)
      let usedMonth = ri(r, 0, monthlyLimit + 10) // ba'zan allaqachon oshgan
      const usedMonth0 = usedMonth
      let usedToday = ri(r, 0, dailyMax + 5)
      const usedToday0 = usedToday
      const reserved = new Set<string>()
      const failedBy = new Map<string, number>()
      const entities = ri(r, 1, 8)
      const kinds = ['auto', 'escalation', 'manual']
      const periods = ['2026-11', '2026-11:critical']

      for (let step = 0; step < 60; step++) {
        const entityId = `e${ri(r, 1, entities)}`
        const kind = kinds[ri(r, 0, 2)]
        const period = periods[ri(r, 0, 1)]
        const key = dedupKey(entityId, kind, period)
        const segments = ri(r, 0, 4)
        const decision = decideReservation({
          entityFound: true, entityStatus: r() < 0.9 ? 'active' : 'blacklisted',
          smsOptOut: r() < 0.1, phoneValid: r() < 0.95, segments,
          budget: { monthlyLimit, usedMonthSegments: usedMonth, dailyMax, usedTodaySegments: usedToday },
          duplicateExists: reserved.has(key),
          failedAttempts: failedBy.get(key) ?? 0,
          cooldownHit: r() < 0.05,
        })
        if (decision.ok) {
          expect(reserved.has(key)).toBe(false)
          reserved.add(key)
          usedMonth += segments
          usedToday += segments
          if (r() < 0.2) { // keyin muvaffaqiyatsiz bo'ldi: band joy qaytadi, urinish sarflanadi
            reserved.delete(key)
            usedMonth -= segments
            usedToday -= segments
            failedBy.set(key, (failedBy.get(key) ?? 0) + 1)
          }
        }
        // Qo'shilgan sarf hech qachon chegaradan oshmaydi (boshlang'ich oshgan bo'lsa — o'smaydi)
        expect(usedMonth).toBeLessThanOrEqual(Math.max(monthlyLimit, usedMonth0))
        expect(usedToday).toBeLessThanOrEqual(Math.max(dailyMax, usedToday0))
      }
      // Muvaffaqiyatsiz urinishlar chegaradan keyin yangi yuborishga yo'l qo'ymaydi
      for (const [key, n] of failedBy) {
        if (n >= MAX_SMS_ATTEMPTS) {
          const again = decideReservation({
            entityFound: true, entityStatus: 'active', smsOptOut: false, phoneValid: true, segments: 1,
            budget: { monthlyLimit: 1e6, usedMonthSegments: 0, dailyMax: 1e6, usedTodaySegments: 0 },
            duplicateExists: false, failedAttempts: n, cooldownHit: false,
          })
          expect(again.ok).toBe(false)
          expect(key.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it("selectWithinBudget: yig'indi qoldiqdan oshmaydi, chosen+deferred = hamma", () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 7919)
      const items = Array.from({ length: ri(r, 0, 40) }, (_, i) => ({ id: i, segments: ri(r, 0, 5) }))
      const remaining = ri(r, 0, 80)
      const out = selectWithinBudget(items, remaining)
      expect(out.chosen.reduce((s, c) => s + c.segments, 0)).toBeLessThanOrEqual(remaining)
      expect(out.chosen.length + out.deferred.length).toBe(items.length)
      expect(out.spent).toBe(out.chosen.reduce((s, c) => s + c.segments, 0))
    }
  })

  it('sortCandidates: tartib monoton (daraja, keyin qarz)', () => {
    const levels = ['warning', 'overdue', 'critical']
    const rank: Record<string, number> = { warning: 1, overdue: 2, critical: 3 }
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 104729)
      const list = Array.from({ length: ri(r, 0, 30) }, (_, i) => ({
        id: `x${i}`, debtLevel: levels[ri(r, 0, 2)], debt: ri(r, 0, 20) * 100_000,
      }))
      const s = sortCandidates(list)
      expect(s).toHaveLength(list.length)
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1], b = s[i]
        expect(rank[a.debtLevel]).toBeGreaterThanOrEqual(rank[b.debtLevel])
        if (rank[a.debtLevel] === rank[b.debtLevel]) expect(a.debt).toBeGreaterThanOrEqual(b.debt)
      }
    }
  })

  it('SMS samaradorligi: 0 ≤ paid ≤ evaluated ≤ smsEntities, ulush [0,100]', () => {
    const now = new Date('2026-12-31T00:00:00Z')
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 31)
      const t0 = Date.parse('2026-10-01T00:00:00Z')
      const sms = Array.from({ length: ri(r, 0, 30) }, () => ({ entityId: `e${ri(r, 1, 10)}`, at: new Date(t0 + ri(r, 0, 80) * 86_400_000) }))
      const pays = Array.from({ length: ri(r, 0, 30) }, () => ({ entityId: `e${ri(r, 1, 10)}`, paidAt: new Date(t0 + ri(r, 0, 90) * 86_400_000), amount: ri(r, 0, 500_000) }))
      const e = computeSmsEffectiveness(sms, pays, now)
      expect(e.paid).toBeGreaterThanOrEqual(0)
      expect(e.paid).toBeLessThanOrEqual(e.evaluated)
      expect(e.evaluated).toBeLessThanOrEqual(e.smsEntities)
      if (e.ratePercent !== null) { expect(e.ratePercent).toBeGreaterThanOrEqual(0); expect(e.ratePercent).toBeLessThanOrEqual(100) }
    }
  })
})
