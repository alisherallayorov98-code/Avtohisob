import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

function getCurrentMonth(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export async function getDailyList(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { districtId, mahallId, month = getCurrentMonth() } = req.query

    const entityWhere: any = {
      orgId,
      status: 'active',
    }

    // District filter
    if (role === 'inspector') {
      entityWhere.districtId = { in: districtIds }
    }
    if (districtId) {
      if (role === 'inspector' && !districtIds.includes(String(districtId))) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      entityWhere.districtId = String(districtId)
    }
    if (mahallId) {
      entityWhere.mahallId = String(mahallId)
    }

    const currentMonth = String(month)

    // Get all active entities
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      include: {
        district: { select: { id: true, name: true } },
        mahalla: { select: { id: true, name: true } },
        payments: {
          where: { month: currentMonth },
          select: { id: true, amount: true, paidAt: true },
        },
      },
      orderBy: [
        { mahallId: 'asc' },
        { name: 'asc' },
      ],
    })

    // Get all unpaid months count per entity (count of missing payments in past 12 months)
    const unpaidEntities = entities.filter((e: any) => e.payments.length === 0)

    // For each unpaid entity, count previous unpaid months
    const unpaidWithHistory = await Promise.all(
      unpaidEntities.map(async (entity: any) => {
        // Count payments this entity has made in last 12 months
        const now = new Date()
        const months: string[] = []
        for (let i = 0; i < 12; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
        }
        const paidMonths = await (prisma as any).ekoHisobPayment.findMany({
          where: { entityId: entity.id, month: { in: months } },
          select: { month: true },
        })
        const paidSet = new Set(paidMonths.map((p: any) => p.month))
        const unpaidMonthsCount = months.filter(m => !paidSet.has(m)).length

        return {
          ...entity,
          unpaidMonthsCount,
        }
      })
    )

    // Group by mahalla
    const grouped: Record<string, any> = {}
    for (const entity of unpaidWithHistory) {
      const key = entity.mahallId || '__no_mahalla__'
      if (!grouped[key]) {
        grouped[key] = {
          mahalla: entity.mahalla || { id: null, name: 'Mahallasiz' },
          entities: [],
        }
      }
      const { payments: _, ...entityData } = entity
      grouped[key].entities.push(entityData)
    }

    res.json({
      success: true,
      data: {
        month: currentMonth,
        groups: Object.values(grouped),
        totalUnpaid: unpaidEntities.length,
      },
    })
  } catch (err) { next(err) }
}

export async function getMapData(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const currentMonth = getCurrentMonth()

    const entityWhere: any = {
      orgId,
      lat: { not: null },
      lon: { not: null },
      status: { not: 'inactive' },
    }

    if (role === 'inspector') {
      entityWhere.districtId = { in: districtIds }
    }

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      select: {
        id: true,
        name: true,
        lat: true,
        lon: true,
        status: true,
        payments: {
          where: { month: currentMonth },
          select: { id: true },
        },
      },
    })

    const result = entities.map((e: any) => ({
      id: e.id,
      name: e.name,
      lat: e.lat,
      lon: e.lon,
      status: e.status,
      paidThisMonth: e.payments.length > 0,
    }))

    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

export async function getStats(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const currentMonth = getCurrentMonth()

    const entityWhere: any = { orgId }
    if (role === 'inspector') {
      entityWhere.districtId = { in: districtIds }
    }

    const [total, blacklisted] = await Promise.all([
      (prisma as any).ekoHisobLegalEntity.count({
        where: { ...entityWhere, status: 'active' },
      }),
      (prisma as any).ekoHisobLegalEntity.count({
        where: { ...entityWhere, status: 'blacklisted' },
      }),
    ])

    // Get entities IDs for payment queries
    const orgEntities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { ...entityWhere, status: 'active' },
      select: { id: true },
    })
    const entityIds = orgEntities.map((e: any) => e.id)

    // Count paid this month
    const paidThisMonth = await (prisma as any).ekoHisobPayment.count({
      where: {
        entityId: { in: entityIds },
        month: currentMonth,
      },
    })

    // Sum collected amount this month
    const collectedResult = await (prisma as any).ekoHisobPayment.aggregate({
      where: {
        entityId: { in: entityIds },
        month: currentMonth,
      },
      _sum: { amount: true },
    })
    const collectedAmount = collectedResult._sum.amount || 0

    res.json({
      success: true,
      data: {
        month: currentMonth,
        total,
        paidThisMonth,
        unpaidThisMonth: total - paidThisMonth,
        blacklisted,
        collectedAmount,
      },
    })
  } catch (err) { next(err) }
}
