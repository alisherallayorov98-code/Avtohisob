import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

const DEFAULTS = {
  suspiciousSpeedKmh: 25,
  autoMonitorEnabled: true,
  coverageGreenPct: 80,
  coverageYellowPct: 50,
}

/**
 * Tashkilot uchun toza-hudud sozlamalarini olib qaytaradi.
 * Yo'q bo'lsa default qaytariladi (avto-yaratilmaydi — DB ga keraksiz yozuv qilmaslik uchun).
 * GPS ulanish ma'lumoti ham qaytariladi (ulangan/oxirgi sinx).
 */
export async function getThSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const setting = await (prisma as any).thSetting.findUnique({ where: { organizationId: orgId } })
    const cred = await (prisma as any).gpsCredential.findFirst({
      where: { orgId },
      select: { isActive: true, lastSyncAt: true, lastSyncStatus: true, lastSyncError: true, host: true, tokenExpiresAt: true },
    })

    res.json({
      success: true,
      data: {
        ...DEFAULTS,
        ...(setting || {}),
        gps: cred
          ? {
              connected: !!cred.isActive,
              host: cred.host,
              lastSyncAt: cred.lastSyncAt,
              lastSyncStatus: cred.lastSyncStatus,
              lastSyncError: cred.lastSyncError,
              tokenExpiresAt: cred.tokenExpiresAt,
            }
          : { connected: false },
      },
    })
  } catch (err) { next(err) }
}

export async function updateThSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const { suspiciousSpeedKmh, autoMonitorEnabled, coverageGreenPct, coverageYellowPct } = req.body

    // Validatsiya — qiymatlar mantiqiy diapazonda
    const data: any = {}
    if (suspiciousSpeedKmh != null) {
      const n = Number(suspiciousSpeedKmh)
      if (!Number.isFinite(n) || n < 5 || n > 200) throw new AppError('Tezlik 5-200 km/h orasida bo\'lishi kerak', 400)
      data.suspiciousSpeedKmh = Math.round(n)
    }
    if (autoMonitorEnabled != null) data.autoMonitorEnabled = !!autoMonitorEnabled
    if (coverageGreenPct != null) {
      const n = Number(coverageGreenPct)
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('Foiz 0-100 orasida bo\'lishi kerak', 400)
      data.coverageGreenPct = Math.round(n)
    }
    if (coverageYellowPct != null) {
      const n = Number(coverageYellowPct)
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('Foiz 0-100 orasida bo\'lishi kerak', 400)
      data.coverageYellowPct = Math.round(n)
    }

    if (data.coverageGreenPct != null && data.coverageYellowPct != null && data.coverageYellowPct >= data.coverageGreenPct) {
      throw new AppError('Sariq chegara yashildan past bo\'lishi kerak', 400)
    }

    const setting = await (prisma as any).thSetting.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...DEFAULTS, ...data },
      update: data,
    })

    res.json({ success: true, data: setting })
  } catch (err) { next(err) }
}

/**
 * thMonitor xizmati uchun: berilgan tashkilot uchun sozlamalarni qaytaradi (default bilan).
 */
export async function loadThSettings(orgId: string | null) {
  if (!orgId) return DEFAULTS
  const s = await (prisma as any).thSetting.findUnique({ where: { organizationId: orgId } })
  return { ...DEFAULTS, ...(s || {}) }
}
