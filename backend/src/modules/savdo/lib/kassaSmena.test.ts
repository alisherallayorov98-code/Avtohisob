import { computeExpectedBalance, computeDiscrepancy } from './kassaSmena'

describe('computeExpectedBalance', () => {
  it('ochilish balansi + sotuvlar yig\'indisi', () => {
    expect(computeExpectedBalance(50000, [10000, 25000, 5000])).toBe(90000)
  })

  it('sotuv bo\'lmasa faqat ochilish balansi qaytadi', () => {
    expect(computeExpectedBalance(50000, [])).toBe(50000)
  })
})

describe('computeDiscrepancy', () => {
  it('haqiqiy > kutilgan → musbat (ortiqcha)', () => {
    expect(computeDiscrepancy(95000, 90000)).toBe(5000)
  })

  it('haqiqiy < kutilgan → manfiy (kamomad)', () => {
    expect(computeDiscrepancy(85000, 90000)).toBe(-5000)
  })

  it('mos kelsa 0', () => {
    expect(computeDiscrepancy(90000, 90000)).toBe(0)
  })
})
