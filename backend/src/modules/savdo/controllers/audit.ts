// Savdo — audit jurnalini ko'rish (faqat admin). Yozuvlar o'zgartirilmaydi.

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { paginate, paginatedResponse } from '../../../types'
import { savdoDateRange } from '../lib/dateRange'

export async function listAudit(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)
    const where: any = { orgId }
    if (q.entity) where.entity = q.entity
    if (q.entityId) where.entityId = q.entityId
    if (q.action) where.action = q.action
    const df = savdoDateRange(q.from, q.to)
    if (df) where.createdAt = df
    if (q.search) where.OR = [
      { entityLabel: { contains: q.search.trim(), mode: 'insensitive' } },
      { reason: { contains: q.search.trim(), mode: 'insensitive' } },
      { userName: { contains: q.search.trim(), mode: 'insensitive' } },
    ]
    const [total, rows] = await Promise.all([
      (prisma as any).savdoAuditLog.count({ where }),
      (prisma as any).savdoAuditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    ])
    res.json(paginatedResponse(rows, total, page, limit))
  } catch (err) { next(err) }
}
