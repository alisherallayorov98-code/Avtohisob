import { buildPaymentTypeReport } from './paymentTypeReport'

const NOW = new Date('2026-11-12T12:00:00Z')
const day = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000)
const sale = (o: any) => ({
  id: 'x', documentNumber: 'S', createdAt: day(1), customerId: 'c', customerName: 'C',
  totalAmount: 1000, vatAmount: 0, totalCost: 600, paymentType: 'credit', dueDate: null, ...o,
})

describe('buildPaymentTypeReport', () => {
  it('naqd mijozsiz sotuv to\'langan hisoblanadi', () => {
    const r = buildPaymentTypeReport([sale({ id: 'a', paymentType: 'cash', customerId: null })], [], NOW)
    expect(r.summary.cash.paid).toBe(1000)
    expect(r.summary.cash.outstanding).toBe(0)
  })

  it('turlar alohida hisoblanadi', () => {
    const r = buildPaymentTypeReport([
      sale({ id: 'a', paymentType: 'cash', customerId: null }),
      sale({ id: 'b', paymentType: 'transfer', totalAmount: 2000 }),
      sale({ id: 'c', paymentType: 'credit', totalAmount: 500 }),
    ], [{ saleId: 'b', amount: 500 }], NOW)
    expect(r.summary.cash.total).toBe(1000)
    expect(r.summary.transfer.total).toBe(2000)
    expect(r.summary.transfer.paid).toBe(500)
    expect(r.summary.transfer.outstanding).toBe(1500)
    expect(r.summary.credit.outstanding).toBe(500)
  })

  it('QQS daromaddan ayriladi: foyda = jami − QQS − tannarx', () => {
    const r = buildPaymentTypeReport([sale({ id: 'a', totalAmount: 1120, vatAmount: 120, totalCost: 600 })], [], NOW)
    expect(r.summary.credit.net).toBe(1000)
    expect(r.summary.credit.grossProfit).toBe(400)
  })

  it('muddati o\'tgan qarz yoshi bo\'yicha guruhlanadi', () => {
    const r = buildPaymentTypeReport([
      sale({ id: 'a', dueDate: day(-5), totalAmount: 100 }),   // 5 kundan keyin
      sale({ id: 'b', dueDate: day(10), totalAmount: 200 }),   // 10 kun o'tgan
      sale({ id: 'c', dueDate: day(45), totalAmount: 300 }),
      sale({ id: 'd', dueDate: day(90), totalAmount: 400 }),
    ], [], NOW)
    const [nd, a, b, c] = r.aging.credit
    expect([nd.amount, a.amount, b.amount, c.amount]).toEqual([100, 200, 300, 400])
    expect(r.summary.credit.overdue).toBe(900)
  })

  it('ortiqcha to\'langan faktura qarz hisoblanmaydi', () => {
    const r = buildPaymentTypeReport([sale({ id: 'a', totalAmount: 60 })], [{ saleId: 'a', amount: 100 }], NOW)
    expect(r.rowsByType.credit[0].overpaid).toBe(40)
    expect(r.summary.credit.outstanding).toBe(0)
    expect(r.summary.credit.paid).toBe(60)
  })
})
