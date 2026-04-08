import { Response, NextFunction } from 'express'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'
import os from 'os'

export async function getAdminDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfYear = new Date(now.getFullYear(), 0, 1)

    const [
      totalUsers,
      activeUsers,
      newUsersThisMonth,
      totalVehicles,
      activeVehicles,
      totalBranches,
      openTickets,
      revenueThisMonth,
      revenueThisYear,
      recentAuditLogs,
      subscriptionsByPlan,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.vehicle.count(),
      prisma.vehicle.count({ where: { status: 'active' } }),
      prisma.branch.count(),
      (prisma as any).supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'paid', paidAt: { gte: startOfMonth } },
      }),
      prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'paid', paidAt: { gte: startOfYear } },
      }),
      prisma.auditLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { fullName: true, email: true } } },
      }),
      prisma.subscription.groupBy({
        by: ['planId'],
        _count: true,
        where: { status: 'active' },
      }),
    ])

    const orgCount = await prisma.user.count({ where: { role: { in: ['admin', 'super_admin'] as any } } })

    const uptimeSeconds = process.uptime()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          newThisMonth: newUsersThisMonth,
          organizations: orgCount,
        },
        vehicles: {
          total: totalVehicles,
          active: activeVehicles,
        },
        branches: { total: totalBranches },
        support: { openTickets },
        revenue: {
          thisMonth: Number(revenueThisMonth._sum.amount || 0),
          thisYear: Number(revenueThisYear._sum.amount || 0),
        },
        system: {
          uptimeSeconds,
          uptimeFormatted: formatUptime(uptimeSeconds),
          memoryUsedMB: Math.round((totalMem - freeMem) / 1024 / 1024),
          memoryTotalMB: Math.round(totalMem / 1024 / 1024),
          memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
          nodeVersion: process.version,
          platform: process.platform,
        },
        recentActivity: recentAuditLogs,
        subscriptionsByPlan,
      },
    })
  } catch (err) { next(err) }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${d}d ${h}h ${m}m`
}
