// Qarz YAGONA manbasi — invariant testlar (seeded, 400 stsenariy).
// Bir tashkilot uchun: getEntityBalance == computeEntityDebt == akt sverka == SQL-ekvivalent (entityDebtFromMonthRows);
// tuman/mahalla/jami yig'indilar; oylik hisobot jami qarzi == Σ kanonik.

import { mulberry32, randInt, pick } from './testRng'
import { computeEntityDebt, getEntityBalance, talonMonth, talonPaidPart } from './debtMath'
import { buildReconciliation } from './reconciliation'
import {
  entityDebtFromMonthRows, groupEntityDebts, summarizeDebt, debtByDistrict, debtByMahalla, sumTotals, MonthExPd,
} from './debtSummary'
import { buildMonthlyReport } from './monthlyReport'

const SCENARIOS = 400
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']

interface Ent {
  mode: 'monthly_fixed' | 'talon' | 'variable'
  status: string
  districtId: string
  mahallId: string | null
  charges: { month: string; expectedAmount: number; paidAmount: number }[]
  talons: { date: Date; amount: number; paid: boolean; paidAmount: number }[]
  payments: { month: string; amount: number; paidAt: Date }[]
}

function genEntity(rnd: () => number): Ent {
  const r = rnd()
  const mode = r < 0.5 ? 'monthly_fixed' : r < 0.8 ? 'talon' : 'variable'
  const e: Ent = {
    mode, status: pick(rnd, ['active', 'active', 'active', 'blacklisted', 'inactive', 'draft']),
    districtId: pick(rnd, ['d1', 'd2', 'd3']), mahallId: rnd() < 0.3 ? null : pick(rnd, ['m1', 'm2', 'm3']),
    charges: [], talons: [], payments: [],
  }
  if (mode === 'monthly_fixed') {
    for (const month of MONTHS) {
      if (rnd() < 0.2) continue
      const expectedAmount = randInt(rnd, 2, 40) * 10000
      const x = rnd()
      // 0 / qisman / to'liq / ORTIQCHA to'langan oy
      const paidAmount = x < 0.3 ? 0 : x < 0.55 ? randInt(rnd, 1, expectedAmount - 1)
        : x < 0.8 ? expectedAmount : expectedAmount + randInt(rnd, 1, 60) * 10000
      e.charges.push({ month, expectedAmount, paidAmount })
      if (paidAmount > 0) {
        e.payments.push({ month, amount: paidAmount, paidAt: new Date(Date.UTC(2026, Number(month.slice(5)) - 1, 15, 7)) })
      }
    }
  } else if (mode === 'talon') {
    const n = randInt(rnd, 0, 8)
    for (let i = 0; i < n; i++) {
      const amount = randInt(rnd, 2, 50) * 10000
      const x = rnd()
      const paid = x < 0.3
      const paidAmount = paid ? amount : x < 0.55 ? randInt(rnd, 1, amount - 1) : 0
      const date = new Date(Date.UTC(2026, randInt(rnd, 0, 7), randInt(rnd, 1, 28)))
      e.talons.push({ date, amount, paid, paidAmount })
      const pp = talonPaidPart({ amount, paid, paidAmount })
      if (pp > 0) e.payments.push({ month: talonMonth(date), amount: pp, paidAt: new Date(date.getTime() + 36e5 * 10) })
    }
  } else {
    const n = randInt(rnd, 0, 4)
    for (let i = 0; i < n; i++) {
      const month = pick(rnd, MONTHS)
      e.payments.push({ month, amount: randInt(rnd, 1, 20) * 10000, paidAt: new Date(Date.UTC(2026, Number(month.slice(5)) - 1, 10, 7)) })
    }
  }
  return e
}

/** SQL'dagi `mm` CTE ning pure ko'rinishi: rejimga qarab oylik (ex, pd) qatorlari — getEntityBalance'siz, xom ma'lumotdan. */
function monthRowsLikeSql(e: Ent): MonthExPd[] {
  if (e.mode === 'monthly_fixed') {
    return e.charges.map(c => ({ month: c.month, ex: Math.max(0, c.expectedAmount), pd: Math.max(0, c.paidAmount) }))
  }
  if (e.mode === 'talon') {
    const by = new Map<string, MonthExPd>()
    for (const t of e.talons) {
      const m = talonMonth(t.date)
      const cur = by.get(m) ?? { month: m, ex: 0, pd: 0 }
      cur.ex += Math.max(0, t.amount)
      cur.pd += talonPaidPart(t)
      by.set(m, cur)
    }
    return [...by.values()]
  }
  return []
}

describe('qarz yagona manbasi — tashkilot darajasida netto', () => {
  it('getEntityBalance == computeEntityDebt == akt sverka == SQL-ekvivalent (400 stsenariy)', () => {
    const rnd = mulberry32(777)
    let netted = 0
    for (let i = 0; i < SCENARIOS; i++) {
      const e = genEntity(rnd)
      const bal = getEntityBalance({ billingMode: e.mode, charges: e.charges, talons: e.talons })
      const dbt = computeEntityDebt({ billingMode: e.mode, charges: e.charges, talons: e.talons })
      const rec = buildReconciliation({ billingMode: e.mode, charges: e.charges, talons: e.talons, payments: e.payments })
      const agg = entityDebtFromMonthRows(monthRowsLikeSql(e))

      expect(dbt.totalDebt).toBe(bal.totalDebt)
      expect(rec.closingDebt).toBe(bal.totalDebt)
      expect(agg.debt).toBe(bal.totalDebt)
      expect(agg.advance).toBe(bal.advance)
      expect(agg.months).toBe(bal.debtMonths)
      expect(agg.unpaidMonths).toEqual(bal.unpaidMonths)
      expect(bal.totalDebt >= 0 && Number.isInteger(bal.totalDebt)).toBe(true)
      // qarz va avans bir vaqtda > 0 bo'lmaydi
      expect(bal.totalDebt > 0 && agg.advance > 0).toBe(false)
      // ortiqcha to'langan oy bor VA qarzdor oy qolgan — netto qoidasi sinaldi
      if (e.mode === 'monthly_fixed' && e.charges.some(c => c.paidAmount > c.expectedAmount) && bal.debtMonths > 0) netted++
    }
    expect(netted).toBeGreaterThan(20)
  })

  it("ortiqcha to'langan oy boshqa oy qarzini qoplaydi (oyma-oy qirqish emas)", () => {
    const a = entityDebtFromMonthRows([{ month: '2026-01', ex: 100, pd: 0 }, { month: '2026-02', ex: 100, pd: 250 }])
    expect(a.debt).toBe(0)
    expect(a.advance).toBe(50)
    expect(a.unpaidMonths).toEqual([])
    const b = entityDebtFromMonthRows([
      { month: '2026-01', ex: 100, pd: 0 }, { month: '2026-02', ex: 100, pd: 130 }, { month: '2026-03', ex: 100, pd: 0 },
    ])
    expect(b.debt).toBe(170)
    expect(b.unpaidMonths).toEqual(['2026-01', '2026-03'])
  })

  it("tuman/mahalla/jami yig'indilar: Σ tuman == jami, Σ mahalla == tuman, == Σ tashkilot", () => {
    const rnd = mulberry32(4242)
    for (let k = 0; k < 40; k++) {
      const ents = Array.from({ length: 30 }, () => genEntity(rnd))
      const flat = ents.map(e => ({
        districtId: e.districtId, mahallId: e.mahallId, status: e.status,
        debt: getEntityBalance({ billingMode: e.mode, charges: e.charges, talons: e.talons }).totalDebt,
      }))
      const rows = groupEntityDebts(flat)
      for (const incl of [false, true]) {
        const s = summarizeDebt(rows, incl)
        const want = flat.filter(f => f.status === 'active' || (incl && f.status === 'blacklisted')).reduce((a, f) => a + f.debt, 0)
        expect(s.totalDebt).toBe(want)
        const dd = debtByDistrict(rows, incl)
        expect(sumTotals(dd).debt).toBe(s.totalDebt)
        for (const [did, tot] of dd) expect(sumTotals(debtByMahalla(rows, did, incl)).debt).toBe(tot.debt)
        expect(sumTotals(dd).debtors).toBe(s.totalDebtors)
      }
      const s0 = summarizeDebt(rows, false)
      expect(s0.activeDebt + s0.blacklistedDebt + s0.otherDebt).toBe(flat.reduce((a, f) => a + f.debt, 0))
    }
  })

  it('oylik hisobot: jami qarz == Σ kanonik; oylik ochiq qoldiq alohida (periodOpenDebt)', () => {
    const rnd = mulberry32(99)
    for (let k = 0; k < 60; k++) {
      const ents = Array.from({ length: 25 }, () => genEntity(rnd)).filter(e => e.mode === 'monthly_fixed')
      const canonical = ents.reduce((s, e) => s + getEntityBalance({ billingMode: e.mode, charges: e.charges }).totalDebt, 0)
      // oy kesimida NETTOSIZ ochiq qoldiq (har tashkilot-oy: max(0, ex − pd))
      const agg = new Map<string, any>()
      for (const m of MONTHS) {
        let ex = 0, applied = 0
        for (const e of ents) for (const c of e.charges) if (c.month === m) { ex += c.expectedAmount; applied += Math.min(c.paidAmount, c.expectedAmount) }
        agg.set(m, { chargeExpected: ex, talonExpected: 0, applied, remaining: ex - applied, obliged: 1, settled: 0 })
      }
      const withCanon = buildMonthlyReport(MONTHS, agg, { canonicalDebt: canonical })
      expect(withCanon.totals.debt).toBe(canonical)
      const gross = MONTHS.reduce((s, m) => s + agg.get(m).remaining, 0)
      expect(withCanon.totals.periodOpenDebt).toBe(gross)
      // netto hech qachon brutto'dan katta emas (davr = butun tarix)
      expect(canonical).toBeLessThanOrEqual(gross)
      // canonicalDebt berilmasa — eski xatti-harakat (oylar yig'indisi)
      expect(buildMonthlyReport(MONTHS, agg).totals.debt).toBe(gross)
    }
  })
})
