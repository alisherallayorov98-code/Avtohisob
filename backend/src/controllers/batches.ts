import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, resolveOrgId, getOrgWarehouseIds, BranchFilter } from '../lib/orgFilter'
import { sendToUser } from '../services/telegramBot'
import { generateQRDataUrl } from '../services/qrCodeService'
import { getSearchVariants } from '../lib/transliterate'
import { normalizeItems, canActOnBatch, resolveReceived, BatchAction } from '../lib/transferRules'
import { withUniqueDocNumber } from '../lib/docNumber'

async function assertBatchAccess(filter: BranchFilter, fromWarehouseId: string, toWarehouseId: string) {
  if (filter.type === 'none') return
  const wIds = await getOrgWarehouseIds(filter)
  if (wIds === null) return
  if (!wIds.includes(fromWarehouseId) && !wIds.includes(toWarehouseId)) {
    throw new AppError("Bu jo'natmaga ruxsat yo'q", 403)
  }
}

// Yuborish — jo'natuvchi ombor tomoni, qabul qilish/rad etish — qabul qiluvchi ombor tomoni (lib/transferRules.ts)
async function assertBatchAction(filter: BranchFilter, action: BatchAction, fromWarehouseId: string, toWarehouseId: string) {
  const allowed = await getOrgWarehouseIds(filter)
  if (!canActOnBatch(action, allowed, fromWarehouseId, toWarehouseId)) {
    const msg = action === 'ship'
      ? "Jo'natmani faqat jo'natuvchi ombor tomoni yubora oladi"
      : action === 'receive'
        ? "Jo'natmani faqat qabul qiluvchi ombor tomoni qabul qila oladi"
        : "Jo'natmani faqat qabul qiluvchi ombor tomoni rad eta oladi"
    throw new AppError(msg, 403)
  }
}

// Adminlarga bildirishnoma (kamomad kabi e'tibor talab qiladigan holatlar uchun)
async function notifyOrgAdmins(orgId: string, warehouseIds: string[], title: string, message: string, link: string) {
  try {
    const branches = await prisma.branch.findMany({
      where: { OR: [{ organizationId: orgId }, { warehouseId: { in: warehouseIds } }] },
      select: { id: true },
    })
    const users = await prisma.user.findMany({
      where: { isActive: true, role: { in: ['admin', 'manager'] }, branchId: { in: branches.map(b => b.id) } },
      select: { id: true },
    })
    if (users.length) {
      await prisma.notification.createMany({ data: users.map(u => ({ userId: u.id, title, message, type: 'warning', link })) })
    }
  } catch (_) { /* bildirishnoma xatosi asosiy amalni to'xtatmasin */ }
}

export async function getBatches(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { status, q, incoming } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const wIds = await getOrgWarehouseIds(filter)

    const where: any = {}
    if (status) where.status = status
    if (wIds !== null) {
      if (wIds.length === 0) return res.json({ success: true, data: [], meta: { total: 0, page, limit, totalPages: 0 } })
      where.OR = [{ fromWarehouseId: { in: wIds } }, { toWarehouseId: { in: wIds } }]
    }
    // "Sizga kelayotganlar": yo'ldagi va qabul qiluvchi ombor tomoni men
    if (incoming === '1') {
      where.status = 'shipped'
      if (wIds !== null) where.toWarehouseId = { in: wIds }
    }
    // Qidiruv: hujjat raqami, ombor, qism nomi/kodi (lotin ↔ kirill)
    const qs = typeof q === 'string' ? q.trim() : ''
    if (qs) {
      const variants = getSearchVariants(qs)
      const ors: any[] = []
      for (const v of variants) {
        ors.push(
          { documentNumber: { contains: v, mode: 'insensitive' } },
          { fromWarehouse: { name: { contains: v, mode: 'insensitive' } } },
          { toWarehouse: { name: { contains: v, mode: 'insensitive' } } },
          { transfers: { some: { sparePart: { OR: [{ name: { contains: v, mode: 'insensitive' } }, { partCode: { contains: v, mode: 'insensitive' } }] } } } },
        )
      }
      where.AND = [{ OR: ors }]
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
          transfers: { select: { quantity: true, receivedQuantity: true, sparePart: { select: { name: true, partCode: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    const data = batches.map(b => ({
      ...b,
      canShip: canActOnBatch('ship', wIds, b.fromWarehouseId, b.toWarehouseId),
      canReceive: canActOnBatch('receive', wIds, b.fromWarehouseId, b.toWarehouseId),
      hasShortage: b.status === 'received' && b.transfers.some(t => t.receivedQuantity != null && t.receivedQuantity < t.quantity),
    }))
    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
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
    const wIds = await getOrgWarehouseIds(filter)
    res.json(successResponse({
      ...batch,
      canShip: canActOnBatch('ship', wIds, batch.fromWarehouseId, batch.toWarehouseId),
      canReceive: canActOnBatch('receive', wIds, batch.fromWarehouseId, batch.toWarehouseId),
    }))
  } catch (err) { next(err) }
}

// GET /batches/stats — holat kartalari: kutmoqda / yo'lda / qabul qilingan, sizga kelayotgan, uzoq yo'lda turgan
export async function getBatchStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const wIds = await getOrgWarehouseIds(filter)
    const scope: any = {}
    if (wIds !== null) {
      if (wIds.length === 0) return res.json(successResponse({ pending: 0, shipped: 0, received: 0, closed: 0, incoming: 0, stale: 0, shortage: 0 }))
      scope.OR = [{ fromWarehouseId: { in: wIds } }, { toWarehouseId: { in: wIds } }]
    }
    const staleBefore = new Date(Date.now() - 3 * 86400000)
    const [pending, shipped, received, closed, incoming, stale, shortage] = await Promise.all([
      prisma.transferBatch.count({ where: { ...scope, status: 'pending' } }),
      prisma.transferBatch.count({ where: { ...scope, status: 'shipped' } }),
      prisma.transferBatch.count({ where: { ...scope, status: 'received' } }),
      prisma.transferBatch.count({ where: { ...scope, status: { in: ['cancelled', 'rejected'] } } }),
      prisma.transferBatch.count({ where: { status: 'shipped', ...(wIds !== null ? { toWarehouseId: { in: wIds } } : {}) } }),
      prisma.transferBatch.count({ where: { ...scope, status: 'shipped', shippedAt: { lt: staleBefore } } }),
      prisma.transferBatch.count({ where: { ...scope, status: 'received', transfers: { some: { receivedQuantity: { not: null } } } } }),
    ])
    res.json(successResponse({ pending, shipped, received, closed, incoming, stale, shortage }))
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
    // Miqdor: butun son >= 1; bir qismning takroriy qatorlari yig'iladi (manfiy miqdor zaxirani buzar edi)
    const norm = normalizeItems(items)
    if (norm.error) throw new AppError(norm.error, 400)
    const cleanItems = norm.items

    const filter = await getOrgFilter(req.user!)
    const allowedWIds = await getOrgWarehouseIds(filter)
    // Multi-tenant: from VA to omborlar — har ikkalasi ham o'z org'da bo'lishi shart.
    if (allowedWIds !== null) {
      if (!allowedWIds.includes(fromWarehouseId)) {
        throw new AppError("Faqat o'z omboringizdan jo'natma yaratish mumkin", 403)
      }
      if (!allowedWIds.includes(toWarehouseId)) {
        throw new AppError("Maqsad ombor sizning tashkilotingizga tegishli emas", 403)
      }
    }

    // Check inventory for all items
    const inventoryChecks = await Promise.all(
      cleanItems.map(item =>
        prisma.inventory.findUnique({
          where: { sparePartId_warehouseId: { sparePartId: item.sparePartId, warehouseId: fromWarehouseId } },
          include: { sparePart: { select: { name: true } } },
        })
      )
    )
    for (let i = 0; i < cleanItems.length; i++) {
      const inv = inventoryChecks[i]
      const qty = cleanItems[i].quantity
      if (!inv || inv.quantityOnHand < qty) {
        const name = inv?.sparePart?.name || cleanItems[i].sparePartId
        throw new AppError(`"${name}" — kerak: ${qty}, mavjud: ${inv?.quantityOnHand ?? 0} ta`, 400)
      }
    }

    const orgId = await resolveOrgId(req.user!) ?? fromWarehouseId
    const prefix = `TRF-${new Date().getFullYear()}`

    // Hujjat raqami butun bazada noyob; boshqa so'rov tezroq olsa avtomatik qayta uriniladi
    const batch = await withUniqueDocNumber(
      prefix,
      async () => (await prisma.transferBatch.findFirst({
        where: { documentNumber: { startsWith: prefix } },
        orderBy: { documentNumber: 'desc' },
        select: { documentNumber: true },
      }))?.documentNumber,
      (documentNumber) => prisma.transferBatch.create({
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
            create: cleanItems.map(item => ({
              fromWarehouseId,
              toWarehouseId,
              sparePartId: item.sparePartId,
              quantity: item.quantity,
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
      }),
    )
    const documentNumber = batch.documentNumber

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
    await assertBatchAction(filter, 'ship', batch.fromWarehouseId, batch.toWarehouseId)

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
    await assertBatchAction(filter, 'receive', batch.fromWarehouseId, batch.toWarehouseId)

    // Haqiqiy kelgan miqdorlar (berilmasa — hammasi to'liq). Kamomad bo'lsa sabab majburiy.
    const { items: receivedInput, notes: receiveNotesRaw } = (req.body || {}) as { items?: any[]; notes?: string }
    const rv = resolveReceived(batch.transfers.map(t => ({ id: t.id, quantity: t.quantity })), receivedInput)
    if (rv.error) throw new AppError(rv.error, 400)
    const receiveNotes = typeof receiveNotesRaw === 'string' ? receiveNotesRaw.trim() : ''
    if (rv.shortage > 0 && !receiveNotes) throw new AppError('Kamomad bor — sababini yozing (masalan: yo\'lda shikastlangan, kam keltirilgan)', 400)

    // Single atomic transaction: status transition + inventory increment.
    // Race-safe via updateMany status check.
    await prisma.$transaction(async (tx) => {
      const transition = await tx.transferBatch.updateMany({
        where: { id: batch.id, status: 'shipped' },
        data: { status: 'received', receivedAt: new Date(), receivedById: req.user!.id, receiveNotes: receiveNotes || null },
      })
      if (transition.count === 0) {
        throw new AppError("Bu jo'natma allaqachon qabul qilingan yoki yuborilmagan", 400)
      }
      for (const row of rv.rows) {
        await tx.inventoryTransfer.update({ where: { id: row.id }, data: { status: 'received', receivedQuantity: row.received } })
        if (row.received <= 0) continue
        const tr = batch.transfers.find(t => t.id === row.id)!
        await tx.inventory.upsert({
          where: { sparePartId_warehouseId: { sparePartId: tr.sparePartId, warehouseId: batch.toWarehouseId } },
          update: { quantityOnHand: { increment: row.received } },
          create: { sparePartId: tr.sparePartId, warehouseId: batch.toWarehouseId, quantityOnHand: row.received, reorderLevel: 5 },
        })
      }
    })

    // Kamomad — adminlarga bildirishnoma (zaxira yuboruvchiga avtomatik qaytarilmaydi; admin hal qiladi)
    if (rv.shortage > 0) {
      await notifyOrgAdmins(
        batch.orgId, [batch.fromWarehouseId, batch.toWarehouseId],
        `Jo'natmada kamomad: ${batch.documentNumber}`,
        `${req.user!.fullName} jo'natmani qabul qildi, lekin jami ${rv.shortage} ta qism kam keldi. Sabab: ${receiveNotes}`,
        '/transfers',
      )
    }

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

/**
 * Bekor qilish (cancel) — pending statusdagi jo'natmani to'xtatish.
 * Inventarga ta'sir yo'q (chunki hali shipped emas).
 * Ham yuboruvchi, ham qabul qiluvchi (yoki har qanday access'i bor user) bekor qila oladi.
 */
export async function cancelBatch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reason } = req.body || {}
    const batch = await prisma.transferBatch.findUnique({ where: { id: req.params.id } })
    if (!batch) throw new AppError("Jo'natma topilmadi", 404)
    if (batch.status !== 'pending') {
      throw new AppError("Faqat kutayotgan jo'natmani bekor qilish mumkin", 400)
    }

    const filter = await getOrgFilter(req.user!)
    await assertBatchAccess(filter, batch.fromWarehouseId, batch.toWarehouseId)

    // Race-safe: faqat hali "pending" bo'lsa o'tkazamiz
    const transition = await prisma.transferBatch.updateMany({
      where: { id: batch.id, status: 'pending' },
      data: { status: 'cancelled', notes: reason ? `${batch.notes || ''}\n[Bekor qilindi: ${reason}]`.trim() : batch.notes },
    })
    if (transition.count === 0) {
      throw new AppError("Bu jo'natma allaqachon ko'rib chiqilgan yoki yuborilgan", 400)
    }

    await prisma.inventoryTransfer.updateMany({
      where: { batchId: batch.id },
      data: { status: 'cancelled' },
    })

    res.json(successResponse(null, `Jo'natma ${batch.documentNumber} bekor qilindi`))
  } catch (err) { next(err) }
}

/**
 * Rad etish (reject) — qabul qiluvchi shipped jo'natmani rad etadi.
 * Inventory: yuboruvchi omboriga qaytariladi (ship bosqichida ayrilgan miqdor).
 * Tashlab yuborish — pending'ni reject qilish o'rniga cancel ishlatiladi.
 */
export async function rejectBatch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reason } = req.body || {}
    if (!reason?.trim()) throw new AppError("Rad etish sababi kiritilishi shart", 400)

    const batch = await prisma.transferBatch.findUnique({
      where: { id: req.params.id },
      include: { transfers: true, fromWarehouse: { select: { name: true } }, toWarehouse: { select: { name: true } } },
    })
    if (!batch) throw new AppError("Jo'natma topilmadi", 404)
    if (batch.status !== 'shipped') {
      throw new AppError("Faqat yuborilgan (lekin qabul qilinmagan) jo'natmani rad etish mumkin", 400)
    }

    const filter = await getOrgFilter(req.user!)
    await assertBatchAccess(filter, batch.fromWarehouseId, batch.toWarehouseId)
    await assertBatchAction(filter, 'reject', batch.fromWarehouseId, batch.toWarehouseId)

    await prisma.$transaction(async (tx) => {
      // Race-safe transition: faqat "shipped" → "rejected"
      const transition = await tx.transferBatch.updateMany({
        where: { id: batch.id, status: 'shipped' },
        data: {
          status: 'rejected',
          notes: `${batch.notes || ''}\n[Rad etildi: ${reason}]`.trim(),
        },
      })
      if (transition.count === 0) {
        throw new AppError("Bu jo'natma allaqachon ko'rib chiqilgan", 400)
      }

      // Inventory'ni yuboruvchi omboriga qaytarish
      for (const transfer of batch.transfers) {
        await tx.inventory.upsert({
          where: { sparePartId_warehouseId: { sparePartId: transfer.sparePartId, warehouseId: batch.fromWarehouseId } },
          update: { quantityOnHand: { increment: transfer.quantity } },
          create: { sparePartId: transfer.sparePartId, warehouseId: batch.fromWarehouseId, quantityOnHand: transfer.quantity, reorderLevel: 5 },
        })
      }

      await tx.inventoryTransfer.updateMany({
        where: { batchId: batch.id },
        data: { status: 'rejected' },
      })
    })

    // Telegram: yuboruvchi branch manageriga xabar
    try {
      const senderBranch = await prisma.branch.findFirst({
        where: { warehouseId: batch.fromWarehouseId },
        select: { managerId: true },
      })
      if (senderBranch?.managerId) {
        const msg = `❌ Jo'natma rad etildi!\n\n📄 ${batch.documentNumber}\n🏭 ${batch.fromWarehouse.name} → ${batch.toWarehouse.name}\n\n💬 Sabab: ${reason}\n\nInventar omboringizga qaytarildi.`
        await sendToUser(senderBranch.managerId, msg).catch(() => {})
      }
    } catch (_) {}

    res.json(successResponse(null, `Jo'natma ${batch.documentNumber} rad etildi va inventar qaytarildi`))
  } catch (err) { next(err) }
}
