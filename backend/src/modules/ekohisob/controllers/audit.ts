import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

// Amal nomlarining o'zbekcha tavsifi — UI'da tushunarli ko'rinishi uchun
const ACTION_LABELS: Record<string, string> = {
  'payment.create': 'To\'lov qabul qilindi',
  'payment.delete': 'To\'lov bekor qilindi',
  'talon.create': 'Talon qo\'shildi',
  'talon.update': 'Talon o\'zgartirildi',
  'talon.paid': 'Talon to\'landi',
  'talon.unpaid': 'Talon to\'lovi bekor qilindi',
  'talon.delete': 'Talon o\'chirildi',
  'entity.deactivate': 'Tashkilot deaktiv qilindi',
  'charge.recalc': 'Hisoblar qayta hisoblandi',
}

/**
 * GET /audit — pulga ta'sir qiluvchi amallar jurnali (faqat admin).
 * Filtrlar: action, userId, entityId (targetId), from, to. Sahifalash: page/limit.
 */
export async function listAuditLogs(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { action, userId, targetId, from, to, page = '1', limit = '50' } = req.query as Record<string, string>

    const take = Math.min(Math.max(parseInt(limit) || 50, 1), 200)
    const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take

    const where: any = { orgId }
    if (action) where.action = action
    if (userId) where.userId = userId
    if (targetId) where.targetId = targetId
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from + 'T00:00:00.000Z')
      // `to` kunining oxirigacha kirsin (23:59:59)
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59.999Z')
    }

    const [total, logs] = await Promise.all([
      (prisma as any).ekoHisobAuditLog.count({ where }),
      (prisma as any).ekoHisobAuditLog.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
      }),
    ])

    res.json({
      success: true,
      data: logs.map((l: any) => ({ ...l, actionLabel: ACTION_LABELS[l.action] ?? l.action })),
      meta: { total, page: Math.max(parseInt(page) || 1, 1), limit: take },
    })
  } catch (err) { next(err) }
}

/**
 * GET /audit/summary — oxirgi 30 kunda amal turlari bo'yicha soni + eng faol xodimlar.
 * Rahbar "nima bo'lyapti" savoliga bir qarashda javob olishi uchun.
 */
export async function getAuditSummary(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const since = new Date()
    since.setDate(since.getDate() - 30)

    const logs = await (prisma as any).ekoHisobAuditLog.findMany({
      where: { orgId, createdAt: { gte: since } },
      select: { action: true, userId: true, userName: true, amount: true },
    })

    const byAction: Record<string, number> = {}
    const byUser = new Map<string, { name: string; count: number; deletedAmount: number }>()
    for (const l of logs) {
      byAction[l.action] = (byAction[l.action] || 0) + 1
      const key = l.userId || l.userName
      const cur = byUser.get(key) ?? { name: l.userName, count: 0, deletedAmount: 0 }
      cur.count++
      // Bekor qilingan pul — nazorat uchun eng muhim ko'rsatkich
      if (l.action === 'payment.delete' || l.action === 'talon.delete') {
        cur.deletedAmount += Number(l.amount || 0)
      }
      byUser.set(key, cur)
    }

    res.json({
      success: true,
      data: {
        days: 30,
        total: logs.length,
        byAction: Object.entries(byAction)
          .map(([action, count]) => ({ action, label: ACTION_LABELS[action] ?? action, count }))
          .sort((a, b) => b.count - a.count),
        byUser: Array.from(byUser.values()).sort((a, b) => b.deletedAmount - a.deletedAmount || b.count - a.count),
      },
    })
  } catch (err) { next(err) }
}
