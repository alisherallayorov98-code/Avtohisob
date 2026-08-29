import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { computeCustomerDebt } from '../lib/savdoDebtMath'
import { sumExpenses, groupExpensesByCategory } from '../lib/expenseMath'
import { resolveDashboardPeriod } from '../lib/dashboardPeriod'

// Hisobot/dashboard — yangi jadval shart emas, mavjud SavdoSale/SavdoStock/
// SavdoCostLayer/SavdoPayment/SavdoExpense'dan hisoblanadi. "So what?" testi:
// faqat harakat qilish kerak bo'lgan narsalar ko'rsatiladi (kam qoldiq, qarzdorlar).
//
// Davr: ?from=YYYY-MM-DD&to=YYYY-MM-DD. Berilmasa — joriy oy (eski xatti-harakat).
// Qoldiq qiymati, qarzdorlar va kam qoldiq davrga bog'liq EMAS — ular "hozirgi
// holat" ko'rsatkichlari, sana oralig'i ularga qo'llanmaydi (aks holda "o'tgan
// oyning ombor qoldig'i" degan chalg'ituvchi son chiqardi).
export async function getDashboard(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { from, to, label } = resolveDashboardPeriod(q.from, q.to)

    const [periodSales, costLayers, customers, lowStock, recentSales, expenses] = await Promise.all([
      (prisma as any).savdoSale.findMany({
        where: { orgId, status: 'completed', createdAt: { gte: from, lte: to } },
        select: { totalAmount: true, totalCost: true },
      }),
      (prisma as any).savdoCostLayer.findMany({
        where: { orgId, remainingQty: { gt: 0 } },
        select: { unitCost: true, remainingQty: true },
      }),
      (prisma as any).savdoCustomer.findMany({
        where: { orgId, isActive: true },
        select: {
          id: true, name: true,
          sales: { where: { status: 'completed' }, select: { id: true, totalAmount: true, status: true } },
          payments: { where: { cancelled: false }, select: { saleId: true, amount: true } },
        },
      }),
      (prisma as any).savdoStock.findMany({
        where: { product: { orgId }, reorderLevel: { gt: 0 } },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          warehouse: { select: { id: true, name: true } },
        },
      }),
      (prisma as any).savdoSale.findMany({
        where: { orgId, createdAt: { gte: from, lte: to } },
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      (prisma as any).savdoExpense.findMany({
        where: { orgId, cancelled: false, spentAt: { gte: from, lte: to } },
        select: { category: true, amount: true, cancelled: true },
      }),
    ])

    const revenue = periodSales.reduce((sum: number, s: any) => sum + Number(s.totalAmount), 0)
    const cost = periodSales.reduce((sum: number, s: any) => sum + Number(s.totalCost), 0)
    const grossProfit = Math.round((revenue - cost) * 100) / 100

    const expenseRows = expenses.map((e: any) => ({
      category: e.category, amount: Number(e.amount), cancelled: e.cancelled,
    }))
    const totalExpenses = sumExpenses(expenseRows)
    const netProfit = Math.round((grossProfit - totalExpenses) * 100) / 100

    const stockValuation = costLayers.reduce(
      (sum: number, l: any) => sum + l.remainingQty * Number(l.unitCost), 0,
    )

    const topDebtors = customers
      .map((c: any) => {
        const debt = computeCustomerDebt(
          c.sales.map((s: any) => ({ id: s.id, totalAmount: Number(s.totalAmount), status: s.status })),
          c.payments.map((p: any) => ({ saleId: p.saleId, amount: Number(p.amount) })),
        )
        return { id: c.id, name: c.name, debt: debt.totalDebt }
      })
      .filter((c: any) => c.debt > 0)
      .sort((a: any, b: any) => b.debt - a.debt)
      .slice(0, 5)

    const lowStockItems = lowStock
      .filter((s: any) => s.quantityOnHand <= s.reorderLevel)
      .map((s: any) => ({
        product: s.product, warehouse: s.warehouse,
        quantityOnHand: s.quantityOnHand, reorderLevel: s.reorderLevel,
      }))

    res.json({
      success: true,
      data: {
        period: { from: from.toISOString(), to: to.toISOString(), label },
        revenue: Math.round(revenue * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        grossProfit,
        expenses: totalExpenses,
        netProfit,
        expenseByCategory: groupExpensesByCategory(expenseRows),
        salesCount: periodSales.length,
        stockValuation: Math.round(stockValuation * 100) / 100,
        topDebtors,
        lowStockItems,
        recentSales: recentSales.map((s: any) => ({
          id: s.id, documentNumber: s.documentNumber, totalAmount: s.totalAmount,
          createdAt: s.createdAt, customerName: s.customer?.name ?? null, saleType: s.saleType,
          status: s.status,
        })),
      },
    })
  } catch (err) { next(err) }
}
