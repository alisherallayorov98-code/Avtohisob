import { Response, NextFunction } from 'express'
import { AuthRequest } from '../middleware/auth'
import { prisma } from '../lib/prisma'

async function generateTicketNumber(): Promise<string> {
  const count = await (prisma as any).supportTicket.count()
  return `#${String(count + 1).padStart(5, '0')}`
}

export async function listTickets(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', status, priority, category } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager'

    const where: any = {}
    // Non-admins only see their own tickets
    if (!isAdmin) where.userId = req.user!.id
    if (status) where.status = status
    if (priority) where.priority = priority
    if (category) where.category = category

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
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager'
    const where: any = { id: req.params.id }
    if (!isAdmin) where.userId = req.user!.id

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

    const ticketNumber = await generateTicketNumber()
    const ticket = await (prisma as any).supportTicket.create({
      data: {
        ticketNumber,
        userId: req.user!.id,
        subject, description,
        category: category || 'technical',
        priority: priority || 'medium',
        attachmentUrl: attachmentUrl || null,
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

    const ticket = await (prisma as any).supportTicket.findUnique({ where: { id } })
    if (!ticket) return res.status(404).json({ error: 'Topilmadi' })
    if (!isStaff && ticket.userId !== req.user!.id) return res.status(403).json({ error: 'Ruxsat yo\'q' })

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
    const [open, inProgress, resolved, closed, total] = await Promise.all([
      (prisma as any).supportTicket.count({ where: { status: 'open' } }),
      (prisma as any).supportTicket.count({ where: { status: 'in_progress' } }),
      (prisma as any).supportTicket.count({ where: { status: 'resolved' } }),
      (prisma as any).supportTicket.count({ where: { status: 'closed' } }),
      (prisma as any).supportTicket.count(),
    ])
    const urgent = await (prisma as any).supportTicket.count({ where: { priority: 'urgent', status: { in: ['open', 'in_progress'] } } })
    res.json({ data: { total, open, inProgress, resolved, closed, urgent } })
  } catch (err) { next(err) }
}
