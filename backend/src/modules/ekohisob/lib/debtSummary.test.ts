import {
  DebtGroupRow, summarizeDebt, debtByDistrict, debtByMahalla, sumTotals, reportStatuses, NO_MAHALLA,
} from './debtSummary'
import { mulberry32, randInt, pick } from './testRng'

describe('summarizeDebt — faol va qora royxat qarzi ALOHIDA', () => {
  const rows: DebtGroupRow[] = [
    { districtId: 'd1', mahallId: 'm1', status: 'active', debt: 1000, debtors: 2 },
    { districtId: 'd1', mahallId: null, status: 'active', debt: 500, debtors: 1 },
    { districtId: 'd2', mahallId: 'm9', status: 'blacklisted', debt: 7000, debtors: 3 },
    { districtId: 'd2', mahallId: 'm9', status: 'inactive', debt: 99, debtors: 1 },
  ]

  it('standart: faqat faol', () => {
    const s = summarizeDebt(rows)
    expect(s.activeDebt).toBe(1500)
    expect(s.blacklistedDebt).toBe(7000)
    expect(s.otherDebt).toBe(99)
    expect(s.totalDebt).toBe(1500)
    expect(s.totalDebtors).toBe(3)
  })

  it('includeBlacklisted: jamiga qoshiladi, boshqa (inactive) hech qachon', () => {
    const s = summarizeDebt(rows, true)
    expect(s.totalDebt).toBe(8500)
    expect(s.totalDebtors).toBe(6)
  })

  it('mahallasiz qarz HAQIQIY (0 emas)', () => {
    const m = debtByMahalla(rows, 'd1')
    expect(m.get(NO_MAHALLA)).toEqual({ debt: 500, debtors: 1 })
  })

  it('bosh toplam: nol, NaN/Infinity yoq', () => {
    const s = summarizeDebt([])
    expect(s).toMatchObject({ activeDebt: 0, blacklistedDebt: 0, totalDebt: 0, totalDebtors: 0 })
    expect(sumTotals(debtByDistrict([]))).toEqual({ debt: 0, debtors: 0 })
  })

  it('NaN/manfiy qiymatlar nolga keltiriladi', () => {
    const s = summarizeDebt([
      { districtId: 'd', mahallId: null, status: 'active', debt: Number.NaN, debtors: -3 },
      { districtId: 'd', mahallId: null, status: 'active', debt: -50, debtors: 1 },
    ])
    expect(s.totalDebt).toBe(0)
    expect(s.totalDebtors).toBe(1)
  })

  it('reportStatuses', () => {
    expect(reportStatuses(false)).toEqual(['active'])
    expect(reportStatuses(true)).toEqual(['active', 'blacklisted'])
  })
})

describe('invariant: tuman/mahalla yigindisi == KPI jami (400 tasodifiy stsenariy)', () => {
  const STATUSES = ['active', 'active', 'active', 'blacklisted', 'inactive', 'draft']
  for (let seed = 1; seed <= 400; seed++) {
    it(`seed ${seed}`, () => {
      const rnd = mulberry32(seed)
      const n = randInt(rnd, 0, 40)
      const rows: DebtGroupRow[] = []
      for (let i = 0; i < n; i++) {
        rows.push({
          districtId: `d${randInt(rnd, 1, 5)}`,
          mahallId: rnd() < 0.2 ? null : `m${randInt(rnd, 1, 6)}`,
          status: pick(rnd, STATUSES),
          debt: randInt(rnd, 0, 5_000_000),
          debtors: randInt(rnd, 0, 30),
        })
      }
      for (const inc of [false, true]) {
        const s = summarizeDebt(rows, inc)
        const dist = debtByDistrict(rows, inc)
        const sum = sumTotals(dist)
        expect(sum.debt).toBe(s.totalDebt)
        expect(sum.debtors).toBe(s.totalDebtors)
        // mahalla yigindisi == shu tuman
        for (const [did, t] of dist) {
          expect(sumTotals(debtByMahalla(rows, did, inc))).toEqual(t)
        }
        expect(Number.isFinite(s.totalDebt)).toBe(true)
      }
      // hamma holat yigindisi == faol + qora + boshqa
      const all = rows.reduce((a, r) => a + r.debt, 0)
      const s0 = summarizeDebt(rows)
      expect(s0.activeDebt + s0.blacklistedDebt + s0.otherDebt).toBe(all)
    })
  }
})
