import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'

export async function listAILogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { entityType, success } = req.query

    const where: any = {}
    if (entityType) where.entityType = entityType
    if (success !== undefined) where.success = success === 'true'

    const [data, total] = await Promise.all([
      prisma.aIAnalysisLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.aIAnalysisLog.count({ where }),
    ])

    res.json(successResponse(data, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

export async function getAIStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [total, failed, avgLatency, tokenSum] = await Promise.all([
      prisma.aIAnalysisLog.count(),
      prisma.aIAnalysisLog.count({ where: { success: false } }),
      prisma.aIAnalysisLog.aggregate({ _avg: { latencyMs: true } }),
      prisma.aIAnalysisLog.aggregate({ _sum: { promptTokens: true, completionTokens: true } }),
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
