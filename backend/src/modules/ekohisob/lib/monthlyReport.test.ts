import { buildMonthlyReport, monthOf, MonthAgg } from './monthlyReport'

describe('buildMonthlyReport', () => {
  const months = ['2026-01', '2026-02', '2026-03']

  it('kutilgan = hisob + talon, qarz = yopilmagan qism', () => {
    const agg = new Map<string, MonthAgg>([
      ['2026-01', {
        chargeExpected: 1_000_000, chargePaid: 1_000_000,
        talonExpected: 200_000, talonUnpaid: 0,
        collected: 1_200_000, payments: 12, payers: 10,
      }],
      ['2026-02', {
        chargeExpected: 1_000_000, chargePaid: 400_000,
        talonExpected: 0, talonUnpaid: 0,
        collected: 400_000, payments: 4, payers: 4,
      }],
    ])
    const r = buildMonthlyReport(months, agg)

    expect(r.rows[0]).toMatchObject({
      month: '2026-01', expected: 1_200_000, collected: 1_200_000, debt: 0, collectRate: 100,
    })
    expect(r.rows[1]).toMatchObject({
      month: '2026-02', expected: 1_000_000, collected: 400_000, debt: 600_000, collectRate: 40,
    })
  })

  it('ma\'lumotsiz oy nol qatori bo\'lib qoladi (jadvaldan tushib qolmaydi)', () => {
    const r = buildMonthlyReport(months, new Map())
    expect(r.rows).toHaveLength(3)
    expect(r.rows[2]).toMatchObject({
      month: '2026-03', expected: 0, collected: 0, debt: 0, collectRate: null, payers: 0,
    })
    expect(r.totals.collectRate).toBeNull()
  })

  it('talon qarzi kutilganga ham, qarzga ham kiradi', () => {
    const agg = new Map<string, MonthAgg>([
      ['2026-03', { talonExpected: 500_000, talonUnpaid: 300_000, collected: 200_000 }],
    ])
    const r = buildMonthlyReport(['2026-03'], agg)
    expect(r.rows[0]).toMatchObject({
      expected: 500_000, expectedTalon: 500_000, debt: 300_000, collectRate: 40,
    })
  })

  it('eski qarz undirilganda foiz 100 dan oshadi — kesilmaydi', () => {
    const agg = new Map<string, MonthAgg>([
      ['2026-01', { chargeExpected: 100_000, chargePaid: 100_000, collected: 150_000 }],
    ])
    const r = buildMonthlyReport(['2026-01'], agg)
    expect(r.rows[0].collectRate).toBe(150)
    expect(r.rows[0].debt).toBe(0)
  })

  it('ortiqcha to\'langan hisob qarzni MANFIY qilmaydi', () => {
    const agg = new Map<string, MonthAgg>([
      ['2026-01', { chargeExpected: 100_000, chargePaid: 250_000 }],
    ])
    expect(buildMonthlyReport(['2026-01'], agg).rows[0].debt).toBe(0)
  })

  it('jami qatori — yig\'indi va vaznli foiz', () => {
    const agg = new Map<string, MonthAgg>([
      ['2026-01', { chargeExpected: 1_000_000, chargePaid: 1_000_000, collected: 1_000_000, payments: 5 }],
      ['2026-02', { chargeExpected: 1_000_000, chargePaid: 0, collected: 0, payments: 0 }],
    ])
    const r = buildMonthlyReport(['2026-01', '2026-02'], agg)
    expect(r.totals).toMatchObject({
      expected: 2_000_000, collected: 1_000_000, debt: 1_000_000, payments: 5, collectRate: 50,
    })
  })
})

describe('monthOf', () => {
  it('sanadan oyni UTC bo\'yicha oladi', () => {
    expect(monthOf(new Date('2026-03-01T00:00:00.000Z'))).toBe('2026-03')
    expect(monthOf('2026-12-31')).toBe('2026-12')
  })
  it('yaroqsiz sana — bo\'sh satr', () => {
    expect(monthOf('salom')).toBe('')
  })
})

describe('buildMonthlyReport — majburiyat modeli (yopilgan + qoldiq == kutilgan)', () => {
  const months = ['2026-09', '2026-10', '2026-11']

  it('collectRate = yopilgan/kutilgan, avans alohida (100% dan oshmaydi)', () => {
    const agg = new Map<string, MonthAgg>([
      ['2026-10', {
        chargeExpected: 1_000_000, talonExpected: 0, applied: 1_000_000, remaining: 0,
        collected: 1_300_000, collectedCash: 900_000, obliged: 10, settled: 10, payments: 12,
      }],
    ])
    const r = buildMonthlyReport(months, agg)
    expect(r.rows[1]).toMatchObject({
      expected: 1_000_000, applied: 1_000_000, advance: 300_000, debt: 0,
      collectRate: 100, settleRate: 100, collectedCash: 900_000,
    })
    for (const row of r.rows) expect(row.applied + row.debt).toBe(row.expected)
    expect(r.totals.advance).toBe(300_000)
  })

  it('tasodifiy 300 stsenariy: yopilgan + qoldiq == kutilgan, NaN yoq', () => {
    let s = 12345
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
    for (let i = 0; i < 300; i++) {
      const cE = Math.floor(rnd() * 5_000_000), tE = Math.floor(rnd() * 2_000_000)
      const exp = cE + tE
      const applied = Math.floor(rnd() * (exp + 1))
      const agg = new Map<string, MonthAgg>([['2026-11', {
        chargeExpected: cE, talonExpected: tE, applied, remaining: exp - applied,
        collected: Math.floor(rnd() * 6_000_000), obliged: 5, settled: 2,
      }]])
      const r = buildMonthlyReport(['2026-11'], agg)
      const row = r.rows[0]
      expect(row.applied + row.debt).toBe(row.expected)
      expect(row.advance).toBeGreaterThanOrEqual(0)
      if (row.collectRate !== null) {
        expect(Number.isFinite(row.collectRate)).toBe(true)
        expect(row.collectRate).toBeLessThanOrEqual(100)
      }
      expect(r.totals.expected).toBe(row.expected)
    }
  })
})
