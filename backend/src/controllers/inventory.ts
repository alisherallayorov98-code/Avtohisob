import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getSearchVariants } from '../lib/transliterate'
import { getEffectiveWarehouseId } from '../lib/warehouse'
import { getOrgFilter, getOrgWarehouseIds, resolveOrgId } from '../lib/orgFilter'
import { isSimplifiedView } from '../services/orgSettingsService'
import ExcelJS from 'exceljs'

export async function getInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { warehouseId, branchId, category, lowStock, search, select: selectAll } = req.query as any

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

    // select=true: transfer/dropdown uchun — limit cheklovisiz
    if (selectAll === 'true') {
      const inventory = await prisma.inventory.findMany({
        where,
        include: { sparePart: { select: { id: true, name: true, partCode: true, unitPrice: true } }, warehouse: { select: { id: true, name: true } } },
        orderBy: { sparePart: { name: 'asc' } },
      })
      return res.json({ success: true, data: inventory, meta: { total: inventory.length, page: 1, limit: inventory.length, totalPages: 1 } })
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
    const { sparePartId, warehouseId, quantity, reorderLevel, unitPrice, isOfficial } = req.body
    if (!warehouseId) throw new AppError('Sklad tanlanmagan', 400)
    if (parseInt(quantity) <= 0) throw new AppError("Miqdor 0 dan katta bo'lishi kerak", 400)
    // Tenant isolation: warehouseId shu org ga tegishlimi?
    const filter = await getOrgFilter(req.user!)
    if (filter.type !== 'none') {
      const allowed = await getOrgWarehouseIds(filter)
      if (allowed !== null && !allowed.includes(warehouseId))
        throw new AppError("Bu ombor sizning tashkilotingizga tegishli emas", 403)
    }
    // SparePart tenant isolation: bu ehtiyot qism shu org ga tegishlimi?
    const orgId = await resolveOrgId(req.user!)
    if (orgId) {
      const sp = await prisma.sparePart.findUnique({
        where: { id: sparePartId },
        select: { organizationId: true },
      })
      if (!sp) throw new AppError("Ehtiyot qism topilmadi", 404)
      if (sp.organizationId !== orgId)
        throw new AppError("Bu ehtiyot qism sizning tashkilotingizga tegishli emas", 403)
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
    await (prisma as any).inventoryReceipt.create({
      data: {
        sparePartId,
        warehouseId,
        quantity: parseInt(quantity),
        unitPrice: unitPrice && parseFloat(unitPrice) > 0 ? parseFloat(unitPrice) : (inventory.sparePart as any).unitPrice ?? 0,
        receivedById: req.user!.id,
        // Rasmiy/norasmiy belgisi: default rasmiy. Frontend tanlasa boolean keladi.
        isOfficial: isOfficial === false ? false : true,
      },
    })
    res.json(successResponse(inventory, 'Ombor yangilandi'))
  } catch (err) { next(err) }
}

export async function updateInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { quantityOnHand, quantityReserved, reorderLevel, unitPrice, sparePartId, warehouseId } = req.body
    if (quantityOnHand !== undefined && parseInt(quantityOnHand) < 0)
      throw new AppError("Miqdor manfiy bo'lmasligi kerak", 400)
    if (quantityReserved !== undefined && parseInt(quantityReserved) < 0)
      throw new AppError("Zaxiradagi miqdor manfiy bo'lmasligi kerak", 400)
    if (reorderLevel !== undefined && parseInt(reorderLevel) < 0)
      throw new AppError("Qayta buyurtma darajasi manfiy bo'lmasligi kerak", 400)
    if (unitPrice !== undefined && unitPrice !== '' && parseFloat(unitPrice) < 0)
      throw new AppError("Narx manfiy bo'lmasligi kerak", 400)

    // Yozuvni topamiz: avval id bo'yicha, bo'lmasa sparePartId+warehouseId bo'yicha
    // (id eskirgan/yo'q bo'lsa ham tahrirlash ishlashi uchun).
    let existing = await prisma.inventory.findUnique({ where: { id: req.params.id } })
    if (!existing && sparePartId && warehouseId) {
      existing = await prisma.inventory.findUnique({
        where: { sparePartId_warehouseId: { sparePartId, warehouseId } },
      })
    }

    const filter = await getOrgFilter(req.user!)
    const assertTenant = async (wId: string) => {
      if (filter.type !== 'none') {
        const allowed = await getOrgWarehouseIds(filter)
        if (allowed !== null && !allowed.includes(wId))
          throw new AppError("Bu ombor sizning tashkilotingizga tegishli emas", 403)
      }
    }

    const data: any = {}
    if (quantityOnHand !== undefined) data.quantityOnHand = parseInt(quantityOnHand)
    if (quantityReserved !== undefined) data.quantityReserved = parseInt(quantityReserved)
    if (reorderLevel !== undefined) data.reorderLevel = parseInt(reorderLevel)

    let inventory
    const include = { sparePart: true, warehouse: { select: { id: true, name: true } } }
    if (existing) {
      await assertTenant(existing.warehouseId)
      inventory = await prisma.inventory.update({ where: { id: existing.id }, data, include })
    } else if (sparePartId && warehouseId) {
      // Yozuv yo'q bo'lsa — yaratamiz (ombor bo'limidan to'g'ridan-to'g'ri kiritish)
      await assertTenant(warehouseId)
      inventory = await prisma.inventory.create({
        data: {
          sparePartId, warehouseId,
          quantityOnHand: data.quantityOnHand ?? 0,
          quantityReserved: data.quantityReserved ?? 0,
          reorderLevel: data.reorderLevel ?? 0,
        },
        include,
      })
    } else {
      throw new AppError('Ombor yozuvi topilmadi', 404)
    }

    // Narxni yangilash (narx zaxira qism kartochkasida saqlanadi)
    const spId = existing?.sparePartId || sparePartId
    if (spId && unitPrice !== undefined && unitPrice !== '' && !isNaN(parseFloat(unitPrice))) {
      await prisma.sparePart.update({ where: { id: spId }, data: { unitPrice: parseFloat(unitPrice) } })
      ;(inventory as any).sparePart = await prisma.sparePart.findUnique({ where: { id: spId } })
    }

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
      // Tenant isolation: maqsad ombor ham org'ga tegishli bo'lishi shart
      if (filter.type !== 'none') {
        const allowedTargets = await getOrgWarehouseIds(filter)
        if (allowedTargets !== null && !allowedTargets.includes(newWarehouseId))
          throw new AppError("Maqsad ombor sizning tashkilotingizga tegishli emas", 403)
      }
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

// Preview: ko'chirishdan oldin nima borligi
export async function previewMoveWarehouse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromWarehouseId } = req.query as { fromWarehouseId: string }
    if (!fromWarehouseId) throw new AppError('fromWarehouseId talab qilinadi', 400)

    const filter = await getOrgFilter(req.user!)
    const allowedIds = await getOrgWarehouseIds(filter)
    if (allowedIds !== null && !allowedIds.includes(fromWarehouseId))
      throw new AppError('Ruxsat yo\'q', 403)

    const items = await prisma.inventory.findMany({
      where: { warehouseId: fromWarehouseId, quantityOnHand: { gt: 0 } },
      include: { sparePart: { select: { name: true, partCode: true } } },
      orderBy: { sparePart: { name: 'asc' } },
    })

    res.json(successResponse({ count: items.length, items }))
  } catch (err) { next(err) }
}

// Faqat admin: bir ombordan ikkinchisiga ko'chirish + audit log
export async function moveWarehouseInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromWarehouseId, toWarehouseId } = req.body as {
      fromWarehouseId: string
      toWarehouseId: string
    }
    if (!fromWarehouseId || !toWarehouseId) throw new AppError('fromWarehouseId va toWarehouseId talab qilinadi', 400)
    if (fromWarehouseId === toWarehouseId) throw new AppError('Bir xil omborga ko\'chirish mumkin emas', 400)

    // Faqat o'z org omborlari
    const filter = await getOrgFilter(req.user!)
    const allowedIds = await getOrgWarehouseIds(filter)
    if (allowedIds !== null) {
      if (!allowedIds.includes(fromWarehouseId) || !allowedIds.includes(toWarehouseId))
        throw new AppError('Ruxsat yo\'q', 403)
    }

    const items = await prisma.inventory.findMany({
      where: { warehouseId: fromWarehouseId, quantityOnHand: { gt: 0 } },
      include: { sparePart: { select: { name: true, partCode: true } } },
    })
    if (!items.length) throw new AppError('Ko\'chiriladigan mahsulot topilmadi', 404)

    const [fromWh, toWh] = await Promise.all([
      prisma.warehouse.findUnique({ where: { id: fromWarehouseId }, select: { name: true } }),
      prisma.warehouse.findUnique({ where: { id: toWarehouseId }, select: { name: true } }),
    ])

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.inventory.upsert({
          where: { sparePartId_warehouseId: { sparePartId: item.sparePartId, warehouseId: toWarehouseId } },
          create: { sparePartId: item.sparePartId, warehouseId: toWarehouseId, quantityOnHand: item.quantityOnHand, reorderLevel: item.reorderLevel },
          update: { quantityOnHand: { increment: item.quantityOnHand } },
        })
        await tx.inventory.delete({ where: { id: item.id } })
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'WAREHOUSE_MOVE',
          entityType: 'Inventory',
          entityId: fromWarehouseId,
          oldData: { warehouseId: fromWarehouseId, warehouseName: fromWh?.name, itemCount: items.length },
          newData: {
            warehouseId: toWarehouseId,
            warehouseName: toWh?.name,
            items: items.map(i => ({ partCode: i.sparePart.partCode, name: i.sparePart.name, qty: i.quantityOnHand })),
          },
        },
      })
    })

    res.json(successResponse({ moved: items.length }, `${items.length} ta mahsulot "${fromWh?.name}" dan "${toWh?.name}" ga ko'chirildi`))
  } catch (err) { next(err) }
}

export async function getReceipts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { warehouseId, dateFrom, dateTo, page: p, limit: l } = req.query as any
    const page = parseInt(p || '1')
    const limit = parseInt(l || '50')
    const skip = (page - 1) * limit

    const filter = await getOrgFilter(req.user!)
    const where: any = {}

    if (filter.type !== 'none') {
      const wareIds = await getOrgWarehouseIds(filter)
      if (wareIds !== null) {
        where.warehouseId = warehouseId && wareIds.includes(warehouseId) ? warehouseId : { in: wareIds }
      }
    } else if (warehouseId) {
      where.warehouseId = warehouseId
    }

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) {
        const to = new Date(dateTo)
        to.setHours(23, 59, 59, 999)
        where.createdAt.lte = to
      }
    }

    // Soddalashtirilgan ko'rinish: faqat rasmiy kirimlar
    const orgIdForSimplified = await resolveOrgId(req.user!)
    if (await isSimplifiedView(orgIdForSimplified)) {
      where.isOfficial = true
    }

    const [total, receipts] = await Promise.all([
      (prisma as any).inventoryReceipt.count({ where }),
      (prisma as any).inventoryReceipt.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sparePart: { select: { id: true, name: true, partCode: true, category: true } },
          warehouse: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, fullName: true } },
        },
      }),
    ])

    res.json(successResponse(receipts, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

/**
 * GET /inventory/stocktake
 * Inventarizatsiya uchun: quantityOnHand > 0 bo'lgan barcha qismlar, sklad bo'yicha guruhlangan.
 * Sana faqat hujjat yorlig'i uchun (tarixiy hisob yo'q — hozirgi holat).
 */
export async function getStocktake(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { warehouseId } = req.query as any
    const filter = await getOrgFilter(req.user!)

    const wareIds = filter.type !== 'none' ? await getOrgWarehouseIds(filter) : null

    const where: any = { quantityOnHand: { gt: 0 } }
    if (wareIds !== null) {
      where.warehouseId = warehouseId && wareIds.includes(warehouseId)
        ? warehouseId
        : { in: wareIds }
    } else if (warehouseId) {
      where.warehouseId = warehouseId
    }

    const items = await prisma.inventory.findMany({
      where,
      include: {
        sparePart: {
          select: { id: true, name: true, partCode: true, category: true, unitPrice: true },
        },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: [
        { warehouse: { name: 'asc' } },
        { sparePart: { category: 'asc' } },
        { sparePart: { name: 'asc' } },
      ],
    })

    // Sklad bo'yicha guruhlash
    const byWarehouse: Record<string, {
      warehouseId: string
      warehouseName: string
      totalItems: number
      totalValue: number
      items: Array<{
        id: string; partCode: string; name: string; category: string
        quantityOnHand: number; unitPrice: number; totalValue: number
        reorderLevel: number
      }>
    }> = {}

    for (const inv of items) {
      const wid = inv.warehouseId
      if (!byWarehouse[wid]) {
        byWarehouse[wid] = {
          warehouseId: wid,
          warehouseName: inv.warehouse?.name ?? 'Noma\'lum sklad',
          totalItems: 0,
          totalValue: 0,
          items: [],
        }
      }
      const totalValue = inv.quantityOnHand * Number(inv.sparePart.unitPrice)
      byWarehouse[wid].items.push({
        id: inv.id,
        partCode: inv.sparePart.partCode,
        name: inv.sparePart.name,
        category: inv.sparePart.category,
        quantityOnHand: inv.quantityOnHand,
        unitPrice: Number(inv.sparePart.unitPrice),
        totalValue,
        reorderLevel: inv.reorderLevel,
      })
      byWarehouse[wid].totalItems += inv.quantityOnHand
      byWarehouse[wid].totalValue += totalValue
    }

    const warehouses = Object.values(byWarehouse)
    const grandTotal = warehouses.reduce((s, w) => s + w.totalValue, 0)
    const grandQty   = warehouses.reduce((s, w) => s + w.totalItems, 0)

    res.json(successResponse({ warehouses, grandTotal, grandQty, asOf: new Date().toISOString() }))
  } catch (err) { next(err) }
}

/**
 * GET /inventory/stocktake/excel
 * Inventarizatsiya qaydnomasini Excel formatida yuklab olish.
 */
export async function exportStocktakeExcel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { warehouseId, date } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const wareIds = filter.type !== 'none' ? await getOrgWarehouseIds(filter) : null

    const where: any = { quantityOnHand: { gt: 0 } }
    if (wareIds !== null) {
      where.warehouseId = warehouseId && wareIds.includes(warehouseId)
        ? warehouseId : { in: wareIds }
    } else if (warehouseId) {
      where.warehouseId = warehouseId
    }

    const items = await prisma.inventory.findMany({
      where,
      include: {
        sparePart: { select: { name: true, partCode: true, category: true, unitPrice: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: [{ warehouse: { name: 'asc' } }, { sparePart: { name: 'asc' } }],
    })

    const catLabel: Record<string, string> = {
      engine: 'Dvigatel', brake: 'Tormoz', suspension: 'Osma',
      electrical: 'Elektr', body: 'Kuzov', other: 'Boshqa',
    }
    const dateLabel = date ? new Date(date + 'T00:00:00').toLocaleDateString('uz-UZ') : new Date().toLocaleDateString('uz-UZ')

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AvtoHisob'

    // Sklad bo'yicha guruhlash
    const byWarehouse = new Map<string, { name: string; items: typeof items }>()
    for (const inv of items) {
      const wname = inv.warehouse?.name ?? 'Noma\'lum'
      if (!byWarehouse.has(wname)) byWarehouse.set(wname, { name: wname, items: [] })
      byWarehouse.get(wname)!.items.push(inv)
    }

    for (const [wname, wdata] of byWarehouse) {
      const ws = wb.addWorksheet(wname.slice(0, 31))

      // Sarlavha
      ws.mergeCells('A1:H1')
      ws.getCell('A1').value = `INVENTARIZATSIYA QAYDNOMASI — ${wname}`
      ws.getCell('A1').font = { bold: true, size: 13 }
      ws.getCell('A1').alignment = { horizontal: 'center' }

      ws.mergeCells('A2:H2')
      ws.getCell('A2').value = `Sana: ${dateLabel}`
      ws.getCell('A2').alignment = { horizontal: 'center' }
      ws.getCell('A2').font = { color: { argb: 'FF555555' }, italic: true }

      ws.addRow([])

      // Header
      const headerRow = ws.addRow(['№', 'Artikul', 'Nomi', 'Kategoriya', 'Miqdor (tizim)', 'Haqiqiy miqdor', 'Birlik narx', 'Jami qiymat'])
      headerRow.eachCell(cell => {
        cell.font = { bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      })

      ws.columns = [
        { key: 'no',       width: 5 },
        { key: 'code',     width: 16 },
        { key: 'name',     width: 36 },
        { key: 'category', width: 14 },
        { key: 'qty',      width: 14 },
        { key: 'real',     width: 16 },
        { key: 'price',    width: 16 },
        { key: 'total',    width: 18 },
      ]

      let grandQty = 0; let grandTotal = 0
      wdata.items.forEach((inv, idx) => {
        const unitPrice = Number(inv.sparePart.unitPrice)
        const totalVal  = inv.quantityOnHand * unitPrice
        grandQty   += inv.quantityOnHand
        grandTotal += totalVal

        const row = ws.addRow([
          idx + 1,
          inv.sparePart.partCode,
          inv.sparePart.name,
          catLabel[inv.sparePart.category] || inv.sparePart.category,
          inv.quantityOnHand,
          '',           // haqiqiy miqdor — bo'sh, qo'lda to'ldiriladi
          unitPrice,
          totalVal,
        ])
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } }
          if ([5, 6, 7, 8].includes(colNum)) cell.alignment = { horizontal: 'right' }
          if ([7, 8].includes(colNum)) cell.numFmt = '#,##0'
          if (colNum === 6) {
            // Haqiqiy miqdor ustuni — sariq fon (to'ldirish uchun)
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
          }
        })
        if (idx % 2 === 0) {
          row.eachCell({ includeEmpty: true }, cell => {
            if (!cell.fill || (cell.fill as any).fgColor?.argb === 'FFFFFFFF') {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F8F8' } }
            }
          })
        }
      })

      // Yig'ma qator
      const totalRow = ws.addRow(['', '', '', 'JAMI:', grandQty, '', '', grandTotal])
      totalRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.font = { bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
        cell.border = { top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } }
        if ([5, 7, 8].includes(colNum)) { cell.alignment = { horizontal: 'right' }; if ([7, 8].includes(colNum)) cell.numFmt = '#,##0' }
      })

      // Imzo joylari
      ws.addRow([])
      ws.addRow([])
      const sigRow1 = ws.addRow(['Ombor mudiri:', '', '', 'Hisobchi:', '', '', 'Komissiya a\'zosi:', ''])
      sigRow1.getCell(1).font = { bold: true }
      sigRow1.getCell(4).font = { bold: true }
      sigRow1.getCell(7).font = { bold: true }
      ws.addRow(['________________________', '', '', '________________________', '', '', '________________________', ''])
      ws.addRow([`Sana: ${dateLabel}`, '', '', `Sana: ${dateLabel}`, '', '', `Sana: ${dateLabel}`, ''])
    }

    const filename = `inventarizatsiya-${date || new Date().toISOString().split('T')[0]}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    await wb.xlsx.write(res)
  } catch (err) { next(err) }
}
