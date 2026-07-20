import { isYearlyPayment, computePeriodEnd } from './billingMath'

describe('isYearlyPayment', () => {
  // Tarif: oylik 300k, yillik 3mln (yillik chegirma bilan)
  const MONTHLY = 300_000
  const YEARLY = 3_000_000

  it('invoys summasi yillik narxga teng → yillik', () => {
    expect(isYearlyPayment(YEARLY, YEARLY, MONTHLY)).toBe(true)
  })

  it('invoys summasi oylik narxga teng → yillik EMAS', () => {
    expect(isYearlyPayment(MONTHLY, YEARLY, MONTHLY)).toBe(false)
  })

  it('yillik va oylik narx bir xil bo\'lsa (chegirma yo\'q) → hech qachon yillik emas', () => {
    // Aks holda oylik to'lovchi ham 12 oy olib qolardi
    expect(isYearlyPayment(300_000, 300_000, 300_000)).toBe(false)
  })

  it('summa 0/null/undefined → yillik emas', () => {
    expect(isYearlyPayment(0, YEARLY, MONTHLY)).toBe(false)
    expect(isYearlyPayment(null, YEARLY, MONTHLY)).toBe(false)
    expect(isYearlyPayment(undefined, YEARLY, MONTHLY)).toBe(false)
  })

  it('Prisma Decimal (string) qiymatlar ham to\'g\'ri solishtiriladi', () => {
    expect(isYearlyPayment('3000000' as any, '3000000' as any, '300000' as any)).toBe(true)
  })

  it('summa yillikka teng emas (qisman to\'lov) → yillik emas', () => {
    expect(isYearlyPayment(1_500_000, YEARLY, MONTHLY)).toBe(false)
  })
})

describe('computePeriodEnd', () => {
  it('oylik → +1 oy', () => {
    const start = new Date('2026-07-20T00:00:00Z')
    const end = computePeriodEnd(start, false)
    expect(end.getMonth()).toBe(new Date('2026-08-20T00:00:00Z').getMonth())
  })

  it('yillik → +12 oy (kelasi yil shu oy)', () => {
    const start = new Date('2026-07-20T00:00:00Z')
    const end = computePeriodEnd(start, true)
    expect(end.getFullYear()).toBe(2027)
    expect(end.getMonth()).toBe(start.getMonth())
  })

  it('boshlanish sanasini o\'zgartirmaydi (yangi Date qaytaradi)', () => {
    const start = new Date('2026-07-20T00:00:00Z')
    const startMs = start.getTime()
    computePeriodEnd(start, true)
    expect(start.getTime()).toBe(startMs) // mutatsiya yo'q
  })
})
