// Savdo — sotishdan oldin tannarx va narx belgilash.
// Har mahsulot uchun: joriy o'rtacha tannarx (ochiq FIFO qatlamlar), oxirgi kirim
// tannarxi (import xarajatlari bilan), joriy narxlar. Taklif etilgan xarajat ulushi =
// oxirgi 90 kun xarajatlari / shu davr sotilgan tovar tannarxi. Hisob: lib/costingCalc.ts.

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { qn } from '../lib/qty'
import { overheadPercent } from '../lib/costingCalc'
import { sumExpenses } from '../lib/expenseMath'

export async function getCosting(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000)

    const [products, layers, lastPurchases, sales, expenses] = await Promise.all([
      (prisma as any).savdoProduct.findMany({
        where: { orgId, isActive: true }, orderBy: { name: 'asc' }, take: 2000,
        select: { id: true, name: true, sku: true, unit: true, category: true, wholesalePrice: true, retailPrice: true },
      }),
      (prisma as any).savdoCostLayer.findMany({
        where: { orgId, remainingQty: { gt: 0 } },
        select: { productId: true, unitCost: true, remainingQty: true },
      }),
      (prisma as any).savdoPurchase.findMany({
        where: { orgId, status: 'completed', isOfficial: true },
        orderBy: { createdAt: 'desc' },
        distinct: ['productId'],
        select: { productId: true, unitCost: true, createdAt: true },
      }),
      (prisma as any).savdoSale.findMany({
        where: { orgId, status: 'completed', createdAt: { gte: since } },
        select: { totalCost: true },
      }),
      (prisma as any).savdoExpense.findMany({
        where: { orgId, cancelled: false, spentAt: { gte: since } },
        select: { category: true, amount: true, cancelled: true },
      }),
    ])

    const agg = new Map<string, { qty: number; value: number }>()
    for (const l of layers) {
      const a = agg.get(l.productId) ?? { qty: 0, value: 0 }
      a.qty += qn(l.remainingQty)
      a.value += qn(l.remainingQty) * Number(l.unitCost)
      agg.set(l.productId, a)
    }
    const lastMap = new Map<string, number>(lastPurchases.map((p: any) => [p.productId, Number(p.unitCost)]))

    const cogs = sales.reduce((s: number, x: any) => s + Number(x.totalCost), 0)
    const expTotal = sumExpenses(expenses.map((e: any) => ({ amount: Number(e.amount), cancelled: e.cancelled })))

    const items = products.map((p: any) => {
      const a = agg.get(p.id)
      return {
        id: p.id, name: p.name, sku: p.sku, unit: p.unit, category: p.category,
        wholesalePrice: Number(p.wholesalePrice), retailPrice: Number(p.retailPrice),
        qty: a ? Math.round(a.qty * 1000) / 1000 : 0,
        avgCost: a && a.qty > 0 ? Math.round((a.value / a.qty) * 100) / 100 : null,
        lastCost: lastMap.get(p.id) ?? null,
      }
    })

    res.json({
      success: true,
      data: {
        items,
        suggestedOverheadPct: overheadPercent(expTotal, cogs),
        periodDays: 90, expensesTotal: Math.round(expTotal * 100) / 100, cogsTotal: Math.round(cogs * 100) / 100,
      },
    })
  } catch (err) { next(err) }
}

/** Hisoblangan narxlarni mahsulotlarga ommaviy qo'llash (faqat o'z tashkilotining mahsulotlari). */
export async function applyCostingPrices(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const items = Array.isArray(req.body.items) ? req.body.items : []
    if (items.length === 0 || items.length > 500) {
      res.status(400).json({ success: false, error: 'items: 1..500 ta qator kerak' })
      return
    }
    let updated = 0
    for (const it of items) {
      const data: any = {}
      for (const k of ['wholesalePrice', 'retailPrice'] as const) {
        if (it[k] !== undefined && it[k] !== null) {
          const n = Number(it[k])
          if (!Number.isFinite(n) || n < 0) {
            res.status(400).json({ success: false, error: 'Narx noto\'g\'ri' })
            return
          }
          data[k] = n
        }
      }
      if (!it.productId || Object.keys(data).length === 0) continue
      const r = await (prisma as any).savdoProduct.updateMany({ where: { id: it.productId, orgId }, data })
      updated += r.count
    }
    res.json({ success: true, data: { updated }, message: `${updated} ta mahsulot narxi yangilandi` })
  } catch (err) { next(err) }
}
