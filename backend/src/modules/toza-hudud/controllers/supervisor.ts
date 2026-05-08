/**
 * Supervisor portal — super_admin uchun barcha tashkilotlar statistikasi
 * Har bir org uchun: bugungi qamrov, faol mashinalar, kechikkan konteynerlar
 */

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { AuthRequest } from '../../../types'

export async function getSupervisorOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'super_admin') throw new AppError('Faqat super_admin uchun', 403)

    const today = new Date()
    const todayDate = new Date(today.toISOString().split('T')[0] + 'T00:00:00.000Z')

    // Toza-Hudud obunali tashkilotlar
    const subs = await (prisma as any).subscription.findMany({
      where: { status: 'active', features: { has: 'tozahudud_module' } },
      select: { organizationId: true },
    }).catch(() => [] as { organizationId: string }[])

    if (subs.length === 0) {
      // Single-tenant mode
      const [visited, notVisited, noGps] = await Promise.all([
        (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'visited' } }),
        (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'not_visited' } }),
        (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'no_gps' } }),
      ])
      const total = visited + notVisited + noGps
      return res.json({
        success: true,
        data: [{
          orgId: null,
          orgName: 'Umumiy',
          today: { visited, notVisited, noGps, total, coveragePct: total > 0 ? Math.round(visited / total * 100) : null },
        }],
      })
    }

    const orgIds = subs.map((s: any) => s.organizationId)

    // Har org uchun branch → vehicle mapni quramiz
    const results = await Promise.all(orgIds.map(async (orgId: string) => {
      try {
        // Org nomi
        const branch = await prisma.branch.findFirst({
          where: { OR: [{ id: orgId }, { organizationId: orgId }] },
          select: { name: true },
        }).catch(() => null)

        const branches = await (prisma as any).branch.findMany({
          where: { OR: [{ id: orgId }, { organizationId: orgId }] },
          select: { id: true },
        }).catch(() => [] as { id: string }[])
        const branchIds = branches.map((b: any) => b.id)

        if (branchIds.length === 0) return null

        const vIds = await prisma.vehicle.findMany({
          where: { branchId: { in: branchIds }, status: 'active' },
          select: { id: true },
        }).then(vs => vs.map(v => v.id)).catch(() => [] as string[])

        if (vIds.length === 0) return null

        const scope = { date: todayDate, vehicleId: { in: vIds } }

        const [visited, notVisited, noGps, suspicious, overdueCount] = await Promise.all([
          (prisma as any).thServiceTrip.count({ where: { ...scope, status: 'visited' } }).catch(() => 0),
          (prisma as any).thServiceTrip.count({ where: { ...scope, status: 'not_visited' } }).catch(() => 0),
          (prisma as any).thServiceTrip.count({ where: { ...scope, status: 'no_gps' } }).catch(() => 0),
          (prisma as any).thServiceTrip.count({ where: { ...scope, suspicious: true } }).catch(() => 0),
          // Kechikkan konteynerlar (taxminiy — oxirgi 30 kunda tashrif bo'lmaganlar)
          (prisma as any).thContainer.count({
            where: {
              organizationId: orgId,
              visits: {
                none: {
                  date: { gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) },
                },
              },
            },
          }).catch(() => 0),
        ])

        const total = visited + notVisited + noGps

        return {
          orgId,
          orgName: branch?.name || orgId.slice(0, 8),
          today: {
            visited,
            notVisited,
            noGps,
            suspicious,
            total,
            coveragePct: total > 0 ? Math.round(visited / total * 100) : null,
          },
          vehicles: vIds.length,
          overdueContainers: overdueCount,
        }
      } catch {
        return null
      }
    }))

    res.json({ success: true, data: results.filter(Boolean) })
  } catch (err) { next(err) }
}
