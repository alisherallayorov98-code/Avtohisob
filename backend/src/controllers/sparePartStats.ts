import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { recalculateAll, recalculateOne, getTopUsed, getTopByValue } from '../services/sparePartStatsService'

export async function listStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { category, sortBy = 'totalUsed' } = req.query

    const where: any = {}
    if (category) where.sparePart = { category }

    const orderBy: any = {}
    if (sortBy === 'totalCost') orderBy.totalCost = 'desc'
    else if (sortBy === 'usageCount') orderBy.usageCount = 'desc'
    else orderBy.totalUsed = 'desc'

    const [data, total] = await Promise.all([
      prisma.sparePartStatistic.findMany({
        where,
        include: {
          sparePart: {
            select: { name: true, partCode: true, category: true, unitPrice: true },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.sparePartStatistic.count({ where }),
    ])

    res.json(successResponse(data, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

export async function getOneStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sparePartId } = req.params
    await recalculateOne(sparePartId)
    const stat = await prisma.sparePartStatistic.findUnique({
      where: { sparePartId },
      include: { sparePart: { select: { name: true, partCode: true, category: true } } },
    })
    res.json(successResponse(stat))
  } catch (err) { next(err) }
}

export async function triggerRecalculate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await recalculateAll()
    res.json(successResponse(null, 'Statistika yangilandi'))
  } catch (err) { next(err) }
}

export async function getRanking(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { type = 'usage', limit = '10' } = req.query
    const n = parseInt(limit as string)
    const [topUsed, topCost] = await Promise.all([
      getTopUsed(n),
      getTopByValue(n),
    ])
    res.json(successResponse({ topUsed, topCost }))
  } catch (err) { next(err) }
}

export async function getOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [totalParts, totalStats, byCategory] = await Promise.all([
      prisma.sparePart.count({ where: { isActive: true } }),
      prisma.sparePartStatistic.aggregate({
        _sum: { totalUsed: true, totalCost: true },
        _count: { id: true },
      }),
      prisma.sparePartStatistic.findMany({
        include: { sparePart: { select: { category: true } } },
      }),
    ])

    const categoryTotals = byCategory.reduce((acc, s) => {
      const cat = s.sparePart.category
      if (!acc[cat]) acc[cat] = { totalUsed: 0, totalCost: 0, count: 0 }
      acc[cat].totalUsed += s.totalUsed
      acc[cat].totalCost += Number(s.totalCost)
      acc[cat].count++
      return acc
    }, {} as Record<string, { totalUsed: number; totalCost: number; count: number }>)

    res.json(successResponse({
      totalParts,
      totalUsed: totalStats._sum.totalUsed || 0,
      totalCost: totalStats._sum.totalCost || 0,
      trackedParts: totalStats._count.id,
      categoryTotals,
    }))
  } catch (err) { next(err) }
}
