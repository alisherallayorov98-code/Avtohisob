import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

export async function getInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { branchId, category, lowStock, search } = req.query as any

    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role)
      ? req.user!.branchId : branchId

    const where: any = {}
    if (effectiveBranchId) where.branchId = effectiveBranchId
    const sparePartWhere: any = {}
    if (category) sparePartWhere.category = category
    if (search) sparePartWhere.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { partCode: { contains: search, mode: 'insensitive' } },
    ]
    if (Object.keys(sparePartWhere).length > 0) where.sparePart = sparePartWhere

    const include = {
      sparePart: { include: { supplier: { select: { id: true, name: true } } } },
      branch: { select: { id: true, name: true } },
    }

    if (lowStock === 'true') {
      // Filter in-memory since Prisma can't compare two columns in WHERE
      const all = await prisma.inventory.findMany({
        where, include, orderBy: { updatedAt: 'desc' },
      })
      const filtered = all.filter(i => i.quantityOnHand <= i.reorderLevel)
      const total = filtered.length
      const paged = filtered.slice(skip, skip + limit)
      return res.json({ success: true, data: paged, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
    }

    const [total, inventory] = await Promise.all([
      prisma.inventory.count({ where }),
      prisma.inventory.findMany({ where, skip, take: limit, include, orderBy: { updatedAt: 'desc' } }),
    ])

    res.json({ success: true, data: inventory, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getInventoryStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role)
      ? req.user!.branchId : branchId

    const where: any = {}
    if (effectiveBranchId) where.branchId = effectiveBranchId

    const all = await prisma.inventory.findMany({
      where,
      include: { sparePart: { select: { unitPrice: true } } },
    })

    const totalItems = all.length
    const totalValue = all.reduce((sum, i) => sum + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0)
    const lowStockCount = all.filter(i => i.quantityOnHand <= i.reorderLevel).length
    const outOfStockCount = all.filter(i => i.quantityOnHand === 0).length

    res.json(successResponse({ totalItems, totalValue, lowStockCount, outOfStockCount }))
  } catch (err) { next(err) }
}

export async function getBranchInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id: branchId } = req.params
    const inventory = await prisma.inventory.findMany({
      where: { branchId },
      include: { sparePart: { include: { supplier: { select: { id: true, name: true } } } } },
      orderBy: { sparePart: { name: 'asc' } },
    })

    const totalValue = inventory.reduce((sum, item) => {
      return sum + (Number(item.quantityOnHand) * Number(item.sparePart.unitPrice))
    }, 0)
    const lowStockCount = inventory.filter(i => i.quantityOnHand <= i.reorderLevel).length

    res.json(successResponse({ inventory, stats: { totalItems: inventory.length, totalValue, lowStockCount } }))
  } catch (err) { next(err) }
}

export async function addStock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sparePartId, branchId, quantity, reorderLevel } = req.body
    if (parseInt(quantity) <= 0) throw new AppError('Miqdor 0 dan katta bo\'lishi kerak', 400)
    const existing = await prisma.inventory.findUnique({ where: { sparePartId_branchId: { sparePartId, branchId } } })

    let inventory
    if (existing) {
      inventory = await prisma.inventory.update({
        where: { id: existing.id },
        data: { quantityOnHand: existing.quantityOnHand + parseInt(quantity), lastRestockDate: new Date(), ...(reorderLevel && { reorderLevel: parseInt(reorderLevel) }) },
        include: { sparePart: true, branch: { select: { id: true, name: true } } },
      })
    } else {
      inventory = await prisma.inventory.create({
        data: { sparePartId, branchId, quantityOnHand: parseInt(quantity), reorderLevel: parseInt(reorderLevel || '5'), lastRestockDate: new Date() },
        include: { sparePart: true, branch: { select: { id: true, name: true } } },
      })
    }
    res.json(successResponse(inventory, 'Ombor yangilandi'))
  } catch (err) { next(err) }
}

export async function updateInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { quantityOnHand, quantityReserved, reorderLevel } = req.body
    const inventory = await prisma.inventory.update({
      where: { id: req.params.id },
      data: {
        ...(quantityOnHand !== undefined && { quantityOnHand: parseInt(quantityOnHand) }),
        ...(quantityReserved !== undefined && { quantityReserved: parseInt(quantityReserved) }),
        ...(reorderLevel !== undefined && { reorderLevel: parseInt(reorderLevel) }),
      },
      include: { sparePart: true, branch: { select: { id: true, name: true } } },
    })
    res.json(successResponse(inventory, 'Ombor yangilandi'))
  } catch (err) { next(err) }
}

export async function getLowStock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = ['branch_manager', 'operator'].includes(req.user!.role)
      ? req.user!.branchId
      : (req.query.branchId as string) || undefined
    const where: any = {}
    if (branchId) where.branchId = branchId

    const all = await prisma.inventory.findMany({
      where,
      include: { sparePart: true, branch: { select: { id: true, name: true } } },
    })
    const lowStock = all.filter(i => i.quantityOnHand <= i.reorderLevel)
    res.json(successResponse(lowStock))
  } catch (err) { next(err) }
}
