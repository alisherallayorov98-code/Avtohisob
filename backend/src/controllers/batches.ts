import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, resolveOrgId, getOrgWarehouseIds, BranchFilter } from '../lib/orgFilter'
import { sendToUser } from '../services/telegramBot'
import { generateQRDataUrl } from '../services/qrCodeService'

async function assertBatchAccess(filter: BranchFilter, fromWarehouseId: string, toWarehouseId: string) {
  if (filter.type === 'none') return
  const wIds = await getOrgWarehouseIds(filter)
  if (wIds === null) return
  if (!wIds.includes(fromWarehouseId) && !wIds.includes(toWarehouseId)) {
    throw new AppError("Bu jo'natmaga ruxsat yo'q", 403)
  }
}

async function genDocNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `TRF-${year}`
  const count = await prisma.transferBatch.count({
    where: { orgId, documentNumber: { startsWith: prefix } },
  })
  return `${prefix}-${String(count + 1).padStart(4, '0')}`
}

export async function getBatches(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { status } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const wIds = await getOrgWarehouseIds(filter)

    const where: any = {}
    if (status) where.status = status
    if (wIds !== null) {
      if (wIds.length === 0) return res.json({ success: true, data: [], meta: { total: 0, page, limit, totalPages: 0 } })
      where.OR = [{ fromWarehouseId: { in: wIds } }, { toWarehouseId: { in: wIds } }]
    }

    const [total, batches] = await Promise.all([
      prisma.transferBatch.count({ where }),
      prisma.transferBatch.findMany({
        where, skip, take: limit,
        include: {
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          shippedBy: { select: { id: true, fullName: true } },
          receivedBy: { select: { id: true, fullName: true } },
          createdBy: { select: { id: true, fullName: true } },
          request: { select: { id: true, documentNumber: true } },
          _count: { select: { transfers: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    res.json({ success: true, data: batches, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getBatch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const batch = await prisma.transferBatch.findUnique({
      where: { id: req.params.id },
      include: {
        fromWarehouse: { select: { id: true, name: true, location: true } },
        toWarehouse: { select: { id: true, name: true, location: true } },
        shippedBy: { select: { id: true, fullName: true } },
        receivedBy: { select: { id: true, fullName: true } },
        createdBy: { select: { id: true, fullName: true } },
        request: { select: { id: true, documentNumber: true } },
        transfers: {
          include: {
            sparePart: { select: { id: true, name: true, partCode: true, unitPrice: true } },
          },
        },
      },
    })
    if (!batch) throw new AppError("Jo'natma topilmadi", 404)
    const filter = await getOrgFilter(req.user!)
    await assertBatchAccess(filter, batch.fromWarehouseId, batch.toWarehouseId)
    res.json(successResponse(batch))
  } catch (err) { next(err) }
}

export async function getBatchQr(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const batch = await prisma.transferBatch.findUnique({
      where: { id: req.params.id },
      select: { id: true, documentNumber: true, fromWarehouseId: true, toWarehouseId: true, orgId: true, createdAt: true },
    })
    if (!batch) throw new AppError("Jo'natma topilmadi", 404)
    const filter = await getOrgFilter(req.user!)
    await assertBatchAccess(filter, batch.fromWarehouseId, batch.toWarehouseId)
    const dataUrl = await generateQRDataUrl({ doc: batch.documentNumber, id: batch.id, org: batch.orgId, ts: batch.createdAt } as any)
    res.json(successResponse({ qr: dataUrl, documentNumber: batch.documentNumber }))
  } catch (err) { next(err) }
}

export async function createBatch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromWarehouseId, toWarehouseId, items, notes, requestId } = req.body as {
      fromWarehouseId: string
      toWarehouseId: string
      items: { sparePartId: string; quantity: number }[]
      notes?: string
      requestId?: string
    }

    if (!fromWarehouseId || !toWarehouseId) throw new AppError('Omborlarni tanlang', 400)
    if (fromWarehouseId === toWarehouseId) throw new AppError('Bir xil omborga jo\'natish mumkin emas', 400)
    if (!items?.length) throw new AppError('Kamida bitta ehtiyot qism tanlang', 400)

    const filter = await getOrgFilter(req.user!)
    const allowedWIds = await getOrgWarehouseIds(filter)
    if (allowedWIds !== null && !allowedWIds.includes(fromWarehouseId)) {
      throw new AppError("Faqat o'z omboringizdan jo'natma yaratish mumkin", 403)
    }

    // Check inventory for all items
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
        throw new AppError(`"${name}" — kerak: ${qty}, mavjud: ${inv?.quantityOnHand ?? 0} ta`, 400)
      }
    }

    const orgId = await resolveOrgId(req.user!) ?? fromWarehouseId
    const documentNumber = await genDocNumber(orgId)

    const batch = await prisma.transferBatch.create({
      data: {
        documentNumber,
        orgId,
        fromWarehouseId,
        toWarehouseId,
        requestId: requestId || null,
        notes: notes || null,
        createdById: req.user!.id,
        status: 'pending',
        transfers: {
          create: items.map(item => ({
            fromWarehouseId,
            toWarehouseId,
            sparePartId: item.sparePartId,
            quantity: Number(item.quantity),
            notes: notes || null,
            status: 'pending',
          })),
        },
      },
      include: {
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        _count: { select: { transfers: true } },
      },
    })

    // If linked to a request, mark it as approved
    if (requestId) {
      await prisma.sparePartRequest.update({
        where: { id: requestId },
        data: { status: 'approved', respondedAt: new Date(), respondedById: req.user!.id },
      })
    }

    res.status(201).json(successResponse(batch, `Jo'natma ${documentNumber} yaratildi`))
  } catch (err) { next(err) }
}

export async function shipBatch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const batch = await prisma.transferBatch.findUnique({
      where: { id: req.params.id },
      include: {
        transfers: true,
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
      },
    })
    if (!batch) throw new AppError("Jo'natma topilmadi", 404)
    if (batch.status !== 'pending') throw new AppError("Faqat kutilayotgan jo'natmani yuborish mumkin", 400)

    const filter = await getOrgFilter(req.user!)
    await assertBatchAccess(filter, batch.fromWarehouseId, batch.toWarehouseId)

    // Entire flow inside single transaction: atomic status + inventory.
    // Prevents double-deduction if user double-clicks "Ship" button.
    await prisma.$transaction(async (tx) => {
      // Race-safe: only one "pending → shipped" transition succeeds
      const transition = await tx.transferBatch.updateMany({
        where: { id: batch.id, status: 'pending' },
        data: { status: 'shipped', shippedAt: new Date(), shippedById: req.user!.id },
      })
      if (transition.count === 0) {
        throw new AppError("Bu jo'natma allaqachon yuborilgan yoki bekor qilingan", 400)
      }

      // Deduct inventory atomically (gte check prevents negative stock)
      for (const transfer of batch.transfers) {
        const deducted = await tx.inventory.updateMany({
          where: {
            sparePartId: transfer.sparePartId,
            warehouseId: batch.fromWarehouseId,
            quantityOnHand: { gte: transfer.quantity },
          },
          data: { quantityOnHand: { decrement: transfer.quantity } },
        })
        if (deducted.count === 0) {
          const part = await tx.sparePart.findUnique({ where: { id: transfer.sparePartId }, select: { name: true } })
          throw new AppError(`"${part?.name || transfer.sparePartId}" uchun omborda yetarli miqdor yo'q`, 400)
        }
      }

      await tx.inventoryTransfer.updateMany({
        where: { batchId: batch.id },
        data: { status: 'shipped' },
      })
    })

    // Telegram notification to branch manager of receiving branch
    try {
      const receivingBranch = await prisma.branch.findFirst({
        where: { warehouseId: batch.toWarehouseId },
        select: { managerId: true, name: true },
      })
      if (receivingBranch?.managerId) {
        const msg = `📦 Jo'natma yuborildi!\n\n📄 Hujjat: ${batch.documentNumber}\n🏭 Qayerdan: ${batch.fromWarehouse.name}\n🏢 Qayerga: ${batch.toWarehouse.name}\n📦 Qismlar: ${batch.transfers.length} ta\n\nQabul qilish uchun tizimga kiring.`
        await sendToUser(receivingBranch.managerId, msg)
      }
    } catch (_) { /* Telegram xatosi asosiy operatsiyani to'xtatmasin */ }

    res.json(successResponse(null, `Jo'natma ${batch.documentNumber} yuborildi`))
  } catch (err) { next(err) }
}

export async function receiveBatch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const batch = await prisma.transferBatch.findUnique({
      where: { id: req.params.id },
      include: { transfers: true },
    })
    if (!batch) throw new AppError("Jo'natma topilmadi", 404)
    if (batch.status !== 'shipped') throw new AppError("Faqat jo'natilgan jo'natmani qabul qilish mumkin", 400)

    const filter = await getOrgFilter(req.user!)
    await assertBatchAccess(filter, batch.fromWarehouseId, batch.toWarehouseId)

    // Single atomic transaction: status transition + inventory increment.
    // Race-safe via updateMany status check.
    await prisma.$transaction(async (tx) => {
      const transition = await tx.transferBatch.updateMany({
        where: { id: batch.id, status: 'shipped' },
        data: { status: 'received', receivedAt: new Date(), receivedById: req.user!.id },
      })
      if (transition.count === 0) {
        throw new AppError("Bu jo'natma allaqachon qabul qilingan yoki yuborilmagan", 400)
      }
      await tx.inventoryTransfer.updateMany({
        where: { batchId: batch.id },
        data: { status: 'received' },
      })
      for (const transfer of batch.transfers) {
        await tx.inventory.upsert({
          where: { sparePartId_warehouseId: { sparePartId: transfer.sparePartId, warehouseId: batch.toWarehouseId } },
          update: { quantityOnHand: { increment: transfer.quantity } },
          create: { sparePartId: transfer.sparePartId, warehouseId: batch.toWarehouseId, quantityOnHand: transfer.quantity, reorderLevel: 5 },
        })
      }
    })

    // Mark linked request as fulfilled if it exists
    if (batch.requestId) {
      await prisma.sparePartRequest.update({
        where: { id: batch.requestId },
        data: { status: 'fulfilled', fulfilledAt: new Date() },
      }).catch(() => {})
    }

    // Telegram: jo'natuvchi branch manageriga xabar
    try {
      const fullBatch = await prisma.transferBatch.findUnique({
        where: { id: batch.id },
        include: {
          fromWarehouse: { select: { name: true } },
          toWarehouse: { select: { name: true } },
        },
      })
      const senderBranch = await prisma.branch.findFirst({
        where: { warehouseId: batch.fromWarehouseId },
        select: { managerId: true },
      })
      if (senderBranch?.managerId && fullBatch) {
        const msg = `✅ Jo'natmangiz qabul qilindi!\n\n📄 ${batch.documentNumber}\n🏭 Qayerdan: ${fullBatch.fromWarehouse.name}\n🏢 Qayerga: ${fullBatch.toWarehouse.name}\n📦 ${batch.transfers.length} ta qism\n\n${new Date().toLocaleDateString('uz-UZ')} kuni qabul qilindi.`
        await sendToUser(senderBranch.managerId, msg).catch(() => {})
      }
    } catch (_) {}

    res.json(successResponse(null, `Jo'natma ${batch.documentNumber} qabul qilindi`))
  } catch (err) { next(err) }
}
