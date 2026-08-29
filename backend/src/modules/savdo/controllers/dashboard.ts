import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { computeCustomerDebt } from '../lib/savdoDebtMath'

// Hisobot/dashboard — yangi jadval shart emas, mavjud SavdoSale/SavdoStock/
// SavdoCostLayer/SavdoPayment'dan hisoblanadi. "So what?" testi: faqat
// harakat qilish kerak bo'lgan narsalar ko'rsatiladi (kam qoldiq, qarzdorlar).
export async function getDashboard(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [salesThisMonth, costLayers, customers, lowStock, recentSales] = await Promise.all([
      (prisma as any).savdoSale.findMany({
        where: { orgId, status: 'completed', createdAt: { gte: monthStart } },
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
        where: { orgId },
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ])

    const revenueThisMonth = salesThisMonth.reduce((sum: number, s: any) => sum + Number(s.totalAmount), 0)
    const costThisMonth = salesThisMonth.reduce((sum: number, s: any) => sum + Number(s.totalCost), 0)
    const profitThisMonth = revenueThisMonth - costThisMonth

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
        revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
        costThisMonth: Math.round(costThisMonth * 100) / 100,
        profitThisMonth: Math.round(profitThisMonth * 100) / 100,
        salesCountThisMonth: salesThisMonth.length,
        stockValuation: Math.round(stockValuation * 100) / 100,
        topDebtors,
        lowStockItems,
        recentSales: recentSales.map((s: any) => ({
          id: s.id, documentNumber: s.documentNumber, totalAmount: s.totalAmount,
          createdAt: s.createdAt, customerName: s.customer?.name ?? null, saleType: s.saleType,
        })),
      },
    })
  } catch (err) { next(err) }
}
