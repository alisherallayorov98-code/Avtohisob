import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import QRCode from 'qrcode'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

// ── Driver token: HMAC-signed payload ────────────────────────────────────────

function signDriverToken(vehicleId: string, orgId: string): string {
  const payload = Buffer.from(JSON.stringify({ vehicleId, orgId, v: 1 })).toString('base64url')
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET!)
    .update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyDriverToken(token: string): { vehicleId: string; orgId: string } | null {
  try {
    const [payload, sig] = token.split('.')
    if (!payload || !sig) return null
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET!)
      .update(payload).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return null
  }
}

// ── Admin endpoints (authenticated) ──────────────────────────────────────────

export async function getDriverVehicles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)
    const vehicles = await prisma.vehicle.findMany({
      where: {
        status: 'active',
        ...(branchFilter ? { branchId: branchFilter } : {}),
      },
      select: { id: true, registrationNumber: true, brand: true, model: true },
      orderBy: { registrationNumber: 'asc' },
    })
    res.json({ success: true, data: vehicles })
  } catch (err) { next(err) }
}

export async function getDriverToday(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, date } = req.query as any
    if (!vehicleId) throw new AppError('vehicleId talab qilinadi', 400)

    const orgId = await resolveOrgId(req.user!)
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, ...(branchFilter ? { branchId: branchFilter } : {}) },
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)

    const result = await buildDriverTodayData(vehicleId, date)
    res.json({ success: true, data: { vehicle, ...result } })
  } catch (err) { next(err) }
}

/** Admin: shu mashina uchun QR kod va havola yaratadi */
export async function generateDriverQR(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    if (!vehicleId) throw new AppError('vehicleId talab qilinadi', 400)

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    // Tashkilot sozlamalarini tekshirish
    const settings = await (prisma as any).thSetting.findUnique({ where: { organizationId: orgId } })
    if (!settings?.driverAccessEnabled) {
      throw new AppError('Haydovchi kirish tizimi yoqilmagan. Sozlamalardan yoqing.', 400)
    }

    // Mashina bu org ga tegishlimi?
    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    })
    const branchIds = branches.map((b: any) => b.id)
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, branchId: { in: branchIds } },
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)

    const token = signDriverToken(vehicleId, orgId)
    const baseUrl = process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'https://avtohisob.uz'
    const driverUrl = `${baseUrl}/th-driver?token=${token}`

    const qrDataUrl = await QRCode.toDataURL(driverUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 300,
      color: { dark: '#064e3b', light: '#ffffff' },
    })

    res.json({
      success: true,
      data: {
        vehicle,
        token,
        url: driverUrl,
        qrDataUrl,
        pinRequired: !!(settings?.driverPinHash),
      },
    })
  } catch (err) { next(err) }
}

// ── Public driver endpoint (no auth — token + optional PIN) ──────────────────

export async function getDriverPublicToday(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, pin, date } = req.query as Record<string, string>
    if (!token) throw new AppError('Token talab qilinadi', 400)

    const decoded = verifyDriverToken(token)
    if (!decoded) throw new AppError('Noto\'g\'ri token', 401)

    const { vehicleId, orgId } = decoded

    // PIN tekshiruvi
    const settings = await (prisma as any).thSetting.findUnique({ where: { organizationId: orgId } })
    if (!settings?.driverAccessEnabled) throw new AppError('Haydovchi kirish yoqilmagan', 403)

    if (settings.driverPinHash) {
      if (!pin) throw new AppError('PIN talab qilinadi', 401)
      const ok = await bcrypt.compare(String(pin), settings.driverPinHash)
      if (!ok) throw new AppError('PIN noto\'g\'ri', 401)
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)

    const result = await buildDriverTodayData(vehicleId, date)
    res.json({ success: true, data: { vehicle, ...result } })
  } catch (err) { next(err) }
}

export async function checkDriverPin(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, pin } = req.body
    if (!token || !pin) throw new AppError('Token va PIN talab qilinadi', 400)

    const decoded = verifyDriverToken(token)
    if (!decoded) throw new AppError('Noto\'g\'ri token', 401)

    const settings = await (prisma as any).thSetting.findUnique({ where: { organizationId: decoded.orgId } })
    if (!settings?.driverAccessEnabled) throw new AppError('Haydovchi kirish yoqilmagan', 403)

    if (settings.driverPinHash) {
      const ok = await bcrypt.compare(String(pin), settings.driverPinHash)
      if (!ok) throw new AppError('PIN noto\'g\'ri', 401)
    }

    res.json({ success: true, data: { pinRequired: !!(settings?.driverPinHash), verified: true } })
  } catch (err) { next(err) }
}

// ── Shared helper ─────────────────────────────────────────────────────────────

async function buildDriverTodayData(vehicleId: string, date?: string) {
  const targetDate = date ? new Date(date) : new Date()
  const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')
  const jsDow = targetDate.getDay()
  const uzDow = (jsDow + 6) % 7

  const schedules = await (prisma as any).thSchedule.findMany({
    where: { vehicleId, dayOfWeek: { has: uzDow } },
    include: {
      mfy: { select: { id: true, name: true, district: { select: { name: true } }, polygon: true } },
    },
  })

  const trips = await (prisma as any).thServiceTrip.findMany({
    where: { vehicleId, date: dateOnly, mfyId: { in: schedules.map((s: any) => s.mfyId) } },
    select: { mfyId: true, status: true, enteredAt: true, exitedAt: true, maxSpeedKmh: true, suspicious: true, coveragePct: true },
  }).catch(() => [])

  const tripMap = new Map<string, any>(trips.map((t: any) => [t.mfyId, t]))

  const containerVisitCount = await (prisma as any).thContainerVisit.count({
    where: { vehicleId, date: dateOnly },
  }).catch(() => 0)

  const landfillTrips = await (prisma as any).thLandfillTrip.findMany({
    where: { vehicleId, date: dateOnly },
    include: { landfill: { select: { name: true } } },
    orderBy: { arrivedAt: 'asc' },
  }).catch(() => [])

  const items = schedules.map((s: any) => {
    const trip = tripMap.get(s.mfyId)
    return {
      mfy: { id: s.mfy.id, name: s.mfy.name, district: s.mfy.district?.name || null, hasPolygon: !!s.mfy.polygon },
      status: trip?.status || 'pending',
      enteredAt: trip?.enteredAt || null,
      exitedAt: trip?.exitedAt || null,
      suspicious: trip?.suspicious || false,
      coveragePct: trip?.coveragePct ?? null,
    }
  })

  const summary = {
    total: items.length,
    visited: items.filter((i: any) => i.status === 'visited').length,
    notVisited: items.filter((i: any) => i.status === 'not_visited').length,
    pending: items.filter((i: any) => i.status === 'pending').length,
    noGps: items.filter((i: any) => i.status === 'no_gps').length,
    noPolygon: items.filter((i: any) => i.status === 'no_polygon').length,
    suspicious: items.filter((i: any) => i.suspicious).length,
    containerVisits: containerVisitCount,
    landfillTrips: landfillTrips.length,
  }

  return {
    date: dateOnly,
    dayOfWeek: uzDow,
    summary,
    items,
    landfillTrips: landfillTrips.map((t: any) => ({
      landfillName: t.landfill?.name,
      arrivedAt: t.arrivedAt,
      leftAt: t.leftAt,
      durationMin: t.durationMin,
    })),
  }
}
