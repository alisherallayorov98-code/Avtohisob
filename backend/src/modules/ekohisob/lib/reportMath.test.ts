import {
  payRate, deltaPercent, debtAgeBucket, groupDebtByAge,
} from './reportMath'

describe('payRate — to\'lov foizi', () => {
  it('oddiy hisob', () => {
    expect(payRate(50, 100)).toBe(50)
    expect(payRate(100, 100)).toBe(100)
  })

  it('majburiyati bo\'lgan tashkilot yo\'q → null (0% EMAS)', () => {
    // 0% "hech kim to'lamadi" degan yolg'on xabar beradi; aslida
    // shu oyda to'laydigan odam yo'q edi.
    expect(payRate(0, 0)).toBeNull()
    expect(payRate(5, 0)).toBeNull()
  })

  it('100% dan oshmaydi va manfiy bo\'lmaydi (ma\'lumot nomuvofiqligida)', () => {
    expect(payRate(150, 100)).toBe(100)
    expect(payRate(-5, 100)).toBe(0)
  })

  it('yaxlitlanadi', () => {
    expect(payRate(1, 3)).toBe(33)
    expect(payRate(2, 3)).toBe(67)
  })
})

describe('deltaPercent — o\'tgan davrga nisbatan', () => {
  it('o\'sish va pasayish', () => {
    expect(deltaPercent(120, 100)).toBe(20)
    expect(deltaPercent(80, 100)).toBe(-20)
    expect(deltaPercent(100, 100)).toBe(0)
  })

  it('oldingi davr 0 bo\'lsa null ("cheksiz o\'sish" ko\'rsatilmaydi)', () => {
    expect(deltaPercent(500, 0)).toBeNull()
    expect(deltaPercent(0, 0)).toBeNull()
  })
})

describe('debtAgeBucket', () => {
  it('oylar soniga qarab guruh', () => {
    expect(debtAgeBucket(1)).toBe('month1')
    expect(debtAgeBucket(2)).toBe('month2')
    expect(debtAgeBucket(3)).toBe('month3plus')
    expect(debtAgeBucket(12)).toBe('month3plus')
  })

  it('qarzdor emas → null', () => {
    expect(debtAgeBucket(0)).toBeNull()
    expect(debtAgeBucket(-1)).toBeNull()
  })
})

describe('groupDebtByAge — qarz yoshi taqsimoti', () => {
  it('soni va summasi guruhlar bo\'yicha yig\'iladi', () => {
    const rows = groupDebtByAge([
      { debtMonths: 1, debtAmount: 100000 },
      { debtMonths: 1, debtAmount: 200000 },
      { debtMonths: 2, debtAmount: 500000 },
      { debtMonths: 5, debtAmount: 3000000 },
    ])
    expect(rows).toEqual([
      { bucket: 'month1', label: '1 oy', count: 2, amount: 300000 },
      { bucket: 'month2', label: '2 oy', count: 1, amount: 500000 },
      { bucket: 'month3plus', label: '3+ oy', count: 1, amount: 3000000 },
    ])
  })

  it('qarzsiz va nol summali yozuvlar hisobga olinmaydi', () => {
    const rows = groupDebtByAge([
      { debtMonths: 0, debtAmount: 500000 },
      { debtMonths: 3, debtAmount: 0 },
    ])
    expect(rows.every(r => r.count === 0 && r.amount === 0)).toBe(true)
  })

  it('bo\'sh ro\'yxatda ham uchala guruh qaytadi (grafik buzilmasin)', () => {
    expect(groupDebtByAge([])).toHaveLength(3)
  })
})
