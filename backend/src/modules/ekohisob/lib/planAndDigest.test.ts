import { addDaysIso, checkPlanChange, normalizedTarget } from './planMath'
import {
  formatManagerMorning, hasMorningActions, selectDuePromises, findChurned, formatChurnWeekly,
  escapeHtml, MorningDigestInput,
} from './managerDigestFormat'

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

describe('addDaysIso', () => {
  it('oy va yil chegarasi, kabisa yili', () => {
    expect(addDaysIso('2026-11-10', -1)).toBe('2026-11-09')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysIso('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31')
  })
  it("noto'g'ri sana — xato", () => expect(() => addDaysIso('2026-02-30', 1)).toThrow())
})

describe('checkPlanChange', () => {
  const today = '2026-11-10'
  it('bugun va kelajak — boshliq ham mumkin', () => {
    expect(checkPlanChange({ date: today, today, role: 'supervisor' })).toEqual({ ok: true, past: false })
    expect(checkPlanChange({ date: '2026-11-11', today, role: 'supervisor' })).toEqual({ ok: true, past: false })
  })
  it("o'tgan sana — boshliq uchun 403", () => {
    expect(checkPlanChange({ date: '2026-11-09', today, role: 'supervisor', reason: 'xatoni tuzatish' }))
      .toMatchObject({ ok: false, status: 403 })
  })
  it("o'tgan sana — admin sabab bilan", () => {
    expect(checkPlanChange({ date: '2026-11-09', today, role: 'admin' })).toMatchObject({ ok: false, status: 400 })
    expect(checkPlanChange({ date: '2026-11-09', today, role: 'admin', reason: '  ab  ' })).toMatchObject({ ok: false, status: 400 })
    expect(checkPlanChange({ date: '2026-11-09', today, role: 'admin', reason: 'Noto\'g\'ri kiritilgan edi' })).toEqual({ ok: true, past: true })
  })
  it("noto'g'ri sana — 400 (500 emas)", () => {
    expect(checkPlanChange({ date: '2026-02-30', today, role: 'admin' })).toMatchObject({ ok: false, status: 400 })
    expect(checkPlanChange({ date: 'abc', today, role: 'admin' })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('normalizedTarget', () => {
  it("o'rtacha yuk — maqsad o'zgarmaydi", () => expect(normalizedTarget({ baseTarget: 20, load: 100, avgLoad: 100 })).toBe(20))
  it('katta tuman — ko\'proq, kichik — kamroq', () => {
    expect(normalizedTarget({ baseTarget: 20, load: 150, avgLoad: 100 })).toBe(30)
    expect(normalizedTarget({ baseTarget: 20, load: 60, avgLoad: 100 })).toBe(12)
  })
  it('koeffitsient [0.5, 2] bilan cheklangan', () => {
    expect(normalizedTarget({ baseTarget: 20, load: 1000, avgLoad: 100 })).toBe(40)
    expect(normalizedTarget({ baseTarget: 20, load: 1, avgLoad: 100 })).toBe(10)
  })
  it("yuk noma'lum bo'lsa asosiy maqsad; maqsad 0 bo'lsa 0; kamida 1", () => {
    expect(normalizedTarget({ baseTarget: 20, load: 5, avgLoad: 0 })).toBe(20)
    expect(normalizedTarget({ baseTarget: 0, load: 5, avgLoad: 10 })).toBe(0)
    expect(normalizedTarget({ baseTarget: 1, load: 1, avgLoad: 100 })).toBe(1)
  })
  it('invariant: butun, ≥1 (maqsad>0), asosiy×[0.5,2] oralig\'ida (250 stsenariy)', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 7)
      const base = ri(r, 1, 100)
      const v = normalizedTarget({ baseTarget: base, load: ri(r, 0, 1000), avgLoad: ri(r, 1, 500) })
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeGreaterThanOrEqual(Math.round(base * 0.5))
      expect(v).toBeLessThanOrEqual(base * 2)
    }
  })
})

describe('ertalabki xulosa formati ("So what?")', () => {
  const quiet: MorningDigestInput = {
    yesterday: '2026-11-09', yesterdayCollected: 5_000_000, yesterdayCount: 12,
    monthCollected: 20_000_000, monthExpected: 40_000_000, newCritical: [], idleInspectors: [], promises: [],
  }
  it("harakat talab qilmasa YUBORILMAYDI (kassa ma'lumoti sabab emas)", () => {
    expect(hasMorningActions(quiet)).toBe(false)
    expect(formatManagerMorning(quiet)).toBeNull()
  })
  it("bo'sh kun (kassa 0, hech narsa yo'q) — null", () => {
    expect(formatManagerMorning({ ...quiet, yesterdayCollected: 0, yesterdayCount: 0, monthExpected: 0 })).toBeNull()
  })
  it('harakat bor — barcha bo\'limlar, sana kun.oy.yil', () => {
    const msg = formatManagerMorning({
      ...quiet,
      newCritical: [{ name: 'Oq Yo\'l MChJ', debt: 3_600_000 }],
      idleInspectors: ['Ali Valiyev', 'Vali Aliyev'],
      promises: [{ name: 'Nur LLC', promisedDate: '2026-11-08', daysOverdue: 2, debt: 900_000 }],
    })!
    expect(msg).toContain('09.11.2026')
    expect(msg).toContain('5 000 000')
    expect(msg).toContain('50%')
    expect(msg).toContain('Oq Yo\'l MChJ')
    expect(msg).toContain('3 600 000')
    expect(msg).toContain('08.11.2026')
    expect(msg).toContain('2 kun o\'tdi')
    expect(msg).toContain('Ali Valiyev, Vali Aliyev')
  })
  it('HTML belgilari escape qilinadi (Telegram buzilmasin)', () => {
    expect(escapeHtml('A&B <i>')).toBe('A&amp;B &lt;i&gt;')
    const msg = formatManagerMorning({ ...quiet, newCritical: [{ name: 'A<b>&Co', debt: 1 }] })!
    expect(msg).toContain('A&lt;b&gt;&amp;Co')
  })
  it("ro'yxat uzun bo'lsa qisqartiriladi", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, debt: 1000 - i }))
    const msg = formatManagerMorning({ ...quiet, newCritical: many })!
    expect(msg).toContain('...va yana 4 ta')
  })
})

describe('selectDuePromises', () => {
  const ents = new Map([['a', { name: 'A', debt: 100 }], ['b', { name: 'B', debt: 0 }], ['c', { name: 'C', debt: 50 }]])
  it("muddati kelgan/o'tgan, qarzi bor, va'dadan keyin to'lamagan", () => {
    const out = selectDuePromises({
      today: '2026-11-10',
      visits: [
        { entityId: 'a', promisedDate: '2026-11-10', createdAt: '2026-11-05T05:00:00Z' },
        { entityId: 'b', promisedDate: '2026-11-01', createdAt: '2026-10-30T05:00:00Z' }, // qarzi yo'q
        { entityId: 'c', promisedDate: '2026-11-12', createdAt: '2026-11-05T05:00:00Z' }, // hali kelmagan
      ],
      entities: ents, lastPaymentAt: new Map(),
    })
    expect(out).toEqual([{ name: 'A', promisedDate: '2026-11-10', daysOverdue: 0, debt: 100 }])
  })
  it("va'dadan keyin to'lov bo'lsa chiqmaydi", () => {
    const out = selectDuePromises({
      today: '2026-11-10',
      visits: [{ entityId: 'a', promisedDate: '2026-11-08', createdAt: '2026-11-05T05:00:00Z' }],
      entities: ents, lastPaymentAt: new Map([['a', '2026-11-07T05:00:00Z']]),
    })
    expect(out).toHaveLength(0)
  })
  it("eng oxirgi va'da hisobga olinadi (yangi va'da muddatni suradi)", () => {
    const out = selectDuePromises({
      today: '2026-11-10',
      visits: [
        { entityId: 'a', promisedDate: '2026-11-03', createdAt: '2026-11-01T05:00:00Z' },
        { entityId: 'a', promisedDate: '2026-11-20', createdAt: '2026-11-04T05:00:00Z' },
      ],
      entities: ents, lastPaymentAt: new Map(),
    })
    expect(out).toHaveLength(0)
  })
})

describe('yaqinda to\'xtagan mijozlar', () => {
  const rows = (name: string, id: string, months: string[], amount = 100_000) =>
    months.map(month => ({ entityId: id, name, month, amount }))
  const cur = '2026-11'
  // silent: 2026-11, 2026-10, 2026-09; tarix: 2026-08 dan orqaga 6 oy (2026-03..2026-08)
  it('doimiy to\'lagan, oxirgi oylarda to\'lamagan — chiqadi', () => {
    const r = findChurned(rows('A', 'a', ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']), { currentMonth: cur })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ entityId: 'a', avgMonthly: 100_000, lastPaidMonth: '2026-08', paidMonths: 6 })
  })
  it("silent oynada to'lagan — to'xtamagan", () => {
    expect(findChurned(rows('A', 'a', ['2026-05', '2026-06', '2026-07', '2026-08', '2026-10']), { currentMonth: cur })).toHaveLength(0)
    expect(findChurned(rows('A', 'a', ['2026-05', '2026-06', '2026-07', '2026-08', '2026-11']), { currentMonth: cur })).toHaveLength(0)
  })
  it("doimiy emas (kam oy to'lagan) — chiqmaydi", () => {
    expect(findChurned(rows('A', 'a', ['2026-07', '2026-08']), { currentMonth: cur })).toHaveLength(0)
  })
  it("qimmatiga ko'ra saralanadi", () => {
    const r = findChurned([
      ...rows('Arzon', 'a', ['2026-05', '2026-06', '2026-07'], 50_000),
      ...rows('Qimmat', 'b', ['2026-05', '2026-06', '2026-07'], 900_000),
    ], { currentMonth: cur })
    expect(r.map(x => x.name)).toEqual(['Qimmat', 'Arzon'])
  })
  it("yil almashinuvi to'g'ri", () => {
    // joriy 2027-01: silent = 2027-01, 2026-12, 2026-11; tarix tugashi 2026-10
    const r = findChurned(rows('A', 'a', ['2026-08', '2026-09', '2026-10']), { currentMonth: '2027-01' })
    expect(r).toHaveLength(1)
    expect(findChurned(rows('A', 'a', ['2026-08', '2026-09', '2026-10', '2026-12']), { currentMonth: '2027-01' })).toHaveLength(0)
  })
  it("format: bo'sh — null; to'liq — kun.oy.yil emas, oy nomi", () => {
    expect(formatChurnWeekly([])).toBeNull()
    const msg = formatChurnWeekly([{ entityId: 'a', name: 'A&B', avgMonthly: 1_200_000, lastPaidMonth: '2026-08', paidMonths: 5 }])!
    expect(msg).toContain('A&amp;B')
    expect(msg).toContain('1 200 000')
    expect(msg).toContain('Avgust 2026')
  })
  it('invariant: natija tarixi doim minPaid dan kam emas va avg > 0 (250 stsenariy)', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = mulberry32(seed * 91)
      const data = Array.from({ length: ri(r, 0, 60) }, () => ({
        entityId: `e${ri(r, 1, 6)}`, name: 'N', month: `2026-${String(ri(r, 1, 11)).padStart(2, '0')}`, amount: ri(r, -10, 500_000),
      }))
      const out = findChurned(data, { currentMonth: '2026-11' })
      for (const c of out) {
        expect(c.paidMonths).toBeGreaterThanOrEqual(3)
        expect(c.avgMonthly).toBeGreaterThan(0)
        expect(c.lastPaidMonth <= '2026-08').toBe(true)
      }
      for (let i = 1; i < out.length; i++) expect(out[i - 1].avgMonthly).toBeGreaterThanOrEqual(out[i].avgMonthly)
    }
  })
})
