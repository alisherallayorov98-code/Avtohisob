import { Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { generateArticleCode } from '../services/articleCodeService'

export async function getSpareParts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { search, category, supplierId, isActive } = req.query as any

    const where: any = {}
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { partCode: { contains: search, mode: 'insensitive' } },
    ]
    if (category) where.category = category
    if (supplierId) where.supplierId = supplierId
    if (isActive !== undefined) where.isActive = isActive === 'true'

    const [total, spareParts] = await Promise.all([
      prisma.sparePart.count({ where }),
      prisma.sparePart.findMany({
        where, skip, take: limit,
        include: { supplier: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    res.json({ success: true, data: spareParts, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sp = await prisma.sparePart.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        inventories: { include: { branch: { select: { id: true, name: true } } } },
      },
    })
    if (!sp) throw new AppError('Ehtiyot qism topilmadi', 404)
    res.json(successResponse(sp))
  } catch (err) { next(err) }
}

export async function createSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, partCode, category, unitPrice, supplierId, description } = req.body
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined
    const sp = await prisma.sparePart.create({
      data: { name, partCode, category, unitPrice: parseFloat(unitPrice), supplierId, description, imageUrl },
      include: { supplier: { select: { id: true, name: true } } },
    })

    // Avtomatik artikul generatsiya (non-blocking)
    generateArticleCode(sp.id).catch(() => {})

    res.status(201).json(successResponse(sp, 'Ehtiyot qism qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, partCode, category, unitPrice, supplierId, description, isActive } = req.body
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined
    const sp = await prisma.sparePart.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(partCode && { partCode }),
        ...(category && { category }),
        ...(unitPrice !== undefined && { unitPrice: parseFloat(unitPrice) }),
        ...(supplierId && { supplierId }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(imageUrl && { imageUrl }),
      },
      include: { supplier: { select: { id: true, name: true } } },
    })
    res.json(successResponse(sp, 'Ehtiyot qism yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.sparePart.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json(successResponse(null, 'Ehtiyot qism o\'chirildi'))
  } catch (err) { next(err) }
}

export async function getNextPartCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { base } = req.query as { base: string }
    if (!base) return res.json(successResponse({ code: '' }))

    // prefix = letters+dash part, e.g. "BAT-001" → "BAT-"
    const match = base.match(/^([A-Za-z]+-?)/)
    const prefix = match ? match[1].toUpperCase() : base.toUpperCase().slice(0, 4) + '-'

    // Find all codes starting with this prefix
    const existing = await prisma.sparePart.findMany({
      where: { partCode: { startsWith: prefix, mode: 'insensitive' } },
      select: { partCode: true },
    })

    const nums = existing
      .map(e => parseInt(e.partCode.replace(prefix, ''), 10))
      .filter(n => !isNaN(n))
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
    const code = `${prefix}${String(next).padStart(3, '0')}`
    res.json(successResponse({ code }))
  } catch (err) { next(err) }
}

export async function generateAllArticleCodes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Artikulsiz barcha ehtiyot qismlarni topib, avtomatik kod beradi
    const parts = await prisma.sparePart.findMany({
      where: { articleCode: null },
      select: { id: true },
    })
    let generated = 0
    for (const part of parts) {
      await generateArticleCode(part.id).catch(() => {})
      generated++
    }
    res.json(successResponse({ generated }, `${generated} ta ehtiyot qismga artikul berildi`))
  } catch (err) { next(err) }
}

export async function getLowStock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = req.user!.branchId || (req.query.branchId as string)
    const where: any = { quantityOnHand: { lte: prisma.inventory.fields.reorderLevel } }
    if (branchId) where.branchId = branchId

    // Use Prisma.sql for safe parameterized conditional SQL (no injection risk)
    const lowStock = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT i.id, i.quantity_on_hand, i.reorder_level, i.branch_id,
             sp.name AS spare_part_name, sp.part_code, sp.category,
             b.name AS branch_name
      FROM inventory i
      JOIN spare_parts sp ON sp.id = i.spare_part_id
      JOIN branches b ON b.id = i.branch_id
      WHERE i.quantity_on_hand <= i.reorder_level
      ${branchId ? Prisma.sql`AND i.branch_id = ${branchId}::uuid` : Prisma.empty}
      ORDER BY (i.quantity_on_hand - i.reorder_level) ASC
    `)
    res.json(successResponse(lowStock))
  } catch (err) { next(err) }
}
