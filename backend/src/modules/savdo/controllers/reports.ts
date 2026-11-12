// Savdo — to'lov turi bo'yicha alohida hisobotlar: naqd / perechisleniya / qarz,
// hamda mijozlar qarz-avans qoldig'i. Hisob: lib/paymentTypeReport.ts, lib/savdoDebtMath.ts.

import { Response, NextFunction } from 'express'
import { formatUzDate } from '../../../lib/dateFormat'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { savdoDateRange } from '../lib/dateRange'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'
import { ownerScopeFilter, canSeeCost } from '../lib/savdoPermissions'
import { buildPaymentTypeReport, PayType, ReportRow } from '../lib/paymentTypeReport'
import { computeCustomerDebt } from '../lib/savdoDebtMath'

const TYPES: PayType[] = ['cash', 'transfer', 'credit']
const TYPE_LABEL: Record<PayType, string> = { cash: 'Naqd', transfer: 'Perechisleniya', credit: 'Qarz' }

async function loadReport(req: SavdoRequest) {
  const actor = req.savdoUser!
  const q = req.query as Record<string, string>
  const where: any = { orgId: actor.orgId, status: 'completed' }
  const dateFilter = savdoDateRange(q.from, q.to)
  if (dateFilter) where.createdAt = dateFilter
  const scope = ownerScopeFilter(actor.role, 'sales.viewAll', 'soldById', actor.id)
  if (scope) Object.assign(where, scope)

  const sales = await (prisma as any).savdoSale.findMany({
    where,
    select: {
      id: true, documentNumber: true, createdAt: true, customerId: true, totalAmount: true,
      vatAmount: true, totalCost: true, paymentType: true, dueDate: true,
      customer: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const ids = sales.map((s: any) => s.id)
  const payments = ids.length
    ? await (prisma as any).savdoPayment.findMany({
        where: { saleId: { in: ids }, cancelled: false },
        select: { saleId: true, amount: true },
      })
    : []

  const report = buildPaymentTypeReport(
    sales.map((s: any) => ({
      id: s.id, documentNumber: s.documentNumber, createdAt: s.createdAt, customerId: s.customerId,
      customerName: s.customer?.name ?? null, totalAmount: Number(s.totalAmount), vatAmount: Number(s.vatAmount),
      totalCost: Number(s.totalCost), paymentType: s.paymentType, dueDate: s.dueDate,
    })),
    payments.map((p: any) => ({ saleId: p.saleId, amount: Number(p.amount) })),
  )
  return { report, q, showCost: canSeeCost(actor.role) }
}

function stripCost(showCost: boolean, rows: ReportRow[]): any[] {
  if (showCost) return rows
  return rows.map(({ totalCost, ...r }) => r)
}

export async function getPaymentTypeReport(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { report, q, showCost } = await loadReport(req)
    const type: PayType = TYPES.includes(q.type as PayType) ? (q.type as PayType) : 'transfer'
    let rows = report.rowsByType[type]
    if (q.onlyOpen === '1') rows = rows.filter(r => r.balance > 0)

    // Davr bo'yicha tushgan pul usullar kesimida (kassa/bank solishtirish uchun)
    const actor = req.savdoUser!
    const payWhere: any = { orgId: actor.orgId, cancelled: false }
    const df = savdoDateRange(q.from, q.to)
    if (df) payWhere.paidAt = df
    const scope = ownerScopeFilter(actor.role, 'payments.viewAll', 'receivedById', actor.id)
    if (scope) Object.assign(payWhere, scope)
    const grouped = await (prisma as any).savdoPayment.groupBy({
      by: ['method'], where: payWhere, _sum: { amount: true }, _count: { _all: true },
    })
    const receipts: Record<string, { amount: number; count: number }> = {
      cash: { amount: 0, count: 0 }, bank: { amount: 0, count: 0 }, card: { amount: 0, count: 0 },
    }
    for (const g of grouped) {
      receipts[g.method] = { amount: Number(g._sum.amount ?? 0), count: g._count._all }
    }

    const summary: any = {}
    for (const t of TYPES) {
      const { cost, grossProfit, ...rest } = report.summary[t]
      summary[t] = showCost ? report.summary[t] : rest
    }
    res.json({
      success: true,
      data: {
        type, label: TYPE_LABEL[type],
        rows: stripCost(showCost, rows),
        totals: summary[type],
        aging: type === 'cash' ? [] : report.aging[type],
        summary, receipts,
      },
    })
  } catch (err) { next(err) }
}

export async function exportPaymentTypeXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { report, q, showCost } = await loadReport(req)
    const type: PayType = TYPES.includes(q.type as PayType) ? (q.type as PayType) : 'transfer'
    let rows = report.rowsByType[type]
    if (q.onlyOpen === '1') rows = rows.filter(r => r.balance > 0)

    const { wb, ws } = newWorkbook(`${TYPE_LABEL[type]} hisoboti`)
    ws.columns = [
      { header: 'Faktura', key: 'doc', width: 16 },
      { header: 'Sana', key: 'date', width: 13 },
      { header: 'Mijoz', key: 'customer', width: 24 },
      { header: 'Jami', key: 'total', width: 15 },
      { header: 'QQS', key: 'vat', width: 12 },
      { header: "To'langan", key: 'paid', width: 15 },
      { header: 'Qoldiq', key: 'balance', width: 15 },
      { header: 'Muddat', key: 'due', width: 13 },
      { header: "O'tgan kun", key: 'days', width: 11 },
      ...(showCost ? [{ header: 'Tannarx', key: 'cost', width: 15 }] : []),
    ]
    for (const r of rows) {
      ws.addRow({
        doc: r.documentNumber, date: formatUzDate(r.createdAt), customer: r.customerName || "Ko'chadan mijoz",
        total: r.totalAmount, vat: r.vatAmount, paid: Math.min(r.paid, r.totalAmount), balance: r.balance,
        due: r.dueDate ? formatUzDate(r.dueDate) : '', days: r.daysPast || '',
        ...(showCost ? { cost: r.totalCost } : {}),
      })
    }
    const t = report.summary[type]
    const totalRow = ws.addRow({
      doc: 'JAMI', total: t.total, vat: t.vat, paid: t.paid, balance: t.outstanding,
      ...(showCost ? { cost: t.cost } : {}),
    })
    totalRow.font = { bold: true }
    styleWorksheet(ws)
    await sendWorkbook(wb, `hisobot-${type}.xlsx`, res)
  } catch (err) { next(err) }
}

/** Har mijoz bo'yicha qarz va avans (yagona hisob: savdoDebtMath). */
export async function getCustomerBalances(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const customers = await (prisma as any).savdoCustomer.findMany({
      where: { orgId },
      select: {
        id: true, name: true, phone: true, isActive: true,
        sales: { where: { status: 'completed' }, select: { id: true, totalAmount: true, status: true, paymentType: true } },
        payments: { where: { cancelled: false }, select: { saleId: true, amount: true } },
      },
    })
    const rows = customers.map((c: any) => {
      const d = computeCustomerDebt(
        c.sales.map((s: any) => ({ id: s.id, totalAmount: Number(s.totalAmount), status: s.status })),
        c.payments.map((p: any) => ({ saleId: p.saleId, amount: Number(p.amount) })),
      )
      return { id: c.id, name: c.name, phone: c.phone, debt: d.totalDebt, advance: Math.max(0, d.advanceCredit - d.saleDebts.reduce((s, x) => s + x.balance, 0)), grossDebt: d.saleDebts.reduce((s, x) => s + x.balance, 0), advanceCredit: d.advanceCredit }
    }).filter((r: any) => r.debt > 0 || r.advance > 0)
      .sort((a: any, b: any) => b.debt - a.debt || b.advance - a.advance)

    const totalDebt = Math.round(rows.reduce((s: number, r: any) => s + r.debt, 0) * 100) / 100
    const totalAdvance = Math.round(rows.reduce((s: number, r: any) => s + r.advance, 0) * 100) / 100
    res.json({ success: true, data: { rows, totalDebt, totalAdvance } })
  } catch (err) { next(err) }
}
