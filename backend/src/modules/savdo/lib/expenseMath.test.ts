import {
  EXPENSE_CATEGORIES,
  isValidCategory,
  sumExpenses,
  groupExpensesByCategory,
  computeNetProfit,
} from './expenseMath'

describe('isValidCategory', () => {
  it('ro\'yxatdagi kategoriyalar to\'g\'ri deb topiladi', () => {
    for (const c of EXPENSE_CATEGORIES) expect(isValidCategory(c)).toBe(true)
  })

  it('noto\'g\'ri yoki son/bo\'sh qiymat rad etiladi', () => {
    expect(isValidCategory('mashina')).toBe(false)
    expect(isValidCategory('')).toBe(false)
    expect(isValidCategory(null)).toBe(false)
    expect(isValidCategory(42)).toBe(false)
    expect(isValidCategory(undefined)).toBe(false)
  })
})

describe('sumExpenses', () => {
  it('bo\'sh ro\'yxat 0 qaytaradi', () => {
    expect(sumExpenses([])).toBe(0)
  })

  it('oddiy yig\'indi', () => {
    expect(sumExpenses([{ amount: 100000 }, { amount: 250000 }])).toBe(350000)
  })

  it('bekor qilingan yozuv hisobga olinmaydi', () => {
    const rows = [
      { amount: 100000 },
      { amount: 500000, cancelled: true },
      { amount: 50000, cancelled: false },
    ]
    expect(sumExpenses(rows)).toBe(150000)
  })

  it('kasr summalar 2 xonagacha yaxlitlanadi', () => {
    expect(sumExpenses([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
    expect(sumExpenses([{ amount: 1.005 }, { amount: 2.005 }])).toBe(3.01)
  })
})

describe('groupExpensesByCategory', () => {
  it('bo\'sh ro\'yxat bo\'sh massiv qaytaradi (nolga bo\'lish yo\'q)', () => {
    expect(groupExpensesByCategory([])).toEqual([])
  })

  it('hammasi bekor qilingan bo\'lsa bo\'sh massiv (0 ga bo\'linmaydi)', () => {
    const rows = [
      { category: 'ijara', amount: 100, cancelled: true },
      { category: 'soliq', amount: 200, cancelled: true },
    ]
    expect(groupExpensesByCategory(rows)).toEqual([])
  })

  it('nol summali xarajatlarda ulush 0 bo\'ladi', () => {
    const res = groupExpensesByCategory([
      { category: 'ijara', amount: 0 },
      { category: 'soliq', amount: 0 },
    ])
    expect(res).toHaveLength(2)
    expect(res.every(r => r.share === 0)).toBe(true)
  })

  it('ulushlar yig\'indisi ~100 foiz', () => {
    const res = groupExpensesByCategory([
      { category: 'ijara', amount: 3000000 },
      { category: 'ish_haqi', amount: 5000000 },
      { category: 'transport', amount: 2000000 },
    ])
    const sumShare = res.reduce((a, r) => a + r.share, 0)
    expect(sumShare).toBeCloseTo(100, 1)
    expect(res.find(r => r.category === 'ijara')!.share).toBe(30)
  })

  it('natija summa bo\'yicha kamayish tartibida va yorliqlar o\'zbekcha', () => {
    const res = groupExpensesByCategory([
      { category: 'transport', amount: 100 },
      { category: 'ish_haqi', amount: 900 },
      { category: 'ijara', amount: 500 },
    ])
    expect(res.map(r => r.category)).toEqual(['ish_haqi', 'ijara', 'transport'])
    expect(res[0].label).toBe('Ish haqi')
  })

  it('noto\'g\'ri kategoriya "boshqa"ga qo\'shiladi va bir xil kategoriya jamlanadi', () => {
    const res = groupExpensesByCategory([
      { category: 'nomalum', amount: 100 },
      { category: 'boshqa', amount: 50 },
      { category: 'ijara', amount: 1000 },
    ])
    expect(res).toHaveLength(2)
    expect(res.find(r => r.category === 'boshqa')!.total).toBe(150)
  })

  it('bekor qilingan yozuv guruhga kirmaydi', () => {
    const res = groupExpensesByCategory([
      { category: 'ijara', amount: 1000 },
      { category: 'ijara', amount: 500, cancelled: true },
    ])
    expect(res).toHaveLength(1)
    expect(res[0].total).toBe(1000)
    expect(res[0].share).toBe(100)
  })
})

describe('computeNetProfit', () => {
  it('yalpi foydadan xarajat ayiriladi', () => {
    expect(computeNetProfit(10000000, 3500000)).toBe(6500000)
  })

  it('xarajat foydadan katta bo\'lsa sof foyda salbiy (zarar)', () => {
    expect(computeNetProfit(1000000, 2500000)).toBe(-1500000)
  })

  it('kasrlar 2 xonagacha yaxlitlanadi', () => {
    expect(computeNetProfit(0.3, 0.1)).toBe(0.2)
  })

  it('xarajat yo\'q bo\'lsa sof foyda yalpi foydaga teng', () => {
    expect(computeNetProfit(750000, 0)).toBe(750000)
  })
})
