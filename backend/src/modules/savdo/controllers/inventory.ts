import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { paginate, paginatedResponse } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'
import {
  getInventoryReport, previewInventoryCount, confirmInventoryCount, CountLineInput,
} from '../services/inventoryService'
import { SavdoError } from '../lib/savdoError'

export async function getReport(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { warehouseId } = req.query as Record<string, string>
    const report = await getInventoryReport(orgId, warehouseId || null)
    res.json({ success: true, data: report })
  } catch (err) { next(err) }
}

export async function exportReportXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { warehouseId } = req.query as Record<string, string>
    const report = await getInventoryReport(orgId, warehouseId || null)

    const { wb, ws } = newWorkbook('Inventarizatsiya')
    ws.columns = [
      { header: 'Ombor', key: 'warehouse', width: 18 },
      { header: 'Mahsulot', key: 'product', width: 28 },
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'Qoldiq', key: 'qty', width: 12 },
      { header: 'Birlik', key: 'unit', width: 10 },
      { header: 'Tannarx', key: 'unitCost', width: 14 },
      { header: 'Qiymat', key: 'value', width: 16 },
    ]
    for (const wgroup of report.warehouses) {
      for (const item of wgroup.items) {
        ws.addRow({
          warehouse: item.warehouseName, product: item.productName, sku: item.sku,
          qty: item.quantityOnHand, unit: item.unit, unitCost: item.unitCost, value: item.value,
        })
      }
    }
    ws.addRow({})
    const totalRow = ws.addRow({ product: 'JAMI', value: report.grandTotal })
    totalRow.font = { bold: true }
    styleWorksheet(ws)
    await sendWorkbook(wb, 'inventarizatsiya-hisobot.xlsx', res)
  } catch (err) { next(err) }
}

/** Yuklangan .xlsx'dan (SKU | sanalgan miqdor) qatorlarni o'qiydi. */
async function readCountUpload(buffer: Buffer): Promise<{ sku: string; countedQty: number }[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)
  const ws = wb.worksheets[0]
  if (!ws) throw new SavdoError('Faylda varaq topilmadi')

  const rows: { sku: string; countedQty: number }[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return // sarlavha
    const values = (row.values as unknown[]).slice(1)
    const sku = String(values[0] ?? '').trim()
    const qty = Number(values[1])
    if (!sku || !Number.isFinite(qty)) return
    rows.push({ sku, countedQty: qty })
  })
  return rows
}

export async function previewCount(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { warehouseId } = req.body

    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }

    let lines: CountLineInput[]
    if (req.file) {
      const uploaded = await readCountUpload(req.file.buffer)
      if (uploaded.length === 0) {
        res.status(400).json({ success: false, error: 'Faylda haqiqiy qator topilmadi (SKU | miqdor)' })
        return
      }
      const skus = uploaded.map(u => u.sku)
      const products = await (prisma as any).savdoProduct.findMany({
        where: { orgId, sku: { in: skus } },
        select: { id: true, sku: true },
      })
      const bySku = new Map(products.map((p: any) => [p.sku, p.id]))
      const notFound: string[] = []
      lines = []
      for (const u of uploaded) {
        const productId = bySku.get(u.sku)
        if (!productId) { notFound.push(u.sku); continue }
        lines.push({ productId: productId as string, countedQty: u.countedQty })
      }
      if (lines.length === 0) {
        res.status(400).json({ success: false, error: `Hech qanday SKU mos kelmadi: ${notFound.slice(0, 5).join(', ')}` })
        return
      }
      const preview = await previewInventoryCount(orgId, warehouseId, lines)
      res.json({ success: true, data: { preview, notFoundSkus: notFound } })
      return
    }

    const bodyLines = req.body.lines
    if (!Array.isArray(bodyLines) || bodyLines.length === 0) {
      res.status(400).json({ success: false, error: 'Fayl yoki lines talab qilinadi' })
      return
    }
    lines = bodyLines.map((l: any) => ({ productId: l.productId, countedQty: Number(l.countedQty) }))
    const preview = await previewInventoryCount(orgId, warehouseId, lines)
    res.json({ success: true, data: { preview, notFoundSkus: [] } })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function confirmCount(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { warehouseId, lines, notes } = req.body

    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ success: false, error: 'Kamida bitta qator kerak' })
      return
    }

    const countedById = await ensureSavdoActor(actor)
    const result = await confirmInventoryCount({
      orgId: actor.orgId,
      warehouseId,
      countedById,
      notes: notes || null,
      lines: lines.map((l: any) => ({ productId: l.productId, countedQty: Number(l.countedQty) })),
    })

    res.status(201).json({ success: true, data: result, message: 'Inventarizatsiya tasdiqlandi, qoldiq tuzatildi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function listCounts(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)

    const where: any = { orgId }
    if (q.warehouseId) where.warehouseId = q.warehouseId

    const [total, counts] = await Promise.all([
      (prisma as any).savdoInventoryCount.count({ where }),
      (prisma as any).savdoInventoryCount.findMany({
        where, skip, take: limit,
        include: {
          warehouse: { select: { id: true, name: true } },
          lines: { select: { id: true, diffQty: true, diffValue: true } },
        },
        orderBy: { countedAt: 'desc' },
      }),
    ])
    res.json(paginatedResponse(counts, total, page, limit))
  } catch (err) { next(err) }
}

export async function getCount(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params
    const count = await (prisma as any).savdoInventoryCount.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true } },
        lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    })
    if (!count || count.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Inventarizatsiya topilmadi' })
      return
    }
    res.json({ success: true, data: count })
  } catch (err) { next(err) }
}
