import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { recalculateAll, recalculateOne, getTopUsed, getTopByValue } from '../services/sparePartStatsService'
import { resolveOrgId } from '../lib/orgFilter'
import { AppError } from '../middleware/errorHandler'

function orgWhereBlock(orgId: string | null) {
  if (!orgId) return {}
  return { OR: [{ organizationId: orgId }, { organizationId: null }] }
}

async function assertSparePartOrg(sparePartId: string, orgId: string | null) {
  const sp = await (prisma as any).sparePart.findUnique({
    where: { id: sparePartId },
    select: { organizationId: true },
  })
  if (!sp) throw new AppError('Ehtiyot qism topilmadi', 404)
  if (orgId && sp.organizationId && sp.organizationId !== orgId) {
    throw new AppError("Bu ehtiyot qismga kirish huquqingiz yo'q", 403)
  }
  return sp
}

export async function listStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { category, sortBy = 'totalUsed' } = req.query
    const orgId = await resolveOrgId(req.user!)

    const and: any[] = []
    const orgBlock = orgWhereBlock(orgId)
    if (Object.keys(orgBlock).length) and.push(orgBlock)
    if (category) and.push({ sparePart: { category } })
    const where: any = and.length ? { AND: and } : {}

    const orderBy: any = {}
    if (sortBy === 'totalCost') orderBy.totalCost = 'desc'
    else if (sortBy === 'usageCount') orderBy.usageCount = 'desc'
    else orderBy.totalUsed = 'desc'

    const [data, total] = await Promise.all([
      (prisma as any).sparePartStatistic.findMany({
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
      (prisma as any).sparePartStatistic.count({ where }),
    ])

    res.json(successResponse(data, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

export async function getOneStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { sparePartId } = req.params
    await assertSparePartOrg(sparePartId, orgId)
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
    const orgId = await resolveOrgId(req.user!)
    await recalculateAll(orgId)
    res.json(successResponse(null, 'Statistika yangilandi'))
  } catch (err) { next(err) }
}

export async function getRanking(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { limit = '10' } = req.query
    const n = parseInt(limit as string)
    const orgId = await resolveOrgId(req.user!)
    const [topUsed, topCost] = await Promise.all([
      getTopUsed(n, orgId),
      getTopByValue(n, orgId),
    ])
    res.json(successResponse({ topUsed, topCost }))
  } catch (err) { next(err) }
}

export async function getOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const orgBlock = orgWhereBlock(orgId)
    const sparePartsWhere: any = orgId
      ? { AND: [{ isActive: true }, orgBlock] }
      : { isActive: true }
    const statWhere: any = orgBlock

    const [totalParts, totalStats, byCategory] = await Promise.all([
      (prisma as any).sparePart.count({ where: sparePartsWhere }),
      (prisma as any).sparePartStatistic.aggregate({
        where: statWhere,
        _sum: { totalUsed: true, totalCost: true },
        _count: { id: true },
      }),
      (prisma as any).sparePartStatistic.findMany({
        where: statWhere,
        include: { sparePart: { select: { category: true } } },
      }),
    ])

    const categoryTotals = byCategory.reduce((acc: any, s: any) => {
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
