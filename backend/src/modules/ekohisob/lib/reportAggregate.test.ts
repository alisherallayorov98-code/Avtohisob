import {
  ObligationRow, sumObligations, totalsByMonth, totalsByDistrict, totalsByMahalla, settlementRate,
  collectionRate, advanceAmount, pctChange, computePace, dateOnlyKey, rollupPaymentGroups, emptyTotals,
} from './reportAggregate'
import { payRate, debtAgeRowsFromBuckets } from './reportMath'
import { monthOfUz, monthBoundsUz, dayOfUz, dayBoundsUz } from './uzt'
import { mulberry32, randInt, pick } from './testRng'

function randomRows(rnd: () => number, months: string[]): ObligationRow[] {
  const rows: ObligationRow[] = []
  const seen = new Set<string>()
  const n = randInt(rnd, 0, 30)
  for (let i = 0; i < n; i++) {
    const month = pick(rnd, months)
    const districtId = `d${randInt(rnd, 1, 4)}`
    const mahallId = rnd() < 0.25 ? null : `m${randInt(rnd, 1, 3)}`
    const key = `${month}|${districtId}|${mahallId}`
    if (seen.has(key)) continue
    seen.add(key)
    const obliged = randInt(rnd, 0, 50)
    const settled = randInt(rnd, 0, obliged)
    const partial = randInt(rnd, 0, obliged - settled)
    const expected = obliged === 0 ? 0 : randInt(rnd, obliged * 1000, obliged * 900_000)
    const applied = randInt(rnd, 0, expected)
    const expectedCharge = randInt(rnd, 0, expected)
    rows.push({ month, districtId, mahallId, obliged, settled, partial, expected, applied, expectedCharge })
  }
  return rows
}

describe('settlementRate / collectionRate', () => {
  it('qisman tolov toliq tolagan emas: 3 tadan 1 tasi toliq -> 33%', () => {
    const t = sumObligations([
      { month: 'm', districtId: 'd', mahallId: null, obliged: 3, settled: 1, partial: 1, expected: 300, applied: 150, expectedCharge: 300 },
    ])
    expect(settlementRate(t)).toBe(33)
    expect(collectionRate(t)).toBe(50)
    expect(t.remaining).toBe(150)
  })

  it('bosh toplam: null, NaN yoq', () => {
    const t = sumObligations([])
    expect(t).toEqual(emptyTotals())
    expect(settlementRate(t)).toBeNull()
    expect(collectionRate(t)).toBeNull()
  })

  it('payRate 100 dan oshishi mumkin (kesilmaydi)', () => {
    expect(payRate(250, 100)).toBe(250)
  })
})

describe('invariantlar (400 tasodifiy stsenariy)', () => {
  const months = ['2026-08', '2026-09', '2026-10', '2026-11']
  for (let seed = 1; seed <= 400; seed++) {
    it(`seed ${seed}`, () => {
      const rnd = mulberry32(seed * 7919)
      const rows = randomRows(rnd, months)
      const all = sumObligations(rows)

      // Sum oylar == jami
      const byMonth = totalsByMonth(rows, months)
      let sumExpected = 0, sumApplied = 0, sumObliged = 0, sumRemaining = 0
      for (const t of byMonth.values()) {
        sumExpected += t.expected; sumApplied += t.applied; sumObliged += t.obliged; sumRemaining += t.remaining
        // yopilgan + qoldiq == kutilgan (har oyda)
        expect(t.applied + t.remaining).toBe(t.expected)
        expect(t.settled + t.partial).toBeLessThanOrEqual(t.obliged)
      }
      expect(sumExpected).toBe(all.expected)
      expect(sumApplied).toBe(all.applied)
      expect(sumObliged).toBe(all.obliged)
      expect(sumRemaining).toBe(all.expected - all.applied)

      // Sum tumanlar == oy jami; Sum mahallalar == tuman
      for (const m of months) {
        const dists = totalsByDistrict(rows, m)
        const monthTotal = byMonth.get(m)!
        let e = 0, ap = 0, ob = 0, st = 0
        for (const [did, dt] of dists) {
          e += dt.expected; ap += dt.applied; ob += dt.obliged; st += dt.settled
          let me = 0, ma = 0
          for (const mt of totalsByMahalla(rows, m, did).values()) { me += mt.expected; ma += mt.applied }
          expect(me).toBe(dt.expected)
          expect(ma).toBe(dt.applied)
        }
        expect(e).toBe(monthTotal.expected)
        expect(ap).toBe(monthTotal.applied)
        expect(ob).toBe(monthTotal.obliged)
        expect(st).toBe(monthTotal.settled)
      }

      // foizlar: null yoki 0..100 (bir xil toplamdan), NaN/Infinity yoq
      for (const r of [settlementRate(all), collectionRate(all)]) {
        if (r !== null) {
          expect(Number.isFinite(r)).toBe(true)
          expect(r).toBeGreaterThanOrEqual(0)
          expect(r).toBeLessThanOrEqual(100)
        }
      }
      // avans hech qachon manfiy emas
      expect(advanceAmount(randInt(rnd, 0, 1e7), all.applied)).toBeGreaterThanOrEqual(0)
    })
  }
})

describe('payRate 0..cheksiz chegarasi', () => {
  it('tasodifiy 300 holat', () => {
    const rnd = mulberry32(42)
    for (let i = 0; i < 300; i++) {
      const paid = randInt(rnd, -10, 5000)
      const obliged = randInt(rnd, -5, 1000)
      const r = payRate(paid, obliged)
      if (obliged <= 0) expect(r).toBeNull()
      else {
        expect(r).not.toBeNull()
        expect(r!).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(r!)).toBe(true)
      }
    }
  })
  it('NaN maxraj', () => {
    expect(payRate(5, Number.NaN)).toBeNull()
  })
})

describe('pctChange', () => {
  it('olma-olma', () => {
    expect(pctChange(150, 100)).toBe(50)
    expect(pctChange(50, 100)).toBe(-50)
    expect(pctChange(5, 0)).toBeNull()
    expect(pctChange(0, 0)).toBeNull()
  })
})

describe('computePace — oy ortasidagi tempo', () => {
  it('oldinda / ortda', () => {
    const p = computePace(10, 30, 600, 500)
    expect(p).toMatchObject({ diff: 100, deltaPercent: 20, ahead: true, projected: 1800 })
    expect(computePace(10, 30, 400, 500).ahead).toBe(false)
  })
  it('ikkalasi nol: ahead null, otgan oy nol: foiz null, NaN yoq', () => {
    const p = computePace(5, 31, 0, 0)
    expect(p.ahead).toBeNull()
    expect(p.deltaPercent).toBeNull()
    expect(p.projected).toBe(0)
    expect(computePace(0, 30, 100, 0).projected).toBeNull()
    expect(Number.isFinite(computePace(3, 0, 10, 10).diff)).toBe(true)
  })
})

describe('UZT oy chegarasidagi tolov togri oyga tushadi', () => {
  it('1-kun 00:00-05:00 UZT (UTC boyicha hali oldingi oy)', () => {
    // 2026-11-01 00:30 UZT == 2026-10-31 19:30 UTC
    const t = new Date('2026-10-31T19:30:00.000Z')
    expect(monthOfUz(t)).toBe('2026-11')
    expect(t.toISOString().slice(0, 7)).toBe('2026-10') // UTC xato bolardi
    const b = monthBoundsUz('2026-11')!
    expect(t >= b.start && t < b.end).toBe(true)
    // oy oxiri: 2026-10-31 23:59 UZT == 18:59 UTC -> oktyabr
    const u = new Date('2026-10-31T18:59:59.999Z')
    expect(monthOfUz(u)).toBe('2026-10')
    const bo = monthBoundsUz('2026-10')!
    expect(u >= bo.start && u < bo.end).toBe(true)
    expect(dayOfUz(t)).toBe('2026-11-01')
  })

  it('300 tasodifiy lahza: monthOfUz va monthBoundsUz bir-birini tasdiqlaydi', () => {
    const rnd = mulberry32(2026)
    for (let i = 0; i < 300; i++) {
      const ms = Date.UTC(2025, 0, 1) + Math.floor(rnd() * 3 * 365 * 24 * 3600 * 1000)
      const t = new Date(ms)
      const m = monthOfUz(t)!
      const b = monthBoundsUz(m)!
      expect(t >= b.start && t < b.end).toBe(true)
      const d = dayOfUz(t)!
      const db = dayBoundsUz(d)!
      expect(t >= db.start && t < db.end).toBe(true)
      expect(d.startsWith(m)).toBe(true)
    }
  })
})

describe('dateOnlyKey / rollupPaymentGroups / debtAgeRowsFromBuckets', () => {
  it('@db.Date kalendar sana', () => {
    expect(dateOnlyKey(new Date('2026-11-10T00:00:00.000Z'))).toBe('2026-11-10')
    expect(dateOnlyKey('x')).toBe('')
  })
  it('Sum oy == Sum tuman == jami', () => {
    const rnd = mulberry32(5)
    const months = ['2026-01', '2026-02']
    for (let k = 0; k < 100; k++) {
      const rows = Array.from({ length: randInt(rnd, 0, 12) }, () => ({
        month: pick(rnd, months), districtId: `d${randInt(rnd, 1, 3)}`, districtName: 'x',
        count: randInt(rnd, 1, 9), amount: randInt(rnd, 1000, 900000),
      }))
      const r = rollupPaymentGroups(rows, months)
      const byM = [...r.byMonth.values()].reduce((a, b) => a + b, 0)
      const byD = [...r.byDistrict.values()].reduce((a, b) => a + b.collected, 0)
      expect(byM).toBe(r.collected)
      expect(byD).toBe(r.collected)
    }
  })
  it('yosh jadvali: 3 guruh doim bor, summa saqlanadi', () => {
    const rows = debtAgeRowsFromBuckets([
      { months: 1, count: 2, amount: 100 }, { months: 3, count: 1, amount: 50 }, { months: 7, count: 1, amount: 25 },
    ])
    expect(rows.map(r => r.bucket)).toEqual(['month1', 'month2', 'month3plus'])
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(175)
    expect(rows[2].count).toBe(2)
    expect(debtAgeRowsFromBuckets([]).every(r => r.amount === 0 && r.count === 0)).toBe(true)
  })
})
