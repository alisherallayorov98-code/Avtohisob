import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'

export async function listStock(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>

    const where: any = { product: { orgId } }
    if (q.warehouseId) where.warehouseId = q.warehouseId
    if (q.productId) where.productId = q.productId

    const stock = await (prisma as any).savdoStock.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { product: { name: 'asc' } },
    })
    res.json({ success: true, data: stock })
  } catch (err) { next(err) }
}
