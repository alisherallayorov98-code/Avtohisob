import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getEffectiveWarehouseId } from '../lib/warehouse'

export async function getTransferStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userBranchId = req.user!.branchId
    const branchWhere: any = ['branch_manager', 'operator'].includes(req.user!.role) && userBranchId
      ? { OR: [{ fromBranchId: userBranchId }, { toBranchId: userBranchId }] } : {}

    const [total, pending, shipped, received] = await Promise.all([
      prisma.inventoryTransfer.count({ where: branchWhere }),
      prisma.inventoryTransfer.count({ where: { ...branchWhere, status: 'pending' } }),
      prisma.inventoryTransfer.count({ where: { ...branchWhere, status: 'shipped' } }),
      prisma.inventoryTransfer.count({ where: { ...branchWhere, status: 'received' } }),
    ])
    res.json(successResponse({ total, pending, shipped, received }))
  } catch (err) { next(err) }
}

export async function getTransfers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { status, fromBranchId, toBranchId, from, to } = req.query as any
    const where: any = {}
    if (status) where.status = status
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to)
    }
    const userBranchId = req.user!.branchId
    if (['branch_manager', 'operator'].includes(req.user!.role) && userBranchId) {
      where.OR = [{ fromBranchId: userBranchId }, { toBranchId: userBranchId }]
    } else {
      if (fromBranchId) where.fromBranchId = fromBranchId
      if (toBranchId) where.toBranchId = toBranchId
    }
    const [total, transfers] = await Promise.all([
      prisma.inventoryTransfer.count({ where }),
      prisma.inventoryTransfer.findMany({
        where, skip, take: limit,
        include: {
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
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
      include: { fromBranch: true, toBranch: true, sparePart: true, approvedBy: { select: { fullName: true } } },
    })
    if (!t) throw new AppError('Taqsimot topilmadi', 404)
    res.json(successResponse(t))
  } catch (err) { next(err) }
}

export async function createTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromBranchId, toBranchId, sparePartId, quantity, notes } = req.body
    if (fromBranchId === toBranchId) throw new AppError('Bir xil guruhga taqsimot qilish mumkin emas', 400)
    const fromWarehouseId = await getEffectiveWarehouseId(fromBranchId)
    if (!fromWarehouseId) throw new AppError('Manba guruhining skladi topilmadi', 400)
    const inventory = await prisma.inventory.findUnique({
      where: { sparePartId_warehouseId: { sparePartId, warehouseId: fromWarehouseId } },
    })
    if (!inventory || inventory.quantityOnHand < parseInt(quantity)) {
      throw new AppError('Omborda yetarli miqdor mavjud emas', 400)
    }
    const transfer = await prisma.inventoryTransfer.create({
      data: { fromBranchId, toBranchId, sparePartId, quantity: parseInt(quantity), notes, status: 'pending' },
      include: {
        fromBranch: { select: { name: true } }, toBranch: { select: { name: true } },
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
    const fromWarehouseId = await getEffectiveWarehouseId(t.fromBranchId)
    if (!fromWarehouseId) throw new AppError('Manba skladi topilmadi', 400)
    const inventory = await prisma.inventory.findUnique({
      where: { sparePartId_warehouseId: { sparePartId: t.sparePartId, warehouseId: fromWarehouseId } },
    })
    if (!inventory || inventory.quantityOnHand < t.quantity) throw new AppError('Omborda yetarli miqdor mavjud emas', 400)
    const [updated] = await prisma.$transaction([
      prisma.inventoryTransfer.update({ where: { id: t.id }, data: { status: 'shipped' } }),
      prisma.inventory.update({ where: { id: inventory.id }, data: { quantityOnHand: inventory.quantityOnHand - t.quantity } }),
    ])
    res.json(successResponse(updated, 'Taqsimot jonatildi'))
  } catch (err) { next(err) }
}

export async function receiveTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const t = await prisma.inventoryTransfer.findUnique({ where: { id: req.params.id } })
    if (!t) throw new AppError('Taqsimot topilmadi', 404)
    if (t.status !== 'shipped') throw new AppError('Faqat jonatilgan taqsimotni qabul qilish mumkin', 400)
    const toWarehouseId = await getEffectiveWarehouseId(t.toBranchId)
    if (!toWarehouseId) throw new AppError('Qabul qiluvchi sklad topilmadi', 400)
    const existing = await prisma.inventory.findUnique({
      where: { sparePartId_warehouseId: { sparePartId: t.sparePartId, warehouseId: toWarehouseId } },
    })
    await prisma.$transaction([
      prisma.inventoryTransfer.update({ where: { id: t.id }, data: { status: 'received' } }),
      existing
        ? prisma.inventory.update({ where: { id: existing.id }, data: { quantityOnHand: existing.quantityOnHand + t.quantity } })
        : prisma.inventory.create({ data: { sparePartId: t.sparePartId, warehouseId: toWarehouseId, quantityOnHand: t.quantity, reorderLevel: 5 } }),
    ])
    res.json(successResponse(null, 'Taqsimot qabul qilindi'))
  } catch (err) { next(err) }
}

export async function distributeTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromBranchId, items, notes } = req.body as {
      fromBranchId: string
      items: { sparePartId: string; quantity: number; toBranchId: string; notes?: string }[]
      notes?: string
    }

    if (!fromBranchId) throw new AppError('Asosiy guruh tanlanmagan', 400)
    if (!items?.length) throw new AppError('Kamida bitta qism kiriting', 400)

    for (const item of items) {
      if (!item.toBranchId) throw new AppError('Har bir qism uchun guruh tanlang', 400)
      if (item.toBranchId === fromBranchId) throw new AppError('Guruh o\'ziga jo\'nata olmaydi', 400)
    }

    const fromWarehouseId = await getEffectiveWarehouseId(fromBranchId)
    if (!fromWarehouseId) throw new AppError('Manba guruhining skladi topilmadi', 400)

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
        fromBranchId,
        toBranchId: item.toBranchId,
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
    const { fromBranchId, toBranchId, items, notes } = req.body as {
      fromBranchId: string
      toBranchId: string
      items: { sparePartId: string; quantity: number; notes?: string }[]
      notes?: string
    }

    if (!fromBranchId || !toBranchId) throw new AppError('Guruhlar tanlanmagan', 400)
    if (fromBranchId === toBranchId) throw new AppError('Bir xil guruhga taqsimot qilish mumkin emas', 400)
    if (!items?.length) throw new AppError('Kamida bitta ehtiyot qism tanlang', 400)

    const fromWarehouseId = await getEffectiveWarehouseId(fromBranchId)
    if (!fromWarehouseId) throw new AppError('Manba guruhining skladi topilmadi', 400)

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
        fromBranchId,
        toBranchId,
        sparePartId: item.sparePartId,
        quantity: Number(item.quantity),
        notes: item.notes || notes || null,
        status: 'pending',
      })),
    })

    res.status(201).json(successResponse({ count: created.count }, `${created.count} ta taqsimot yaratildi`))
  } catch (err) { next(err) }
}
