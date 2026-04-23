import { Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { prisma } from '../lib/prisma'
import { getSearchVariants } from '../lib/transliterate'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

async function generateTicketNumber(): Promise<string> {
  const count = await (prisma as any).supportTicket.count()
  return `#${String(count + 1).padStart(5, '0')}`
}

export async function listTickets(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', status, priority, category, search } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const stFilter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(stFilter)

    const where: any = {}
    if (stFilter.type === 'none') {
      // super_admin: see all tickets
    } else if (bv !== undefined) {
      // org admin: see only tickets from their org's users
      where.user = { branchId: bv }
    } else {
      // branch_manager / operator: own tickets only
      where.userId = req.user!.id
    }
    if (status) where.status = status
    if (priority) where.priority = priority
    if (category) where.category = category
    if (search) {
      const variants = getSearchVariants(search)
      where.OR = variants.flatMap(v => [
        { ticketNumber: { contains: v, mode: 'insensitive' } },
        { subject: { contains: v, mode: 'insensitive' } },
        { user: { fullName: { contains: v, mode: 'insensitive' } } },
      ])
    }

    const [total, items] = await Promise.all([
      (prisma as any).supportTicket.count({ where }),
      (prisma as any).supportTicket.findMany({
        where, skip, take: parseInt(limit),
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          replies: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { replies: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    ])

    res.json({ data: items, meta: { total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function getTicket(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const gtFilter = await getOrgFilter(req.user!)
    const gtBv = applyBranchFilter(gtFilter)
    const where: any = { id: req.params.id }
    if (gtFilter.type === 'none') {
      // super_admin: any ticket
    } else if (gtBv !== undefined) {
      where.user = { branchId: gtBv }
    } else {
      where.userId = req.user!.id
    }

    const ticket = await (prisma as any).supportTicket.findFirst({
      where,
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        replies: {
          include: { user: { select: { id: true, fullName: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      }
    })
    if (!ticket) return res.status(404).json({ error: 'Topilmadi' })
    res.json({ data: ticket })
  } catch (err) { next(err) }
}

export async function createTicket(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { subject, description, category, priority, attachmentUrl } = req.body
    if (!subject?.trim()) return res.status(400).json({ error: 'Mavzu kiritilishi shart' })

    // attachmentUrl must be a relative path from our own uploads directory only
    let safeAttachmentUrl: string | null = null
    if (attachmentUrl) {
      const normalized = String(attachmentUrl).replace(/\\/g, '/')
      if (/^\/uploads\/[a-zA-Z0-9._-]+$/.test(normalized)) {
        safeAttachmentUrl = normalized
      }
    }

    const ticketNumber = await generateTicketNumber()
    const ticket = await (prisma as any).supportTicket.create({
      data: {
        ticketNumber,
        userId: req.user!.id,
        subject: String(subject).slice(0, 255).trim(),
        description: description ? String(description).slice(0, 5000) : null,
        category: category || 'technical',
        priority: priority || 'medium',
        attachmentUrl: safeAttachmentUrl,
      },
      include: { user: { select: { id: true, fullName: true, email: true } } }
    })
    res.status(201).json({ data: ticket })
  } catch (err) { next(err) }
}

export async function replyTicket(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { message } = req.body
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'manager'

    const ticket = await (prisma as any).supportTicket.findUnique({
      where: { id },
      include: { user: { select: { branchId: true } } },
    })
    if (!ticket) return res.status(404).json({ error: 'Topilmadi' })
    if (!isStaff && ticket.userId !== req.user!.id) return res.status(403).json({ error: 'Ruxsat yo\'q' })

    // Org-scoped staff: admin/manager can only reply to their own org's tickets
    if (isStaff && req.user!.role !== 'super_admin') {
      const rtFilter = await getOrgFilter(req.user!)
      const rtBv = applyBranchFilter(rtFilter)
      if (rtBv !== undefined) {
        const ticketBranchId = ticket.user?.branchId
        const allowed = typeof rtBv === 'string'
          ? ticketBranchId === rtBv
          : Array.isArray((rtBv as any)?.in) ? (rtBv as any).in.includes(ticketBranchId) : true
        if (!allowed) return res.status(403).json({ error: 'Ruxsat yo\'q' })
      }
    }

    const reply = await (prisma as any).ticketReply.create({
      data: { ticketId: id, userId: req.user!.id, message, isStaff },
      include: { user: { select: { id: true, fullName: true, role: true } } }
    })

    // If staff replies, mark as in_progress
    if (isStaff && ticket.status === 'open') {
      await (prisma as any).supportTicket.update({ where: { id }, data: { status: 'in_progress' } })
    }

    res.status(201).json({ data: reply })
  } catch (err) { next(err) }
}

export async function updateTicketStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { status, resolution, assignedTo } = req.body

    // Verify ticket exists and caller has access to it
    const utFilter = await getOrgFilter(req.user!)
    const utBv = applyBranchFilter(utFilter)
    const utWhere: any = { id }
    if (utFilter.type !== 'none' && utBv !== undefined) {
      utWhere.user = { branchId: utBv }
    }
    const existing = await (prisma as any).supportTicket.findFirst({ where: utWhere, select: { id: true } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi yoki ruxsat yo\'q' })

    const data: any = {}
    if (status) data.status = status
    if (resolution !== undefined) data.resolution = resolution
    if (assignedTo !== undefined) data.assignedTo = assignedTo
    if (status === 'resolved' || status === 'closed') data.closedAt = new Date()

    const ticket = await (prisma as any).supportTicket.update({ where: { id }, data })
    res.json({ data: ticket })
  } catch (err) { next(err) }
}

export async function getTicketStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tsFilter = await getOrgFilter(req.user!)
    const tsBv = applyBranchFilter(tsFilter)
    // Scope ticket queries to the user's org (or all for super_admin)
    const orgWhere = tsBv !== undefined ? { user: { branchId: tsBv } } : {}

    const [open, inProgress, resolved, closed, total] = await Promise.all([
      (prisma as any).supportTicket.count({ where: { ...orgWhere, status: 'open' } }),
      (prisma as any).supportTicket.count({ where: { ...orgWhere, status: 'in_progress' } }),
      (prisma as any).supportTicket.count({ where: { ...orgWhere, status: 'resolved' } }),
      (prisma as any).supportTicket.count({ where: { ...orgWhere, status: 'closed' } }),
      (prisma as any).supportTicket.count({ where: orgWhere }),
    ])
    const urgent = await (prisma as any).supportTicket.count({ where: { ...orgWhere, priority: 'urgent', status: { in: ['open', 'in_progress'] } } })
    res.json({ data: { total, open, inProgress, resolved, closed, urgent } })
  } catch (err) { next(err) }
}
