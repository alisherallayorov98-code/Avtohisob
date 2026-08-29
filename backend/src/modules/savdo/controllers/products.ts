import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { paginate, paginatedResponse } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'

export async function exportProductsXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const products = await (prisma as any).savdoProduct.findMany({
      where: { orgId },
      orderBy: { name: 'asc' },
    })

    const { wb, ws } = newWorkbook('Mahsulotlar')
    ws.columns = [
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'Nomi', key: 'name', width: 30 },
      { header: 'Kategoriya', key: 'category', width: 18 },
      { header: 'Birlik', key: 'unit', width: 10 },
      { header: 'Optom narx', key: 'wholesalePrice', width: 14 },
      { header: 'Chakana narx', key: 'retailPrice', width: 14 },
      { header: 'Holat', key: 'status', width: 10 },
    ]
    for (const p of products) {
      ws.addRow({
        sku: p.sku, name: p.name, category: p.category || '',
        unit: p.unit, wholesalePrice: Number(p.wholesalePrice), retailPrice: Number(p.retailPrice),
        status: p.isActive ? 'Faol' : 'Nofaol',
      })
    }
    styleWorksheet(ws)
    await sendWorkbook(wb, 'mahsulotlar.xlsx', res)
  } catch (err) { next(err) }
}

export async function listProducts(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)

    const where: any = { orgId }
    if (q.search) {
      const term = q.search.trim()
      // Uzun raqamli SKU (artikul) bo'yicha aniq moslik avval tekshiriladi —
      // orgId_sku unique indeksga tushadi (tez), keyin substring qidiruv.
      const exact = await (prisma as any).savdoProduct.findUnique({
        where: { orgId_sku: { orgId, sku: term } },
      })
      if (exact) {
        res.json(paginatedResponse([exact], 1, 1, limit))
        return
      }
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
      ]
    }
    if (q.isActive !== undefined) where.isActive = q.isActive === 'true'

    const [total, products] = await Promise.all([
      (prisma as any).savdoProduct.count({ where }),
      (prisma as any).savdoProduct.findMany({
        where, skip, take: limit,
        orderBy: { name: 'asc' },
      }),
    ])
    res.json(paginatedResponse(products, total, page, limit))
  } catch (err) { next(err) }
}

// Dropdown/tanlov uchun yengil ro'yxat — sahifalanmagan, lekin xavfsiz chegara bilan.
// Kirim/Savdo/Kassa formalaridagi <select> shu yerdan to'ladi.
export async function listProductOptions(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const products = await (prisma as any).savdoProduct.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, sku: true, unit: true, wholesalePrice: true, retailPrice: true },
      orderBy: { name: 'asc' },
      take: 1000,
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
