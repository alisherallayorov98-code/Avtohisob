import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getSearchVariants } from '../lib/transliterate'
import { getEffectiveWarehouseId } from '../lib/warehouse'

export async function getInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { warehouseId, branchId, category, lowStock, search } = req.query as any

    // branch_manager/operator: always their branch's warehouse
    let effectiveWarehouseId: string | null = null
    if (['branch_manager', 'operator'].includes(req.user!.role)) {
      effectiveWarehouseId = await getEffectiveWarehouseId(req.user!.branchId)
    } else if (warehouseId) {
      effectiveWarehouseId = warehouseId
    } else if (branchId) {
      // admin/manager may pass branchId to get that branch's warehouse inventory
      effectiveWarehouseId = await getEffectiveWarehouseId(branchId)
    }

    const where: any = {}
    if (effectiveWarehouseId) where.warehouseId = effectiveWarehouseId
    const sparePartWhere: any = {}
    if (category) sparePartWhere.category = category
    if (search) {
      const variants = getSearchVariants(search)
      sparePartWhere.OR = variants.flatMap((v: string) => [
        { name: { contains: v, mode: 'insensitive' } },
        { partCode: { contains: v, mode: 'insensitive' } },
      ])
    }
    if (Object.keys(sparePartWhere).length > 0) where.sparePart = sparePartWhere

    const include = {
      sparePart: { include: { supplier: { select: { id: true, name: true } } } },
      warehouse: { select: { id: true, name: true } },
    }

    if (lowStock === 'true') {
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
    const { warehouseId } = req.query as any
    let effectiveWarehouseId: string | null = null
    if (['branch_manager', 'operator'].includes(req.user!.role)) {
      effectiveWarehouseId = await getEffectiveWarehouseId(req.user!.branchId)
    } else {
      effectiveWarehouseId = warehouseId || null
    }

    const where: any = {}
    if (effectiveWarehouseId) where.warehouseId = effectiveWarehouseId

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
    // Resolve to warehouse
    const warehouseId = await getEffectiveWarehouseId(branchId)
    const where: any = warehouseId ? { warehouseId } : {}
    const inventory = await prisma.inventory.findMany({
      where,
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
    const { sparePartId, warehouseId, quantity, reorderLevel } = req.body
    if (!warehouseId) throw new AppError('Sklad tanlanmagan', 400)
    if (parseInt(quantity) <= 0) throw new AppError('Miqdor 0 dan katta bo\'lishi kerak', 400)
    const existing = await prisma.inventory.findUnique({
      where: { sparePartId_warehouseId: { sparePartId, warehouseId } },
    })

    let inventory
    if (existing) {
      inventory = await prisma.inventory.update({
        where: { id: existing.id },
        data: { quantityOnHand: existing.quantityOnHand + parseInt(quantity), lastRestockDate: new Date(), ...(reorderLevel && { reorderLevel: parseInt(reorderLevel) }) },
        include: { sparePart: true, warehouse: { select: { id: true, name: true } } },
      })
    } else {
      inventory = await prisma.inventory.create({
        data: { sparePartId, warehouseId, quantityOnHand: parseInt(quantity), reorderLevel: parseInt(reorderLevel || '5'), lastRestockDate: new Date() },
        include: { sparePart: true, warehouse: { select: { id: true, name: true } } },
      })
    }
    res.json(successResponse(inventory, 'Ombor yangilandi'))
  } catch (err) { next(err) }
}

export async function updateInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { quantityOnHand, quantityReserved, reorderLevel } = req.body
    if (quantityOnHand !== undefined && parseInt(quantityOnHand) < 0)
      throw new AppError('Miqdor manfiy bo\'lmasligi kerak', 400)
    if (quantityReserved !== undefined && parseInt(quantityReserved) < 0)
      throw new AppError('Zaxiradagi miqdor manfiy bo\'lmasligi kerak', 400)
    if (reorderLevel !== undefined && parseInt(reorderLevel) < 0)
      throw new AppError('Qayta buyurtma darajasi manfiy bo\'lmasligi kerak', 400)
    const inventory = await prisma.inventory.update({
      where: { id: req.params.id },
      data: {
        ...(quantityOnHand !== undefined && { quantityOnHand: parseInt(quantityOnHand) }),
        ...(quantityReserved !== undefined && { quantityReserved: parseInt(quantityReserved) }),
        ...(reorderLevel !== undefined && { reorderLevel: parseInt(reorderLevel) }),
      },
      include: { sparePart: true, warehouse: { select: { id: true, name: true } } },
    })
    res.json(successResponse(inventory, 'Ombor yangilandi'))
  } catch (err) { next(err) }
}

export async function adjustInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { quantityOnHand, reason } = req.body
    if (quantityOnHand === undefined || !reason || !reason.trim())
      throw new AppError('Yangi miqdor va sabab kiritilishi shart', 400)
    const qty = parseInt(quantityOnHand)
    if (isNaN(qty) || qty < 0) throw new AppError('Miqdor 0 dan katta yoki teng bo\'lishi kerak', 400)

    const existing = await prisma.inventory.findUnique({
      where: { id: req.params.id },
      include: { sparePart: { select: { name: true } }, warehouse: { select: { name: true } } },
    })
    if (!existing) throw new AppError('Ombor yozuvi topilmadi', 404)

    const [inventory] = await prisma.$transaction([
      prisma.inventory.update({
        where: { id: req.params.id },
        data: { quantityOnHand: qty },
        include: { sparePart: true, warehouse: { select: { id: true, name: true } } },
      }),
      prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'INVENTORY_ADJUST',
          entityType: 'Inventory',
          entityId: req.params.id,
          oldData: { quantityOnHand: existing.quantityOnHand, sparePart: existing.sparePart.name, warehouse: existing.warehouse.name },
          newData: { quantityOnHand: qty, reason: reason.trim() },
        },
      }),
    ])
    res.json(successResponse(inventory, 'Ombor tuzatildi'))
  } catch (err) { next(err) }
}

export async function getLowStock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    let effectiveWarehouseId: string | null = null
    if (['branch_manager', 'operator'].includes(req.user!.role)) {
      effectiveWarehouseId = await getEffectiveWarehouseId(req.user!.branchId)
    } else {
      effectiveWarehouseId = (req.query.warehouseId as string) || null
    }

    const where: any = {}
    if (effectiveWarehouseId) where.warehouseId = effectiveWarehouseId

    const all = await prisma.inventory.findMany({
      where,
      include: { sparePart: true, warehouse: { select: { id: true, name: true } } },
    })
    const lowStock = all.filter(i => i.quantityOnHand <= i.reorderLevel)
    res.json(successResponse(lowStock))
  } catch (err) { next(err) }
}
