import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'

export async function listProducts(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>

    const where: any = { orgId }
    if (q.search) {
      where.OR = [
        { name: { contains: q.search.trim(), mode: 'insensitive' } },
        { sku: { contains: q.search.trim(), mode: 'insensitive' } },
      ]
    }
    if (q.isActive !== undefined) where.isActive = q.isActive === 'true'

    const products = await (prisma as any).savdoProduct.findMany({
      where,
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: products })
  } catch (err) { next(err) }
}

export async function createProduct(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { sku, name, category, unit, wholesalePrice, retailPrice } = req.body

    if (!sku || !String(sku).trim()) {
      res.status(400).json({ success: false, error: 'sku talab qilinadi' })
      return
    }
    if (!name || !String(name).trim()) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }

    const existing = await (prisma as any).savdoProduct.findUnique({
      where: { orgId_sku: { orgId, sku: String(sku).trim() } },
    })
    if (existing) {
      res.status(409).json({ success: false, error: 'Shu SKU bilan mahsulot allaqachon mavjud' })
      return
    }

    const product = await (prisma as any).savdoProduct.create({
      data: {
        orgId,
        sku: String(sku).trim(),
        name: String(name).trim(),
        category: category || null,
        unit: unit || 'dona',
        wholesalePrice: wholesalePrice ?? 0,
        retailPrice: retailPrice ?? 0,
      },
    })
    res.status(201).json({ success: true, data: product })
  } catch (err) { next(err) }
}

export async function updateProduct(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params
    const { name, category, unit, wholesalePrice, retailPrice, isActive } = req.body

    const existing = await (prisma as any).savdoProduct.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Mahsulot topilmadi' })
      return
    }

    const product = await (prisma as any).savdoProduct.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(category !== undefined && { category: category || null }),
        ...(unit !== undefined && { unit }),
        ...(wholesalePrice !== undefined && { wholesalePrice }),
        ...(retailPrice !== undefined && { retailPrice }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    })
    res.json({ success: true, data: product })
  } catch (err) { next(err) }
}
