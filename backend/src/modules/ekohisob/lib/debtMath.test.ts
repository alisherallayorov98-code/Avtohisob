import {
  sumPaymentsByMonth,
  talonMonth,
  groupTalonsByMonth,
  computeEntityDebt,
  chargeRowStatus,
  applyPaymentReversal,
  buildLedger,
} from './debtMath'

describe('sumPaymentsByMonth — qisman to\'lovlar yig\'indisi', () => {
  it('bir oydagi bir necha to\'lovni QO\'SHADI (oxirgisini olmaydi)', () => {
    // Asosiy xato shu edi: Map(p => [p.month, p]) oxirgi to'lovni qoldirardi.
    const m = sumPaymentsByMonth([
      { month: '2026-07', amount: 40000 },
      { month: '2026-07', amount: 60000 },
    ])
    expect(m.get('2026-07')!.paid).toBe(100000)
    expect(m.get('2026-07')!.count).toBe(2)
  })

  it('turli oylar aralashganda har biri alohida yig\'iladi', () => {
    const m = sumPaymentsByMonth([
      { month: '2026-06', amount: 50000 },
      { month: '2026-07', amount: 30000 },
      { month: '2026-06', amount: 25000 },
    ])
    expect(m.get('2026-06')!.paid).toBe(75000)
    expect(m.get('2026-07')!.paid).toBe(30000)
  })

  it('lastPaidAt — eng oxirgi sana (tartibi aralash bo\'lsa ham)', () => {
    const m = sumPaymentsByMonth([
      { month: '2026-07', amount: 10, paidAt: new Date('2026-07-20T10:00:00Z') },
      { month: '2026-07', amount: 10, paidAt: new Date('2026-07-05T10:00:00Z') },
    ])
    expect(m.get('2026-07')!.lastPaidAt!.toISOString()).toBe('2026-07-20T10:00:00.000Z')
  })

  it('bo\'sh ro\'yxat → bo\'sh map', () => {
    expect(sumPaymentsByMonth([]).size).toBe(0)
  })
})

describe('talonMonth / groupTalonsByMonth — talonni oyga guruhlash', () => {
  it('sana → "YYYY-MM" (UTC)', () => {
    expect(talonMonth(new Date('2026-07-26T00:00:00Z'))).toBe('2026-07')
    expect(talonMonth('2026-01-01')).toBe('2026-01')
  })

  it('noto\'g\'ri sana → bo\'sh satr (guruhlashda o\'tkazib yuboriladi)', () => {
    expect(talonMonth('salom')).toBe('')
    expect(groupTalonsByMonth([{ date: 'salom', amount: 100, paid: false }]).size).toBe(0)
  })

  it('to\'langan va to\'lanmagan talonlar ajratiladi', () => {
    const g = groupTalonsByMonth([
      { date: '2026-07-01', amount: 300000, paid: false },
      { date: '2026-07-15', amount: 200000, paid: true },
      { date: '2026-06-10', amount: 150000, paid: false },
    ])
    expect(g.get('2026-07')).toMatchObject({ expected: 500000, unpaid: 300000, paid: 200000, count: 2 })
    expect(g.get('2026-06')).toMatchObject({ expected: 150000, unpaid: 150000, count: 1 })
  })
})

describe('computeEntityDebt — uchala to\'lov rejimi', () => {
  it('monthly_fixed: kutilgan − to\'langan, faqat qarz qolgan oylar', () => {
    const d = computeEntityDebt({
      billingMode: 'monthly_fixed',
      charges: [
        { month: '2026-05', expectedAmount: 100000, paidAmount: 100000 }, // to'liq
        { month: '2026-06', expectedAmount: 100000, paidAmount: 40000 },  // qisman
        { month: '2026-07', expectedAmount: 100000, paidAmount: 0 },      // to'lanmagan
      ],
    })
    expect(d.totalDebt).toBe(160000)
    expect(d.unpaidMonths).toEqual(['2026-06', '2026-07'])
    expect(d.debtMonths).toBe(2)
  })

  it('monthly_fixed: ortiqcha to\'lov qarzni manfiy qilmaydi', () => {
    const d = computeEntityDebt({
      billingMode: 'monthly_fixed',
      charges: [{ month: '2026-07', expectedAmount: 100000, paidAmount: 150000 }],
    })
    expect(d.totalDebt).toBe(0)
    expect(d.unpaidMonths).toEqual([])
  })

  it('talon: to\'lanmagan talonlar oy bo\'yicha qarz beradi', () => {
    const d = computeEntityDebt({
      billingMode: 'talon',
      talons: [
        { date: '2026-06-05', amount: 250000, paid: false },
        { date: '2026-06-20', amount: 150000, paid: true },
        { date: '2026-07-03', amount: 400000, paid: false },
      ],
    })
    expect(d.totalDebt).toBe(650000)
    expect(d.unpaidMonths).toEqual(['2026-06', '2026-07'])
    expect(d.debtMonths).toBe(2)
  })

  it('talon: hammasi to\'langan → qarz yo\'q', () => {
    const d = computeEntityDebt({
      billingMode: 'talon',
      talons: [{ date: '2026-07-03', amount: 400000, paid: true }],
    })
    expect(d).toEqual({ totalDebt: 0, unpaidMonths: [], debtMonths: 0 })
  })

  it('talon: talon umuman yo\'q → qarz yo\'q (ilgari 1 oy qarzdor ko\'rinardi)', () => {
    expect(computeEntityDebt({ billingMode: 'talon', talons: [] }).debtMonths).toBe(0)
  })

  it('variable: qarz to\'planmaydi, faqat joriy oy holati', () => {
    const unpaid = computeEntityDebt({
      billingMode: 'variable', paidCurrentMonth: false, currentMonth: '2026-07',
    })
    expect(unpaid).toEqual({ totalDebt: 0, unpaidMonths: ['2026-07'], debtMonths: 1 })

    const paid = computeEntityDebt({
      billingMode: 'variable', paidCurrentMonth: true, currentMonth: '2026-07',
    })
    expect(paid).toEqual({ totalDebt: 0, unpaidMonths: [], debtMonths: 0 })
  })
})

describe('chargeRowStatus — DB charge.status lug\'ati', () => {
  it('to\'lov yo\'q → open (so\'rov filtri shu qiymatni kutadi, "none" emas)', () => {
    expect(chargeRowStatus(100000, 0)).toBe('open')
  })
  it('qisman → partial, to\'liq/ortiqcha → paid', () => {
    expect(chargeRowStatus(100000, 99999)).toBe('partial')
    expect(chargeRowStatus(100000, 100000)).toBe('paid')
    expect(chargeRowStatus(100000, 120000)).toBe('paid')
  })
})

describe('applyPaymentReversal — to\'lov o\'chirilganda charge qaytariladi', () => {
  it('qisman to\'lov o\'chirilsa paidAmount kamayadi va holat qaytadi', () => {
    expect(applyPaymentReversal({ expectedAmount: 100000, paidAmount: 100000 }, 60000))
      .toEqual({ paidAmount: 40000, status: 'partial' })
  })

  it('yagona to\'lov o\'chirilsa charge yana ochiladi', () => {
    expect(applyPaymentReversal({ expectedAmount: 100000, paidAmount: 100000 }, 100000))
      .toEqual({ paidAmount: 0, status: 'open' })
  })

  it('paidAmount hech qachon manfiy bo\'lmaydi (ma\'lumot nomuvofiqligida ham)', () => {
    expect(applyPaymentReversal({ expectedAmount: 100000, paidAmount: 30000 }, 50000))
      .toEqual({ paidAmount: 0, status: 'open' })
  })
})

describe('buildLedger — oylar tasmasi', () => {
  it('bir oydagi ikki qisman to\'lov bitta qatorda yig\'iladi', () => {
    const rows = buildLedger({
      months: ['2026-07'],
      billingMode: 'monthly_fixed',
      monthlyFee: 100000,
      payments: [
        { month: '2026-07', amount: 40000 },
        { month: '2026-07', amount: 60000 },
      ],
      charges: [{ month: '2026-07', expectedAmount: 100000, paidAmount: 100000 }],
    })
    expect(rows[0]).toMatchObject({ paid: 100000, expected: 100000, status: 'paid', paymentCount: 2 })
  })

  it('charge yo\'q oyda monthlyFee kutilgan summa bo\'ladi', () => {
    const rows = buildLedger({
      months: ['2026-07'], billingMode: 'monthly_fixed', monthlyFee: 80000,
      payments: [], charges: [],
    })
    expect(rows[0]).toMatchObject({ expected: 80000, paid: 0, status: 'unpaid' })
  })

  it('talon rejimi: kutilgan summa shu oydagi talonlar yig\'indisi', () => {
    const rows = buildLedger({
      months: ['2026-06', '2026-07'],
      billingMode: 'talon',
      payments: [{ month: '2026-06', amount: 250000 }],
      talons: [
        { date: '2026-06-05', amount: 250000, paid: true },
        { date: '2026-07-03', amount: 400000, paid: false },
      ],
    })
    expect(rows[0]).toMatchObject({ month: '2026-06', expected: 250000, paid: 250000, status: 'paid' })
    expect(rows[1]).toMatchObject({ month: '2026-07', expected: 400000, paid: 0, status: 'unpaid' })
  })

  it('variable rejimi: kutilgan summa yo\'q, to\'lov bo\'lsa paid', () => {
    const rows = buildLedger({
      months: ['2026-07'], billingMode: 'variable',
      payments: [{ month: '2026-07', amount: 55000 }],
    })
    expect(rows[0]).toMatchObject({ expected: null, paid: 55000, status: 'paid' })
  })

  it('talon yo\'q oy → kutilgan null, holat none', () => {
    const rows = buildLedger({ months: ['2026-07'], billingMode: 'talon', payments: [], talons: [] })
    expect(rows[0]).toMatchObject({ expected: null, paid: 0, status: 'none' })
  })
})
