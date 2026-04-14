import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

export async function getAuditLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { userId, entityType, action } = req.query

    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    const where: any = {}
    // Org scoping: restrict to logs made by users in this org
    if (bv !== undefined) where.user = { branchId: bv }
    if (userId) where.userId = userId
    if (entityType) where.entityType = entityType
    if (action) where.action = action

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ])

    res.json(successResponse(data, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}
