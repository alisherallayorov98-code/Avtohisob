import { resolveEntityDebt } from './entityDebtResolve'

describe('resolveEntityDebt', () => {
  const row = { debt: 150000, advance: 0, months: 2, unpaidMonths: ['2026-03', '2026-04'] }

  it('monthly_fixed: kanonik qatorni qaytaradi', () => {
    expect(resolveEntityDebt('monthly_fixed', row)).toEqual({
      totalDebt: 150000, unpaidMonths: ['2026-03', '2026-04'], debtMonths: 2, advance: 0,
    })
  })
  it('talon: qator yo\'q -> qarz 0', () => {
    expect(resolveEntityDebt('talon', undefined)).toEqual({ totalDebt: 0, unpaidMonths: [], debtMonths: 0, advance: 0 })
  })
  it('avans qatori: qarz 0, avans saqlanadi', () => {
    expect(resolveEntityDebt('monthly_fixed', { debt: 0, advance: 70000, months: 0, unpaidMonths: [] }).advance).toBe(70000)
  })
  it('variable: summa 0, joriy oy to\'lanmagan bo\'lsa belgilanadi', () => {
    expect(resolveEntityDebt('variable', undefined, { currentMonth: '2026-11', paidCurrentMonth: false }))
      .toEqual({ totalDebt: 0, unpaidMonths: ['2026-11'], debtMonths: 1, advance: 0 })
    expect(resolveEntityDebt('variable', row, { currentMonth: '2026-11', paidCurrentMonth: true }).totalDebt).toBe(0)
  })
})
