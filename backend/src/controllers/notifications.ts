import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'

export async function getNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const unreadCount = await prisma.notification.count({
      where: { userId: req.user!.id, isRead: false },
    })
    res.json(successResponse({ notifications, unreadCount }))
  } catch (err) { next(err) }
}

export async function markAsRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    if (id === 'all') {
      await prisma.notification.updateMany({
        where: { userId: req.user!.id, isRead: false },
        data: { isRead: true },
      })
    } else {
      await prisma.notification.updateMany({
        where: { id, userId: req.user!.id },
        data: { isRead: true },
      })
    }
    res.json(successResponse(null, "O'qildi"))
  } catch (err) { next(err) }
}

export async function deleteNotification(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    await prisma.notification.deleteMany({ where: { id, userId: req.user!.id } })
    res.json(successResponse(null, "O'chirildi"))
  } catch (err) { next(err) }
}
