import { Response, NextFunction } from 'express'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'
import { getSearchVariants } from '../../lib/transliterate'

export async function listAdminTickets(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status, priority, search, page = '1', limit = '20' } = req.query
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string)
    const where: any = {}
    if (status) where.status = status
    if (priority) where.priority = priority
    if (search) {
      const variants = getSearchVariants(search as string)
      where.OR = variants.flatMap(v => [
        { subject: { contains: v, mode: 'insensitive' } },
        { ticketNumber: { contains: v, mode: 'insensitive' } },
      ])
    }

    const [tickets, total, stats] = await Promise.all([
      (prisma as any).supportTicket.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { fullName: true, email: true, branch: { select: { name: true } } } },
          _count: { select: { replies: true } },
        },
      }),
      (prisma as any).supportTicket.count({ where }),
      (prisma as any).supportTicket.groupBy({
        by: ['status'],
        _count: true,
      }),
    ])

    res.json({
      success: true,
      data: tickets,
      stats: Object.fromEntries(stats.map((s: any) => [s.status, s._count])),
      pagination: { total, page: parseInt(page as string), limit: parseInt(limit as string), pages: Math.ceil(total / parseInt(limit as string)) },
    })
  } catch (err) { next(err) }
}

export async function getAdminTicket(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ticket = await (prisma as any).supportTicket.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true, branch: { select: { name: true } } } },
        replies: {
          include: { user: { select: { fullName: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket topilmadi' })
    res.json({ success: true, data: ticket })
  } catch (err) { next(err) }
}

export async function replyAdminTicket(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { message } = req.body
    const reply = await (prisma as any).ticketReply.create({
      data: { ticketId: req.params.id, userId: req.user!.id, message, isStaff: true },
      include: { user: { select: { fullName: true, role: true } } },
    })
    await (prisma as any).supportTicket.update({
      where: { id: req.params.id },
      data: { status: 'in_progress' },
    })
    res.json({ success: true, data: reply })
  } catch (err) { next(err) }
}

export async function updateAdminTicketStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status } = req.body
    const ticket = await (prisma as any).supportTicket.update({
      where: { id: req.params.id },
      data: { status, ...(status === 'closed' || status === 'resolved' ? { closedAt: new Date() } : {}) },
    })
    res.json({ success: true, data: ticket })
  } catch (err) { next(err) }
}
