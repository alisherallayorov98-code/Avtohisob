import { computeChargeStatus, computeDebtLevel } from './chargeMath'

describe('computeChargeStatus — EkoHisob to\'lov holati', () => {
  it('to\'liq to\'langan (paid == expected) → paid', () => {
    expect(computeChargeStatus(100000, 100000)).toBe('paid')
  })

  it('ortiqcha to\'langan (paid > expected) → paid', () => {
    expect(computeChargeStatus(100000, 120000)).toBe('paid')
  })

  it('qisman to\'langan (0 < paid < expected) → partial', () => {
    expect(computeChargeStatus(100000, 40000)).toBe('partial')
  })

  it('monthly_fixed, to\'lov yo\'q → unpaid', () => {
    expect(computeChargeStatus(100000, 0, 'monthly_fixed')).toBe('unpaid')
  })

  it('variable, to\'lov yo\'q → none (kutilmaydi)', () => {
    expect(computeChargeStatus(null, 0, 'variable')).toBe('none')
  })

  it('variable tashkilotda charge bor, lekin to\'lov yo\'q → none (asl xatti-harakat saqlanadi)', () => {
    // Muhim edge: expected bor bo'lsa ham, monthly_fixed bo'lmasa 'none'
    expect(computeChargeStatus(100000, 0, 'variable')).toBe('none')
  })

  it('kutilgan summa null, lekin to\'lov bor → paid (variable to\'lov)', () => {
    expect(computeChargeStatus(null, 50000)).toBe('paid')
  })

  it('billingMode berilmagan, to\'lov yo\'q → none', () => {
    expect(computeChargeStatus(100000, 0)).toBe('none')
  })

  it('Prisma Decimal (string) qiymatlar to\'g\'ri solishtiriladi', () => {
    expect(computeChargeStatus('100000' as any, '40000' as any)).toBe('partial')
    expect(computeChargeStatus('100000' as any, '100000' as any)).toBe('paid')
  })
})

describe('computeDebtLevel — ochiq hisoblar soniga qarab qarz darajasi', () => {
  it('0 ochiq hisob → current (qarzsiz)', () => {
    expect(computeDebtLevel(0)).toBe('current')
  })

  it('1 ochiq hisob → warning', () => {
    expect(computeDebtLevel(1)).toBe('warning')
  })

  it('2 ochiq hisob → overdue', () => {
    expect(computeDebtLevel(2)).toBe('overdue')
  })

  it('3 va undan ko\'p → critical', () => {
    expect(computeDebtLevel(3)).toBe('critical')
    expect(computeDebtLevel(10)).toBe('critical')
  })

  it('manfiy (bo\'lmasligi kerak) → current (himoya)', () => {
    expect(computeDebtLevel(-1)).toBe('current')
  })
})
