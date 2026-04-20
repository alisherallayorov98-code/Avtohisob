import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, BranchFilter } from '../lib/orgFilter'

/** Throw 403 if neither warehouse of a transfer belongs to the user's org */
async function assertTransferAccess(filter: BranchFilter, fromWarehouseId: string, toWarehouseId: string) {
  if (filter.type === 'none') return // super_admin unrestricted
  const wIds = await (async () => {
    const branchIds = filter.type === 'single' ? [filter.branchId] : filter.orgBranchIds
    const branches = await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { warehouseId: true } })
    return branches.map(b => b.warehouseId).filter(Boolean) as string[]
  })()
  if (!wIds.includes(fromWarehouseId) && !wIds.includes(toWarehouseId)) {
    throw new AppError('Bu transferga ruxsat yo\'q', 403)
  }
}

async function getOrgWarehouseIds(filter: BranchFilter): Promise<string[] | null> {
  if (filter.type === 'none') return null
  const branchIds = filter.type === 'single' ? [filter.branchId] : filter.orgBranchIds
  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds } }, select: { warehouseId: true }
  })
  return branches.map(b => b.warehouseId).filter(Boolean) as string[]
}

export async function getTransferStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const wIds = await getOrgWarehouseIds(filter)
    const where: any = {}
    if (wIds !== null) {
      if (wIds.length === 0) return res.json(successResponse({ total: 0, pending: 0, approved: 0, shipped: 0, received: 0 }))
      where.OR = [{ fromWarehouseId: { in: wIds } }, { toWarehouseId: { in: wIds } }]
    }

    const [total, pending, approved, shipped, received] = await Promise.all([
      prisma.inventoryTransfer.count({ where }),
      prisma.inventoryTransfer.count({ where: { ...where, status: 'pending' } }),
      prisma.inventoryTransfer.count({ where: { ...where, status: 'approved' } }),
      prisma.inventoryTransfer.count({ where: { ...where, status: 'shipped' } }),
      prisma.inventoryTransfer.count({ where: { ...where, status: 'received' } }),
    ])
    res.json(successResponse({ total, pending, approved, shipped, received }))
  } catch (err) { next(err) }
}

export async function getTransfers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { status, fromWarehouseId, toWarehouseId, from, to } = req.query as any
    const where: any = {}
    if (status) where.status = status
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to)
    }
    const filter = await getOrgFilter(req.user!)
    const wIds = await getOrgWarehouseIds(filter)
    if (wIds !== null) {
      if (wIds.length === 0) return res.json({ success: true, data: [], meta: { total: 0, page, limit, totalPages: 0 } })
      where.OR = [{ fromWarehouseId: { in: wIds } }, { toWarehouseId: { in: wIds } }]
    } else {
      if (fromWarehouseId) where.fromWarehouseId = fromWarehouseId
      if (toWarehouseId) where.toWarehouseId = toWarehouseId
    }
    const [total, transfers] = await Promise.all([
      prisma.inventoryTransfer.count({ where }),
      prisma.inventoryTransfer.findMany({
        where, skip, take: limit,
        include: {
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          sparePart: { select: { id: true, name: true, partCode: true } },
          approvedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    res.json({ success: true, data: transfers, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const t = await prisma.inventoryTransfer.findUnique({
      where: { id: req.params.id },
      include: { fromWarehouse: true, toWarehouse: true, sparePart: true, approvedBy: { select: { fullName: true } } },
    })
    if (!t) throw new AppError('Taqsimot topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    await assertTransferAccess(filter, t.fromWarehouseId, t.toWarehouseId)
    res.json(successResponse(t))
  } catch (err) { next(err) }
}

export async function createTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromWarehouseId, toWarehouseId, sparePartId, quantity, notes } = req.body
    if (!fromWarehouseId || !toWarehouseId) throw new AppError('Omborlarni tanlang', 400)
    if (fromWarehouseId === toWarehouseId) throw new AppError('Bir xil omborga taqsimot qilish mumkin emas', 400)

    // branch_manager / org admin faqat o'z omboridan transfer yarata oladi
    const createFilter = await getOrgFilter(req.user!)
    const allowedWIds = await getOrgWarehouseIds(createFilter)
    if (allowedWIds !== null && !allowedWIds.includes(fromWarehouseId)) {
      throw new AppError("Faqat o'z omboringizdan transfer yaratish mumkin", 403)
    }

    const inventory = await prisma.inventory.findUnique({
      where: { sparePartId_warehouseId: { sparePartId, warehouseId: fromWarehouseId } },
    })
    if (!inventory || inventory.quantityOnHand < parseInt(quantity)) {
      throw new AppError('Omborda yetarli miqdor mavjud emas', 400)
    }
    const transfer = await prisma.inventoryTransfer.create({
      data: { fromWarehouseId, toWarehouseId, sparePartId, quantity: parseInt(quantity), notes, status: 'pending' },
      include: {
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        sparePart: { select: { name: true, partCode: true } },
      },
    })
    res.status(201).json(successResponse(transfer, 'Taqsimot yaratildi'))
  } catch (err) { next(err) }
}

export async function approveTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const t = await prisma.inventoryTransfer.findUnique({ where: { id: req.params.id } })
    if (!t) throw new AppError('Taqsimot topilmadi', 404)
    if (t.status !== 'pending') throw new AppError('Faqat kutilayotgan taqsimotni tasdiqlash mumkin', 400)
    const filter = await getOrgFilter(req.user!)
    await assertTransferAccess(filter, t.fromWarehouseId, t.toWarehouseId)
    const updated = await prisma.inventoryTransfer.update({
      where: { id: req.params.id },
      data: { status: 'approved', approvedById: req.user!.id },
    })
    res.json(successResponse(updated, 'Taqsimot tasdiqlandi'))
  } catch (err) { next(err) }
}

export async function shipTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const t = await prisma.inventoryTransfer.findUnique({ where: { id: req.params.id } })
    if (!t) throw new AppError('Taqsimot topilmadi', 404)
    if (t.status !== 'approved') throw new AppError('Faqat tasdiqlangan taqsimotni jonatish mumkin', 400)
    const filter = await getOrgFilter(req.user!)
    await assertTransferAccess(filter, t.fromWarehouseId, t.toWarehouseId)

    // Atomic decrement — race condition dan himoya
    const deducted = await prisma.inventory.updateMany({
      where: {
        sparePartId: t.sparePartId,
        warehouseId: t.fromWarehouseId,
        quantityOnHand: { gte: t.quantity },
      },
      data: { quantityOnHand: { decrement: t.quantity } },
    })
    if (deducted.count === 0) throw new AppError('Omborda yetarli miqdor mavjud emas', 400)

    const updated = await prisma.inventoryTransfer.update({
      where: { id: t.id },
      data: { status: 'shipped' },
    })
    res.json(successResponse(updated, 'Taqsimot jonatildi'))
  } catch (err) { next(err) }
}

export async function receiveTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const t = await prisma.inventoryTransfer.findUnique({ where: { id: req.params.id } })
    if (!t) throw new AppError('Taqsimot topilmadi', 404)
    if (t.status !== 'shipped') throw new AppError('Faqat jonatilgan taqsimotni qabul qilish mumkin', 400)
    const filter = await getOrgFilter(req.user!)
    await assertTransferAccess(filter, t.fromWarehouseId, t.toWarehouseId)

    await prisma.$transaction([
      prisma.inventoryTransfer.update({ where: { id: t.id }, data: { status: 'received' } }),
      prisma.inventory.upsert({
        where: { sparePartId_warehouseId: { sparePartId: t.sparePartId, warehouseId: t.toWarehouseId } },
        update: { quantityOnHand: { increment: t.quantity } },
        create: { sparePartId: t.sparePartId, warehouseId: t.toWarehouseId, quantityOnHand: t.quantity, reorderLevel: 5 },
      }),
    ])
    res.json(successResponse(null, 'Taqsimot qabul qilindi'))
  } catch (err) { next(err) }
}

export async function distributeTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromWarehouseId, items, notes } = req.body as {
      fromWarehouseId: string
      items: { sparePartId: string; quantity: number; toWarehouseId: string; notes?: string }[]
      notes?: string
    }

    if (!fromWarehouseId) throw new AppError('Asosiy ombor tanlanmagan', 400)
    if (!items?.length) throw new AppError('Kamida bitta qism kiriting', 400)

    for (const item of items) {
      if (!item.toWarehouseId) throw new AppError('Har bir qism uchun ombor tanlang', 400)
      if (item.toWarehouseId === fromWarehouseId) throw new AppError("Ombor o'ziga jo'nata olmaydi", 400)
    }

    // Tenant isolation: fromWarehouseId va barcha toWarehouseId lar org'ga tegishli bo'lishi shart
    const distribFilter = await getOrgFilter(req.user!)
    const distribAllowed = await getOrgWarehouseIds(distribFilter)
    if (distribAllowed !== null) {
      if (!distribAllowed.includes(fromWarehouseId)) {
        throw new AppError("Faqat o'z omboringizdan transfer yaratish mumkin", 403)
      }
      const targetIds = [...new Set(items.map(i => i.toWarehouseId))]
      const bad = targetIds.find(id => !distribAllowed.includes(id))
      if (bad) throw new AppError("Maqsad ombor sizning tashkilotingizga tegishli emas", 403)
    }

    const totalByPart: Record<string, number> = {}
    for (const item of items) {
      totalByPart[item.sparePartId] = (totalByPart[item.sparePartId] || 0) + Number(item.quantity)
    }

    const uniquePartIds = Object.keys(totalByPart)
    const inventoryChecks = await Promise.all(
      uniquePartIds.map(sparePartId =>
        prisma.inventory.findUnique({
          where: { sparePartId_warehouseId: { sparePartId, warehouseId: fromWarehouseId } },
          include: { sparePart: { select: { name: true } } },
        })
      )
    )
    for (let i = 0; i < uniquePartIds.length; i++) {
      const inv = inventoryChecks[i]
      const needed = totalByPart[uniquePartIds[i]]
      if (!inv || inv.quantityOnHand < needed) {
        const name = inv?.sparePart?.name || uniquePartIds[i]
        throw new AppError(`"${name}" — kerak: ${needed} ta, mavjud: ${inv?.quantityOnHand ?? 0} ta`, 400)
      }
    }

    const created = await prisma.inventoryTransfer.createMany({
      data: items.map(item => ({
        fromWarehouseId,
        toWarehouseId: item.toWarehouseId,
        sparePartId: item.sparePartId,
        quantity: Number(item.quantity),
        notes: item.notes || notes || null,
        status: 'pending',
      })),
    })

    res.status(201).json(successResponse({ count: created.count }, `${created.count} ta taqsimot yaratildi`))
  } catch (err) { next(err) }
}

export async function createBulkTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromWarehouseId, toWarehouseId, items, notes } = req.body as {
      fromWarehouseId: string
      toWarehouseId: string
      items: { sparePartId: string; quantity: number; notes?: string }[]
      notes?: string
    }

    if (!fromWarehouseId || !toWarehouseId) throw new AppError('Omborlar tanlanmagan', 400)
    if (fromWarehouseId === toWarehouseId) throw new AppError('Bir xil omborga taqsimot qilish mumkin emas', 400)
    if (!items?.length) throw new AppError('Kamida bitta ehtiyot qism tanlang', 400)

    // Tenant isolation: from va to omborlar org'ga tegishli bo'lishi shart
    const bulkFilter = await getOrgFilter(req.user!)
    const bulkAllowed = await getOrgWarehouseIds(bulkFilter)
    if (bulkAllowed !== null) {
      if (!bulkAllowed.includes(fromWarehouseId)) {
        throw new AppError("Faqat o'z omboringizdan transfer yaratish mumkin", 403)
      }
      if (!bulkAllowed.includes(toWarehouseId)) {
        throw new AppError("Maqsad ombor sizning tashkilotingizga tegishli emas", 403)
      }
    }

    const inventoryChecks = await Promise.all(
      items.map(item =>
        prisma.inventory.findUnique({
          where: { sparePartId_warehouseId: { sparePartId: item.sparePartId, warehouseId: fromWarehouseId } },
          include: { sparePart: { select: { name: true } } },
        })
      )
    )
    for (let i = 0; i < items.length; i++) {
      const inv = inventoryChecks[i]
      const qty = Number(items[i].quantity)
      if (!inv || inv.quantityOnHand < qty) {
        const name = inv?.sparePart?.name || items[i].sparePartId
        throw new AppError(`"${name}" uchun omborda yetarli miqdor yo'q (mavjud: ${inv?.quantityOnHand ?? 0})`, 400)
      }
    }

    const created = await prisma.inventoryTransfer.createMany({
      data: items.map(item => ({
        fromWarehouseId,
        toWarehouseId,
        sparePartId: item.sparePartId,
        quantity: Number(item.quantity),
        notes: item.notes || notes || null,
        status: 'pending',
      })),
    })

    res.status(201).json(successResponse({ count: created.count }, `${created.count} ta taqsimot yaratildi`))
  } catch (err) { next(err) }
}
