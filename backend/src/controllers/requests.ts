import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, resolveOrgId, applyBranchFilter } from '../lib/orgFilter'
import { sendToUser } from '../services/telegramBot'

async function genReqNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `REQ-${year}`
  const count = await prisma.sparePartRequest.count({
    where: { orgId, documentNumber: { startsWith: prefix } },
  })
  return `${prefix}-${String(count + 1).padStart(4, '0')}`
}

export async function getRequests(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { status } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)

    const where: any = {}
    if (status) where.status = status
    if (branchFilter !== undefined) {
      if (typeof branchFilter === 'string') {
        where.branchId = branchFilter
      } else if (branchFilter && 'in' in branchFilter) {
        where.branchId = branchFilter
      }
    }

    const [total, requests] = await Promise.all([
      prisma.sparePartRequest.count({ where }),
      prisma.sparePartRequest.findMany({
        where, skip, take: limit,
        include: {
          requestedBy: { select: { id: true, fullName: true } },
          respondedBy: { select: { id: true, fullName: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    res.json({ success: true, data: requests, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const request = await prisma.sparePartRequest.findUnique({
      where: { id: req.params.id },
      include: {
        requestedBy: { select: { id: true, fullName: true } },
        respondedBy: { select: { id: true, fullName: true } },
        items: {
          include: { sparePart: { select: { id: true, name: true, partCode: true } } },
        },
        batches: {
          select: { id: true, documentNumber: true, status: true, createdAt: true },
        },
      },
    })
    if (!request) throw new AppError("So'rov topilmadi", 404)
    const filter = await getOrgFilter(req.user!)
    if (filter.type === 'single' && filter.branchId !== request.branchId) {
      throw new AppError("Bu so'rovga ruxsat yo'q", 403)
    }
    if (filter.type === 'org' && !filter.orgBranchIds.includes(request.branchId)) {
      throw new AppError("Bu so'rovga ruxsat yo'q", 403)
    }
    res.json(successResponse(request))
  } catch (err) { next(err) }
}

export async function createRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { notes, urgency, items } = req.body as {
      notes?: string
      urgency?: string
      items: { sparePartId?: string; partName: string; partCode?: string; quantity: number; reason?: string }[]
    }

    if (!items?.length) throw new AppError("Kamida bitta qism kiriting", 400)
    if (!req.user?.branchId) throw new AppError("Filial aniqlanmadi", 400)

    const orgId = await resolveOrgId(req.user!) ?? req.user.branchId
    const documentNumber = await genReqNumber(orgId)

    const request = await prisma.sparePartRequest.create({
      data: {
        documentNumber,
        orgId,
        branchId: req.user.branchId,
        requestedById: req.user.id,
        notes: notes || null,
        urgency: urgency || 'medium',
        status: 'pending',
        items: {
          create: items.map(it => ({
            sparePartId: it.sparePartId || null,
            partName: it.partName,
            partCode: it.partCode || null,
            quantity: Number(it.quantity),
            reason: it.reason || null,
          })),
        },
      },
      include: {
        items: { include: { sparePart: { select: { name: true, partCode: true } } } },
        requestedBy: { select: { fullName: true } },
      },
    })

    // Telegram: faqat shu org admin/managerlarga xabar
    try {
      const urgencyLabel: Record<string, string> = { low: '🟢 Past', medium: '🟡 O\'rta', high: '🔴 Yuqori' }
      // Bir xil orgga tegishli branchlar
      const orgBranches = await prisma.branch.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      })
      const orgBranchIds = orgBranches.map(b => b.id)
      const managers = await prisma.user.findMany({
        where: {
          role: { in: ['admin', 'manager'] },
          isActive: true,
          branchId: { in: orgBranchIds },
          telegramLinks: { some: {} },
        },
        select: { id: true },
      })
      const msg = `📋 Yangi ehtiyot qism so'rovi!\n\n📄 ${documentNumber}\n⚡ Muhimlik: ${urgencyLabel[request.urgency || 'medium'] || request.urgency}\n👤 ${request.requestedBy.fullName}\n📦 ${request.items.length} ta qism\n\nKo'rish uchun tizimga kiring.`
      await Promise.all(managers.map(m => sendToUser(m.id, msg).catch(() => {})))
    } catch (_) {}

    res.status(201).json(successResponse(request, `So'rov ${documentNumber} yaratildi`))
  } catch (err) { next(err) }
}

export async function respondToRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status, responseNotes } = req.body as { status: string; responseNotes?: string }
    if (!['approved', 'rejected'].includes(status)) throw new AppError("Noto'g'ri holat", 400)

    const request = await prisma.sparePartRequest.findUnique({ where: { id: req.params.id } })
    if (!request) throw new AppError("So'rov topilmadi", 404)
    if (request.status !== 'pending') throw new AppError("Faqat kutilayotgan so'rovga javob berish mumkin", 400)

    const filter = await getOrgFilter(req.user!)
    if (filter.type === 'single' && filter.branchId !== request.branchId) {
      throw new AppError("Bu so'rovga ruxsat yo'q", 403)
    }

    const updated = await prisma.sparePartRequest.update({
      where: { id: req.params.id },
      data: {
        status,
        responseNotes: responseNotes || null,
        respondedAt: new Date(),
        respondedById: req.user!.id,
      },
    })
    // Telegram: so'rov yaratuvchiga xabar
    try {
      const icon = status === 'approved' ? '✅' : '❌'
      const label = status === 'approved' ? 'Tasdiqlandi' : 'Rad etildi'
      const msg = `${icon} So'rovingiz ${label.toLowerCase()}!\n\n📄 ${request.documentNumber}\n${responseNotes ? `💬 Izoh: ${responseNotes}` : ''}\n\nTizimga kiring.`
      await sendToUser(request.requestedById, msg).catch(() => {})
    } catch (_) {}

    res.json(successResponse(updated, status === 'approved' ? 'Tasdiqlandi' : 'Rad etildi'))
  } catch (err) { next(err) }
}
