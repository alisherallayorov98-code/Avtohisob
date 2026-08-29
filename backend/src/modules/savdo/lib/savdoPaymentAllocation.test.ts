import { allocatePaymentToSales } from './savdoPaymentAllocation'

describe('allocatePaymentToSales', () => {
  it('to\'lov tanlangan faktura qarzidan kichik bo\'lsa faqat o\'shanga yoziladi', () => {
    const result = allocatePaymentToSales(30000, [{ saleId: 'S1', balance: 50000 }], 'S1')
    expect(result.allocations).toEqual([{ saleId: 'S1', amount: 30000 }])
    expect(result.advance).toBe(0)
    expect(result.appliedToOlder).toBe(0)
  })

  it('tanlangan fakturadan katta to\'lov keyingi eng eski ochiq fakturaga o\'tadi', () => {
    const openSales = [
      { saleId: 'S1', balance: 20000 }, // eng eski
      { saleId: 'S2', balance: 50000 }, // tanlangan
      { saleId: 'S3', balance: 10000 },
    ]
    const result = allocatePaymentToSales(65000, openSales, 'S2')
    // 1) S2 to'liq yopiladi (50000), qoladi 15000
    // 2) S1 eng eski (ro'yxatda birinchi) — 15000 yetadi, to'liq yopilmaydi (20000 kerak edi)
    expect(result.allocations).toEqual([
      { saleId: 'S2', amount: 50000 },
      { saleId: 'S1', amount: 15000 },
    ])
    expect(result.appliedToOlder).toBe(15000)
    expect(result.advance).toBe(0)
  })

  it('barcha ochiq faktura yopilgandan keyin qolgan summa avans bo\'ladi', () => {
    const openSales = [{ saleId: 'S1', balance: 20000 }]
    const result = allocatePaymentToSales(50000, openSales, 'S1')
    expect(result.allocations).toEqual([{ saleId: 'S1', amount: 20000 }])
    expect(result.advance).toBe(30000)
  })

  it('tanlangan faktura berilmasa (umumiy to\'lov) eng eski ochiqdan boshlab yopiladi', () => {
    const openSales = [
      { saleId: 'S1', balance: 10000 },
      { saleId: 'S2', balance: 15000 },
    ]
    const result = allocatePaymentToSales(20000, openSales)
    expect(result.allocations).toEqual([
      { saleId: 'S1', amount: 10000 },
      { saleId: 'S2', amount: 10000 },
    ])
  })

  it('ochiq faktura yo\'q bo\'lsa hammasi avans', () => {
    const result = allocatePaymentToSales(15000, [])
    expect(result.allocations).toEqual([])
    expect(result.advance).toBe(15000)
  })

  it('summa 0 yoki manfiy bo\'lsa hech narsa taqsimlanmaydi', () => {
    const openSales = [{ saleId: 'S1', balance: 10000 }]
    expect(allocatePaymentToSales(0, openSales, 'S1')).toEqual({ allocations: [], advance: 0, appliedToOlder: 0 })
    expect(allocatePaymentToSales(-100, openSales, 'S1')).toEqual({ allocations: [], advance: 0, appliedToOlder: 0 })
  })

  it('balance=0 bo\'lgan fakturalar o\'tkazib yuboriladi', () => {
    const openSales = [
      { saleId: 'S1', balance: 0 },
      { saleId: 'S2', balance: 10000 },
    ]
    const result = allocatePaymentToSales(10000, openSales)
    expect(result.allocations).toEqual([{ saleId: 'S2', amount: 10000 }])
  })
})
