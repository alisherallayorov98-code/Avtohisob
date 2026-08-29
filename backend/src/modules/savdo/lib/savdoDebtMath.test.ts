import { computeSaleDebts, computeCustomerDebt } from './savdoDebtMath'

describe('computeSaleDebts', () => {
  it('qisman to\'lov → to\'g\'ri ochiq qoldiq', () => {
    const sales = [{ id: 'S1', totalAmount: 100000, status: 'completed' as const }]
    const payments = [{ saleId: 'S1', amount: 40000 }]
    const debts = computeSaleDebts(sales, payments)
    expect(debts).toEqual([{ saleId: 'S1', totalAmount: 100000, paid: 40000, balance: 60000 }])
  })

  it('to\'lov yo\'q bo\'lsa balance = totalAmount', () => {
    const sales = [{ id: 'S1', totalAmount: 50000, status: 'completed' as const }]
    const debts = computeSaleDebts(sales, [])
    expect(debts[0].balance).toBe(50000)
  })

  it('to\'liq to\'langan faktura balance=0 (manfiyga tushmaydi)', () => {
    const sales = [{ id: 'S1', totalAmount: 50000, status: 'completed' as const }]
    const payments = [{ saleId: 'S1', amount: 70000 }] // ortiqcha to'lov
    const debts = computeSaleDebts(sales, payments)
    expect(debts[0].balance).toBe(0)
  })

  it('bekor qilingan (cancelled) sotuv qarz hisobiga kirmaydi', () => {
    const sales = [
      { id: 'S1', totalAmount: 50000, status: 'completed' as const },
      { id: 'S2', totalAmount: 30000, status: 'cancelled' as const },
    ]
    const debts = computeSaleDebts(sales, [])
    expect(debts).toHaveLength(1)
    expect(debts[0].saleId).toBe('S1')
  })

  it('tartibsiz to\'lovlar (bir necha marta) yig\'indi bo\'yicha to\'g\'ri hisoblanadi', () => {
    const sales = [{ id: 'S1', totalAmount: 100000, status: 'completed' as const }]
    const payments = [
      { saleId: 'S1', amount: 20000 },
      { saleId: 'S1', amount: 15000 },
      { saleId: 'S1', amount: 10000 },
    ]
    const debts = computeSaleDebts(sales, payments)
    expect(debts[0].paid).toBe(45000)
    expect(debts[0].balance).toBe(55000)
  })
})

describe('computeCustomerDebt', () => {
  it('bir nechta faktura yig\'indi qarzi', () => {
    const sales = [
      { id: 'S1', totalAmount: 100000, status: 'completed' as const },
      { id: 'S2', totalAmount: 50000, status: 'completed' as const },
    ]
    const payments = [{ saleId: 'S1', amount: 100000 }]
    const result = computeCustomerDebt(sales, payments)
    expect(result.totalDebt).toBe(50000)
  })

  it('ortiqcha (saleId\'siz avans) to\'lov umumiy qarzni kamaytiradi', () => {
    const sales = [{ id: 'S1', totalAmount: 100000, status: 'completed' as const }]
    const payments = [
      { saleId: 'S1', amount: 60000 },
      { saleId: null, amount: 20000 }, // avans
    ]
    const result = computeCustomerDebt(sales, payments)
    // Sof qoldiq 40000, avans 20000 → yakuniy qarz 20000
    expect(result.advanceCredit).toBe(20000)
    expect(result.totalDebt).toBe(20000)
  })

  it('avans qarzdan katta bo\'lsa yakuniy qarz manfiyga tushmaydi, 0 bo\'ladi', () => {
    const sales = [{ id: 'S1', totalAmount: 30000, status: 'completed' as const }]
    const payments = [{ saleId: null, amount: 50000 }]
    const result = computeCustomerDebt(sales, payments)
    expect(result.totalDebt).toBe(0)
  })

  it('sotuv yo\'q bo\'lsa qarz 0', () => {
    const result = computeCustomerDebt([], [])
    expect(result.totalDebt).toBe(0)
    expect(result.saleDebts).toEqual([])
  })
})
