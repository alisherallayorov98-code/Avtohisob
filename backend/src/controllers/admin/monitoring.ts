import { Response, NextFunction } from 'express'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'
import os from 'os'

export async function getSystemMonitoring(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const uptimeSeconds = process.uptime()
    const memUsage = process.memoryUsage()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const cpuLoad = os.loadavg()

    const [userCount, vehicleCount, auditCount, errorLogs] = await Promise.all([
      prisma.user.count(),
      prisma.vehicle.count(),
      prisma.auditLog.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.auditLog.count({ where: { action: { contains: 'error' } } }),
    ])

    res.json({
      success: true,
      data: {
        server: {
          status: 'operational',
          uptime: uptimeSeconds,
          uptimeFormatted: formatUptime(uptimeSeconds),
          platform: os.platform(),
          nodeVersion: process.version,
          pid: process.pid,
        },
        memory: {
          usedMB: Math.round((totalMem - freeMem) / 1024 / 1024),
          totalMB: Math.round(totalMem / 1024 / 1024),
          percent: Math.round(((totalMem - freeMem) / totalMem) * 100),
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        cpu: {
          load1m: cpuLoad[0].toFixed(2),
          load5m: cpuLoad[1].toFixed(2),
          load15m: cpuLoad[2].toFixed(2),
          cores: os.cpus().length,
        },
        database: {
          status: 'connected',
          records: { users: userCount, vehicles: vehicleCount },
        },
        activity: {
          apiCallsToday: auditCount,
          errorCount: errorLogs,
          errorRate: auditCount > 0 ? ((errorLogs / auditCount) * 100).toFixed(2) : '0',
        },
        timestamp: new Date().toISOString(),
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
