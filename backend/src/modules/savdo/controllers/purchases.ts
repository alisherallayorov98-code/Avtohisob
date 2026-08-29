import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'

export async function listPurchases(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>

    const where: any = { orgId }
    if (q.productId) where.productId = q.productId
    if (q.warehouseId) where.warehouseId = q.warehouseId
    if (q.supplierId) where.supplierId = q.supplierId

    const purchases = await (prisma as any).savdoPurchase.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json({ success: true, data: purchases })
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
    const qty = Number(quantity)
    const cost = Number(unitCost)
    if (!Number.isFinite(qty) || qty <= 0) {
      res.status(400).json({ success: false, error: 'quantity musbat son bo\'lishi kerak' })
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      res.status(400).json({ success: false, error: 'unitCost noto\'g\'ri' })
      return
    }

    const [product, warehouse] = await Promise.all([
      (prisma as any).savdoProduct.findUnique({ where: { id: productId } }),
      (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } }),
    ])
    if (!product || product.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Mahsulot topilmadi' })
      return
    }
    if (!warehouse || warehouse.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Ombor topilmadi' })
      return
    }
    if (supplierId) {
      const supplier = await (prisma as any).savdoSupplier.findUnique({ where: { id: supplierId } })
      if (!supplier || supplier.orgId !== orgId) {
        res.status(404).json({ success: false, error: 'Yetkazib beruvchi topilmadi' })
        return
      }
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
