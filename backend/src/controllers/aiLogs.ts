import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { resolveOrgId } from '../lib/orgFilter'

function orgWhereBlock(orgId: string | null) {
  if (!orgId) return {}
  return { OR: [{ organizationId: orgId }, { organizationId: null }] }
}

export async function listAILogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { entityType, success } = req.query
    const orgId = await resolveOrgId(req.user!)

    const and: any[] = []
    const orgBlock = orgWhereBlock(orgId)
    if (Object.keys(orgBlock).length) and.push(orgBlock)
    if (entityType) and.push({ entityType })
    if (success !== undefined) and.push({ success: success === 'true' })
    const where: any = and.length ? { AND: and } : {}

    const [data, total] = await Promise.all([
      (prisma as any).aIAnalysisLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      (prisma as any).aIAnalysisLog.count({ where }),
    ])

    res.json(successResponse(data, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

export async function getAIStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const where: any = orgWhereBlock(orgId)

    const [total, failed, avgLatency, tokenSum] = await Promise.all([
      (prisma as any).aIAnalysisLog.count({ where }),
      (prisma as any).aIAnalysisLog.count({ where: { AND: [where, { success: false }] } }),
      (prisma as any).aIAnalysisLog.aggregate({ where, _avg: { latencyMs: true } }),
      (prisma as any).aIAnalysisLog.aggregate({ where, _sum: { promptTokens: true, completionTokens: true } }),
    ])

    res.json(successResponse({
      total,
      failed,
      successRate: total > 0 ? ((total - failed) / total * 100).toFixed(1) : 100,
      avgLatencyMs: Math.round(avgLatency._avg.latencyMs || 0),
      totalPromptTokens: tokenSum._sum.promptTokens || 0,
      totalCompletionTokens: tokenSum._sum.completionTokens || 0,
    }))
  } catch (err) { next(err) }
}
