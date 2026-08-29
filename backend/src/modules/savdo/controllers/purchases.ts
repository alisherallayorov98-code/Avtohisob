import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { paginate, paginatedResponse, buildDateRangeFilter } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'

export async function exportPurchasesXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const where: any = { orgId }
    const dateFilter = buildDateRangeFilter(q.from, q.to)
    if (dateFilter) where.createdAt = dateFilter

    const purchases = await (prisma as any).savdoPurchase.findMany({
      where,
      include: {
        product: { select: { name: true, sku: true, unit: true } },
        warehouse: { select: { name: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const { wb, ws } = newWorkbook('Kirim')
    ws.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Mahsulot', key: 'product', width: 26 },
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Ombor', key: 'warehouse', width: 18 },
      { header: 'Yetkazib beruvchi', key: 'supplier', width: 20 },
      { header: 'Miqdor', key: 'quantity', width: 12 },
      { header: 'Narx', key: 'unitCost', width: 14 },
      { header: 'Summa', key: 'total', width: 14 },
      { header: 'Turi', key: 'type', width: 12 },
    ]
    for (const p of purchases) {
      ws.addRow({
        date: new Date(p.createdAt).toLocaleDateString('uz-UZ'),
        product: p.product.name, sku: p.product.sku, warehouse: p.warehouse.name,
        supplier: p.supplier?.name || '', quantity: p.quantity, unitCost: Number(p.unitCost),
        total: p.quantity * Number(p.unitCost),
        type: p.isOfficial ? 'Rasmiy' : 'Norasmiy',
      })
    }
    styleWorksheet(ws)
    await sendWorkbook(wb, 'kirim.xlsx', res)
  } catch (err) { next(err) }
}

export async function listPurchases(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)

    const where: any = { orgId }
    if (q.productId) where.productId = q.productId
    if (q.warehouseId) where.warehouseId = q.warehouseId
    if (q.supplierId) where.supplierId = q.supplierId
    const dateFilter = buildDateRangeFilter(q.from, q.to)
    if (dateFilter) where.createdAt = dateFilter

    const [total, purchases] = await Promise.all([
      (prisma as any).savdoPurchase.count({ where }),
      (prisma as any).savdoPurchase.findMany({
        where, skip, take: limit,
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          warehouse: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    res.json(paginatedResponse(purchases, total, page, limit))
  } catch (err) { next(err) }
}

export async function createPurchase(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const {
      productId, warehouseId, quantity, unitCost,
      isOfficial, supplierId, invoiceNumber, notes,
    } = req.body

    if (!productId || !warehouseId) {
      res.status(400).json({ success: false, error: 'productId va warehouseId talab qilinadi' })
      return
    }
    // Int ustunlarga (quantity, remainingQty, quantityOnHand) yoziladi —
    // saleService.ts'dagi Math.round bilan bir xil qoida, aks holda kasr son
    // Prisma validatsiya xatosiga (500) olib kelardi.
    const qty = Math.round(Number(quantity))
    const cost = Number(unitCost)
    if (!Number.isFinite(qty) || qty <= 0) {
      res.status(400).json({ success: false, error: 'quantity musbat son bo\'lishi kerak' })
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      res.status(400).json({ success: false, error: 'unitCost noto\'g\'ri' })
      return
    }

    const [product, warehouse, supplier] = await Promise.all([
      (prisma as any).savdoProduct.findUnique({ where: { id: productId } }),
      (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } }),
      supplierId ? (prisma as any).savdoSupplier.findUnique({ where: { id: supplierId } }) : Promise.resolve(null),
    ])
    if (!product || product.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Mahsulot topilmadi' })
      return
    }
    if (!warehouse || warehouse.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Ombor topilmadi' })
      return
    }
    if (supplierId && (!supplier || supplier.orgId !== orgId)) {
      res.status(404).json({ success: false, error: 'Yetkazib beruvchi topilmadi' })
      return
    }

    const receivedById = await ensureSavdoActor(actor)

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await (tx as any).savdoPurchase.create({
        data: {
          orgId, productId, warehouseId, quantity: qty, unitCost: cost,
          isOfficial: isOfficial !== undefined ? Boolean(isOfficial) : true,
          supplierId: supplierId || null,
          invoiceNumber: invoiceNumber || null,
          notes: notes || null,
          receivedById,
        },
      })

      const costLayer = await (tx as any).savdoCostLayer.create({
        data: {
          orgId, purchaseId: purchase.id, productId, warehouseId,
          unitCost: cost, quantity: qty, remainingQty: qty,
        },
      })

      const stock = await (tx as any).savdoStock.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        create: { productId, warehouseId, quantityOnHand: qty },
        update: { quantityOnHand: { increment: qty } },
      })

      return { purchase, costLayer, stock }
    })

    res.status(201).json({ success: true, data: result.purchase, message: 'Kirim qayd etildi' })
  } catch (err) { next(err) }
}
