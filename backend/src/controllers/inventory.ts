import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getSearchVariants } from '../lib/transliterate'
import { getEffectiveWarehouseId } from '../lib/warehouse'
import { getOrgFilter, getOrgWarehouseIds } from '../lib/orgFilter'

export async function getInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { warehouseId, branchId, category, lowStock, search } = req.query as any

    const filter = await getOrgFilter(req.user!)
    const where: any = {}

    if (filter.type !== 'none') {
      // Org-restricted: show only warehouses belonging to this org
      const wareIds = await getOrgWarehouseIds(filter)
      if (wareIds !== null) {
        where.warehouseId = { in: wareIds }
        // Allow further narrowing by specific warehouseId if within allowed set
        if (warehouseId && wareIds.includes(warehouseId)) where.warehouseId = warehouseId
      }
    } else {
      // super_admin: optional filters
      if (warehouseId) {
        where.warehouseId = warehouseId
      } else if (branchId) {
        const wId = await getEffectiveWarehouseId(branchId)
        if (wId) where.warehouseId = wId
      }
    }
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
    const filter = await getOrgFilter(req.user!)
    const where: any = {}

    if (filter.type !== 'none') {
      const wareIds = await getOrgWarehouseIds(filter)
      if (wareIds !== null) where.warehouseId = { in: wareIds }
    } else if (warehouseId) {
      where.warehouseId = warehouseId
    }

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
    const filter = await getOrgFilter(req.user!)
    if (filter.type !== 'none') {
      const allowed = filter.type === 'single'
        ? filter.branchId === branchId
        : filter.orgBranchIds.includes(branchId)
      if (!allowed) throw new AppError("Bu filial omboriga kirish huquqingiz yo'q", 403)
    }
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
    const { sparePartId, warehouseId, quantity, reorderLevel, unitPrice } = req.body
    if (!warehouseId) throw new AppError('Sklad tanlanmagan', 400)
    if (parseInt(quantity) <= 0) throw new AppError("Miqdor 0 dan katta bo'lishi kerak", 400)
    // Tenant isolation: warehouseId shu org ga tegishlimi?
    const filter = await getOrgFilter(req.user!)
    if (filter.type !== 'none') {
      const allowed = await getOrgWarehouseIds(filter)
      if (allowed !== null && !allowed.includes(warehouseId))
        throw new AppError("Bu ombor sizning tashkilotingizga tegishli emas", 403)
    }
    const existing = await prisma.inventory.findUnique({
      where: { sparePartId_warehouseId: { sparePartId, warehouseId } },
    })

    // Update unitPrice on sparePart if provided (price may change with each restock)
    if (unitPrice && parseFloat(unitPrice) > 0) {
      await prisma.sparePart.update({
        where: { id: sparePartId },
        data: { unitPrice: parseFloat(unitPrice) },
      })
    }

    let inventory
    if (existing) {
      inventory = await prisma.inventory.update({
        where: { id: existing.id },
        data: { quantityOnHand: { increment: parseInt(quantity) }, lastRestockDate: new Date(), ...(reorderLevel && { reorderLevel: parseInt(reorderLevel) }) },
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
      throw new AppError("Miqdor manfiy bo'lmasligi kerak", 400)
    if (quantityReserved !== undefined && parseInt(quantityReserved) < 0)
      throw new AppError("Zaxiradagi miqdor manfiy bo'lmasligi kerak", 400)
    if (reorderLevel !== undefined && parseInt(reorderLevel) < 0)
      throw new AppError("Qayta buyurtma darajasi manfiy bo'lmasligi kerak", 400)
    // Tenant isolation
    const existing = await prisma.inventory.findUnique({ where: { id: req.params.id }, select: { warehouseId: true } })
    if (!existing) throw new AppError('Ombor yozuvi topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (filter.type !== 'none') {
      const allowed = await getOrgWarehouseIds(filter)
      if (allowed !== null && !allowed.includes(existing.warehouseId))
        throw new AppError("Bu ombor sizning tashkilotingizga tegishli emas", 403)
    }
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
    const { quantityOnHand, reason, newWarehouseId } = req.body
    if (quantityOnHand === undefined || !reason || !reason.trim())
      throw new AppError('Yangi miqdor va sabab kiritilishi shart', 400)
    const qty = parseInt(quantityOnHand)
    if (isNaN(qty) || qty < 0) throw new AppError('Miqdor 0 dan katta yoki teng bo\'lishi kerak', 400)

    const existing = await prisma.inventory.findUnique({
      where: { id: req.params.id },
      include: { sparePart: { select: { name: true } }, warehouse: { select: { id: true, name: true } } },
    })
    if (!existing) throw new AppError('Ombor yozuvi topilmadi', 404)
    // Tenant isolation
    const filter = await getOrgFilter(req.user!)
    if (filter.type !== 'none') {
      const allowed = await getOrgWarehouseIds(filter)
      if (allowed !== null && !allowed.includes(existing.warehouseId))
        throw new AppError("Bu ombor sizning tashkilotingizga tegishli emas", 403)
    }

    // Handle warehouse change
    if (newWarehouseId && newWarehouseId !== existing.warehouseId) {
      // Check if target warehouse already has this spare part
      const targetExisting = await prisma.inventory.findUnique({
        where: { sparePartId_warehouseId: { sparePartId: existing.sparePartId, warehouseId: newWarehouseId } },
      })
      if (targetExisting) {
        // Merge: add quantities, delete old record
        await prisma.$transaction([
          prisma.inventory.update({
            where: { id: targetExisting.id },
            data: { quantityOnHand: { increment: qty } },
          }),
          prisma.inventory.delete({ where: { id: req.params.id } }),
          prisma.auditLog.create({
            data: {
              userId: req.user!.id,
              action: 'INVENTORY_ADJUST',
              entityType: 'Inventory',
              entityId: req.params.id,
              oldData: { quantityOnHand: existing.quantityOnHand, sparePart: existing.sparePart.name, warehouse: existing.warehouse.name },
              newData: { quantityOnHand: qty, newWarehouseId, reason: reason.trim(), merged: true },
            },
          }),
        ])
        const merged = await prisma.inventory.findUnique({
          where: { id: targetExisting.id },
          include: { sparePart: true, warehouse: { select: { id: true, name: true } } },
        })
        return res.json(successResponse(merged, 'Sklad o\'zgartirildi va miqdorlar birlashtirildi'))
      } else {
        // Move to new warehouse
        const [inventory] = await prisma.$transaction([
          prisma.inventory.update({
            where: { id: req.params.id },
            data: { quantityOnHand: qty, warehouseId: newWarehouseId },
            include: { sparePart: true, warehouse: { select: { id: true, name: true } } },
          }),
          prisma.auditLog.create({
            data: {
              userId: req.user!.id,
              action: 'INVENTORY_ADJUST',
              entityType: 'Inventory',
              entityId: req.params.id,
              oldData: { quantityOnHand: existing.quantityOnHand, sparePart: existing.sparePart.name, warehouse: existing.warehouse.name },
              newData: { quantityOnHand: qty, newWarehouseId, reason: reason.trim() },
            },
          }),
        ])
        return res.json(successResponse(inventory, 'Sklad o\'zgartirildi'))
      }
    }

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

export async function deleteInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const item = await prisma.inventory.findUnique({
      where: { id },
      include: { sparePart: { select: { name: true } }, warehouse: { select: { name: true } } },
    })
    if (!item) throw new AppError('Ombor yozuvi topilmadi', 404)
    // Tenant isolation
    const filter = await getOrgFilter(req.user!)
    if (filter.type !== 'none') {
      const allowed = await getOrgWarehouseIds(filter)
      if (allowed !== null && !allowed.includes(item.warehouseId))
        throw new AppError("Bu ombor sizning tashkilotingizga tegishli emas", 403)
    }

    await prisma.$transaction([
      prisma.inventory.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'INVENTORY_DELETE',
          entityType: 'Inventory',
          entityId: id,
          oldData: { sparePart: item.sparePart.name, warehouse: item.warehouse.name, quantityOnHand: item.quantityOnHand },
          newData: { deleted: true },
        },
      }),
    ])
    res.json(successResponse(null, 'Ombor yozuvi o\'chirildi'))
  } catch (err) { next(err) }
}

export async function getLowStock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const where: any = {}

    if (filter.type !== 'none') {
      const wareIds = await getOrgWarehouseIds(filter)
      if (wareIds !== null) where.warehouseId = { in: wareIds }
    } else if (req.query.warehouseId) {
      where.warehouseId = req.query.warehouseId as string
    }

    const all = await prisma.inventory.findMany({
      where,
      include: { sparePart: true, warehouse: { select: { id: true, name: true } } },
    })
    const lowStock = all.filter(i => i.quantityOnHand <= i.reorderLevel)
    res.json(successResponse(lowStock))
  } catch (err) { next(err) }
}
