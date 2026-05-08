import { Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

const DEFAULTS = {
  suspiciousSpeedKmh: 25,
  autoMonitorEnabled: true,
  coverageGreenPct: 80,
  coverageYellowPct: 50,
  notifyOnMonitorComplete: true,
  notifyOnLowCoverage: true,
  notifyMinCoveragePct: 60,
  driverAccessEnabled: false,
  gridCellM: 35,
  coverageRadiusM: 40,
  minVisitSec: 30,
  monitorStartHour: 6,
  monitorEndHour: 18,
}

export async function getThSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    // Yangi ustunlar (migration) hali qo'llanilmagan bo'lishi mumkin — fallback
    const setting = await (prisma as any).thSetting.findUnique({ where: { organizationId: orgId } })
      .catch(() => (prisma as any).thSetting.findUnique({
        where: { organizationId: orgId },
        select: { suspiciousSpeedKmh: true, autoMonitorEnabled: true, coverageGreenPct: true, coverageYellowPct: true },
      }).catch(() => null))

    const cred = await (prisma as any).gpsCredential.findFirst({
      where: { orgId },
      select: { isActive: true, lastSyncAt: true, lastSyncStatus: true, lastSyncError: true, host: true, tokenExpiresAt: true },
    }).catch(() => null)

    const { driverPinHash: _, ...settingWithoutPin } = setting || {}

    res.json({
      success: true,
      data: {
        ...DEFAULTS,
        ...settingWithoutPin,
        driverPinSet: !!(setting?.driverPinHash),
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

    const {
      suspiciousSpeedKmh, autoMonitorEnabled, coverageGreenPct, coverageYellowPct,
      notifyOnMonitorComplete, notifyOnLowCoverage, notifyMinCoveragePct,
      driverAccessEnabled, driverPin,
    } = req.body

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

    // Bildirishnoma sozlamalari
    if (notifyOnMonitorComplete != null) data.notifyOnMonitorComplete = !!notifyOnMonitorComplete
    if (notifyOnLowCoverage != null) data.notifyOnLowCoverage = !!notifyOnLowCoverage
    if (notifyMinCoveragePct != null) {
      const n = Number(notifyMinCoveragePct)
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('Foiz 0-100 orasida bo\'lishi kerak', 400)
      data.notifyMinCoveragePct = Math.round(n)
    }

    // GPS monitoring parametrlari
    const { gridCellM, coverageRadiusM, minVisitSec, monitorStartHour, monitorEndHour } = req.body
    if (gridCellM != null) {
      const n = Number(gridCellM)
      if (!Number.isFinite(n) || n < 10 || n > 100) throw new AppError('gridCellM 10-100m orasida bo\'lishi kerak', 400)
      data.gridCellM = Math.round(n)
    }
    if (coverageRadiusM != null) {
      const n = Number(coverageRadiusM)
      if (!Number.isFinite(n) || n < 10 || n > 200) throw new AppError('coverageRadiusM 10-200m orasida bo\'lishi kerak', 400)
      data.coverageRadiusM = Math.round(n)
    }
    if (minVisitSec != null) {
      const n = Number(minVisitSec)
      if (!Number.isFinite(n) || n < 5 || n > 300) throw new AppError('minVisitSec 5-300 sek orasida bo\'lishi kerak', 400)
      data.minVisitSec = Math.round(n)
    }
    if (monitorStartHour != null) {
      const n = Number(monitorStartHour)
      if (!Number.isFinite(n) || n < 0 || n > 23) throw new AppError('monitorStartHour 0-23 orasida bo\'lishi kerak', 400)
      data.monitorStartHour = Math.round(n)
    }
    if (monitorEndHour != null) {
      const n = Number(monitorEndHour)
      if (!Number.isFinite(n) || n < 0 || n > 23) throw new AppError('monitorEndHour 0-23 orasida bo\'lishi kerak', 400)
      data.monitorEndHour = Math.round(n)
    }

    // Haydovchi kirish tizimi
    if (driverAccessEnabled != null) data.driverAccessEnabled = !!driverAccessEnabled
    if (driverPin != null) {
      const pin = String(driverPin).trim()
      if (!/^\d{4,8}$/.test(pin)) throw new AppError('PIN faqat 4-8 ta raqamdan iborat bo\'lishi kerak', 400)
      data.driverPinHash = await bcrypt.hash(pin, 10)
    }

    const setting = await (prisma as any).thSetting.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...DEFAULTS, ...data },
      update: data,
    })

    const { driverPinHash: __, ...settingWithoutPin } = setting
    res.json({ success: true, data: { ...settingWithoutPin, driverPinSet: !!(setting.driverPinHash) } })
  } catch (err) { next(err) }
}

export async function loadThSettings(orgId: string | null) {
  if (!orgId) return DEFAULTS
  const s = await (prisma as any).thSetting.findUnique({ where: { organizationId: orgId } })
  return { ...DEFAULTS, ...(s || {}) }
}
