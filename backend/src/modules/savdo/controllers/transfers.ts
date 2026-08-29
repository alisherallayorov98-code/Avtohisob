// Savdo — omborlar orasida tovar ko'chirish (HTTP qatlami).
// Butun mantiq services/transferService.ts'da — bu yerda faqat validatsiya,
// filtr va javob formati (purchases.ts bilan bir xil pattern).

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { paginate, paginatedResponse, buildDateRangeFilter } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'
import { SavdoError } from '../lib/savdoError'
import { createTransfer, cancelTransfer } from '../services/transferService'

const TRANSFER_INCLUDE = {
  product: { select: { id: true, name: true, sku: true, unit: true } },
  fromWarehouse: { select: { id: true, name: true } },
  toWarehouse: { select: { id: true, name: true } },
}

/** Ro'yxat filtri — warehouseId ikkala tomon bo'yicha qidiradi (manba yoki qabul). */
function buildTransferWhere(orgId: string, q: Record<string, string>): any {
  const where: any = { orgId }
  if (q.productId) where.productId = q.productId
  if (q.warehouseId) {
    where.OR = [
      { fromWarehouseId: q.warehouseId },
      { toWarehouseId: q.warehouseId },
    ]
  }
  if (q.fromWarehouseId) where.fromWarehouseId = q.fromWarehouseId
  if (q.toWarehouseId) where.toWarehouseId = q.toWarehouseId
  const dateFilter = buildDateRangeFilter(q.from, q.to)
  if (dateFilter) where.createdAt = dateFilter
  return where
}

export async function listTransfers(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)
    const where = buildTransferWhere(orgId, q)

    const [total, transfers] = await Promise.all([
      (prisma as any).savdoTransfer.count({ where }),
      (prisma as any).savdoTransfer.findMany({
        where, skip, take: limit,
        include: TRANSFER_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    ])
    res.json(paginatedResponse(transfers, total, page, limit))
  } catch (err) { next(err) }
}

export async function createTransferHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { fromWarehouseId, toWarehouseId, productId, quantity, notes } = req.body

    const transferredById = await ensureSavdoActor(actor)

    const transfer = await createTransfer({
      orgId: actor.orgId,
      fromWarehouseId, toWarehouseId, productId,
      quantity,
      transferredById,
      notes: notes || null,
    })

    res.status(201).json({ success: true, data: transfer, message: 'Tovar ko\'chirildi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function cancelTransferHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { id } = req.params
    const cancelledById = await ensureSavdoActor(actor)

    await cancelTransfer({ orgId: actor.orgId, transferId: id, cancelledById })

    res.json({ success: true, data: null, message: 'Ko\'chirish bekor qilindi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function exportTransfersXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const where = buildTransferWhere(orgId, q)

    const transfers = await (prisma as any).savdoTransfer.findMany({
      where,
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })

    const { wb, ws } = newWorkbook('Ko\'chirish')
    ws.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Mahsulot', key: 'product', width: 26 },
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Qayerdan', key: 'from', width: 18 },
      { header: 'Qayerga', key: 'to', width: 18 },
      { header: 'Miqdor', key: 'quantity', width: 12 },
      { header: 'Tannarx summasi', key: 'totalCost', width: 16 },
      { header: 'Holat', key: 'status', width: 14 },
      { header: 'Izoh', key: 'notes', width: 28 },
    ]
    for (const t of transfers) {
      ws.addRow({
        date: new Date(t.createdAt).toLocaleDateString('uz-UZ'),
        product: t.product.name, sku: t.product.sku,
        from: t.fromWarehouse.name, to: t.toWarehouse.name,
        quantity: t.quantity, totalCost: Number(t.totalCost),
        status: t.status === 'cancelled' ? 'Bekor qilingan' : 'Bajarilgan',
        notes: t.notes || '',
      })
    }
    styleWorksheet(ws)
    await sendWorkbook(wb, 'kochirish.xlsx', res)
  } catch (err) { next(err) }
}
