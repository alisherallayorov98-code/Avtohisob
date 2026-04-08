import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

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
    if (fromBranchId === toBranchId) throw new AppError('Bir xil filialga taqsimot qilish mumkin emas', 400)
    const inventory = await prisma.inventory.findUnique({
      where: { sparePartId_branchId: { sparePartId, branchId: fromBranchId } },
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
    const inventory = await prisma.inventory.findUnique({
      where: { sparePartId_branchId: { sparePartId: t.sparePartId, branchId: t.fromBranchId } },
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
    const existing = await prisma.inventory.findUnique({
      where: { sparePartId_branchId: { sparePartId: t.sparePartId, branchId: t.toBranchId } },
    })
    await prisma.$transaction([
      prisma.inventoryTransfer.update({ where: { id: t.id }, data: { status: 'received' } }),
      existing
        ? prisma.inventory.update({ where: { id: existing.id }, data: { quantityOnHand: existing.quantityOnHand + t.quantity } })
        : prisma.inventory.create({ data: { sparePartId: t.sparePartId, branchId: t.toBranchId, quantityOnHand: t.quantity, reorderLevel: 5 } }),
    ])
    res.json(successResponse(null, 'Taqsimot qabul qilindi'))
  } catch (err) { next(err) }
}
