// Savdo — to'lov turi bo'yicha hisobot (naqd / perechisleniya / qarz) — pure funksiya.
// Har faktura: summa, to'langan, qoldiq, muddati o'tgan kunlar. Naqd + mijozsiz sotuvda
// to'lov yozuvi bo'lmaydi (pul kassaga tushgan) — to'langan deb hisoblanadi.

const r2 = (n: number): number => Math.round(n * 100) / 100
const DAY = 24 * 3600 * 1000

export type PayType = 'cash' | 'transfer' | 'credit'

export interface ReportSale {
  id: string
  documentNumber: string
  createdAt: Date
  customerId: string | null
  customerName: string | null
  totalAmount: number
  vatAmount: number
  totalCost: number
  paymentType: string
  dueDate: Date | null
}
export interface ReportPayment { saleId: string | null; amount: number }

export interface ReportRow extends ReportSale {
  paid: number
  balance: number
  overpaid: number
  status: 'paid' | 'partial' | 'unpaid'
  /** Muddatdan (yoki muddat yo'q bo'lsa sotuv sanasidan) o'tgan kunlar; 0 — hali o'tmagan */
  daysPast: number
}

export interface ReportTotals {
  count: number
  total: number
  vat: number
  net: number
  cost: number
  grossProfit: number
  paid: number
  outstanding: number
  overdue: number
}

export interface AgingBucket { key: 'notDue' | 'd1_30' | 'd31_60' | 'd61'; label: string; amount: number; count: number }

export function buildRows(sales: ReportSale[], payments: ReportPayment[], now: Date): ReportRow[] {
  const paidBySale = new Map<string, number>()
  for (const p of payments) {
    if (p.saleId) paidBySale.set(p.saleId, (paidBySale.get(p.saleId) || 0) + p.amount)
  }
  return sales.map(s => {
    const cashNoCustomer = s.paymentType === 'cash' && !s.customerId
    const paid = r2(cashNoCustomer ? s.totalAmount : (paidBySale.get(s.id) || 0))
    const balance = Math.max(0, r2(s.totalAmount - paid))
    const overpaid = Math.max(0, r2(paid - s.totalAmount))
    const status: ReportRow['status'] = balance === 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
    const ref = (s.dueDate ?? s.createdAt).getTime()
    const daysPast = balance > 0 ? Math.max(0, Math.floor((now.getTime() - ref) / DAY)) : 0
    return { ...s, paid, balance, overpaid, status, daysPast }
  })
}

export function computeTotals(rows: ReportRow[]): ReportTotals {
  const sum = (f: (r: ReportRow) => number) => r2(rows.reduce((a, r) => a + f(r), 0))
  const total = sum(r => r.totalAmount)
  const vat = sum(r => r.vatAmount)
  const cost = sum(r => r.totalCost)
  return {
    count: rows.length,
    total, vat, net: r2(total - vat), cost, grossProfit: r2(total - vat - cost),
    paid: sum(r => Math.min(r.paid, r.totalAmount)),
    outstanding: sum(r => r.balance),
    overdue: sum(r => (r.daysPast > 0 ? r.balance : 0)),
  }
}

export function computeAging(rows: ReportRow[]): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { key: 'notDue', label: "Muddati o'tmagan", amount: 0, count: 0 },
    { key: 'd1_30', label: "1–30 kun o'tgan", amount: 0, count: 0 },
    { key: 'd31_60', label: "31–60 kun o'tgan", amount: 0, count: 0 },
    { key: 'd61', label: "60+ kun o'tgan", amount: 0, count: 0 },
  ]
  for (const r of rows) {
    if (r.balance <= 0) continue
    const b = r.daysPast <= 0 ? buckets[0] : r.daysPast <= 30 ? buckets[1] : r.daysPast <= 60 ? buckets[2] : buckets[3]
    b.amount = r2(b.amount + r.balance)
    b.count += 1
  }
  return buckets
}

export function buildPaymentTypeReport(sales: ReportSale[], payments: ReportPayment[], now: Date = new Date()) {
  const all = buildRows(sales, payments, now)
  const byType = (t: PayType) => all.filter(r => r.paymentType === t)
  return {
    rowsByType: { cash: byType('cash'), transfer: byType('transfer'), credit: byType('credit') },
    summary: {
      cash: computeTotals(byType('cash')),
      transfer: computeTotals(byType('transfer')),
      credit: computeTotals(byType('credit')),
    },
    aging: {
      transfer: computeAging(byType('transfer')),
      credit: computeAging(byType('credit')),
    },
  }
}
