import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { paginate, paginatedResponse } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'

export async function exportStockXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!

    const [stock, costLayers] = await Promise.all([
      (prisma as any).savdoStock.findMany({
        where: { product: { orgId } },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: { product: { name: 'asc' } },
      }),
      (prisma as any).savdoCostLayer.findMany({
        where: { orgId, remainingQty: { gt: 0 } },
        select: { productId: true, warehouseId: true, unitCost: true, remainingQty: true },
      }),
    ])

    // Har mahsulot+ombor bo'yicha ochiq qatlamlar qiymati (dashboard'dagi bilan bir xil hisob)
    const valueByKey = new Map<string, number>()
    for (const l of costLayers) {
      const key = `${l.productId}:${l.warehouseId}`
      valueByKey.set(key, (valueByKey.get(key) || 0) + l.remainingQty * Number(l.unitCost))
    }

    const { wb, ws } = newWorkbook('Qoldiq')
    ws.columns = [
      { header: 'Mahsulot', key: 'product', width: 28 },
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Ombor', key: 'warehouse', width: 18 },
      { header: 'Qoldiq', key: 'qty', width: 12 },
      { header: 'Birlik', key: 'unit', width: 10 },
      { header: 'Qiymat', key: 'value', width: 16 },
    ]
    let grandTotal = 0
    for (const s of stock) {
      const value = valueByKey.get(`${s.productId}:${s.warehouseId}`) || 0
      grandTotal += value
      ws.addRow({
        product: s.product.name, sku: s.product.sku, warehouse: s.warehouse.name,
        qty: s.quantityOnHand, unit: s.product.unit, value: Math.round(value * 100) / 100,
      })
    }
    ws.addRow({})
    const totalRow = ws.addRow({ product: 'JAMI', value: Math.round(grandTotal * 100) / 100 })
    totalRow.font = { bold: true }
    styleWorksheet(ws)
    await sendWorkbook(wb, 'qoldiq.xlsx', res)
  } catch (err) { next(err) }
}

export async function listStock(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)

    const where: any = { product: { orgId } }
    if (q.warehouseId) where.warehouseId = q.warehouseId
    if (q.productId) where.productId = q.productId
    if (q.search) {
      where.product = {
        orgId,
        OR: [
          { name: { contains: q.search.trim(), mode: 'insensitive' } },
          { sku: { contains: q.search.trim(), mode: 'insensitive' } },
        ],
      }
    }

    const [total, stock] = await Promise.all([
      (prisma as any).savdoStock.count({ where }),
      (prisma as any).savdoStock.findMany({
        where, skip, take: limit,
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: { product: { name: 'asc' } },
      }),
    ])
    res.json(paginatedResponse(stock, total, page, limit))
  } catch (err) { next(err) }
}
