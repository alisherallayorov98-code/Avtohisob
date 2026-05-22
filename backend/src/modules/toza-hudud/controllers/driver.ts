import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import QRCode from 'qrcode'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'
import { suggestDayRoute } from '../services/thRouteOptimizer'

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

    // Tashkilot sozlamalarini olish (yo'q bo'lsa default: yoqilgan)
    const settings = await (prisma as any).thSetting.findUnique({ where: { organizationId: orgId } })
    // driverAccessEnabled=false faqat qo'lda o'chirilgan bo'lsa rad etamiz (null/undefined = default true)
    if (settings?.driverAccessEnabled === false) {
      throw new AppError('Haydovchi kirish tizimi o\'chirilgan. Sozlamalardan yoqing.', 400)
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

  const d14 = new Date(); d14.setDate(d14.getDate() - 14)
  const recentVisits = await (prisma as any).thServiceTrip.count({
    where: { vehicleId, date: { gte: d14 }, status: 'visited' }
  }).catch(() => 0)
  const isNewDriver = recentVisits < 5

  return {
    date: dateOnly,
    dayOfWeek: uzDow,
    summary,
    items,
    isNewDriver,
    landfillTrips: landfillTrips.map((t: any) => ({
      landfillName: t.landfill?.name,
      arrivedAt: t.arrivedAt,
      leftAt: t.leftAt,
      durationMin: t.durationMin,
    })),
  }
}

// ── Ko'cha yo'riqnomasi — distance helpers ────────────────────────────────────

function distM2(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function sampleLine(coords: [number,number][], step=25): [number,number][] {
  if (coords.length < 2) return coords
  const out: [number,number][] = [coords[0]]
  let carry = 0
  for (let i = 1; i < coords.length; i++) {
    const d = distM2(coords[i-1][0],coords[i-1][1],coords[i][0],coords[i][1])
    carry += d
    while (carry >= step) {
      carry -= step
      const t = 1 - carry/d
      out.push([coords[i-1][0]+(coords[i][0]-coords[i-1][0])*t, coords[i-1][1]+(coords[i][1]-coords[i-1][1])*t])
    }
  }
  out.push(coords[coords.length-1])
  return out
}

/**
 * Public: haydovchi token orqali MFY ko'chalar yo'riqnomasini oladi.
 * GET /th/driver/street-guide?token=X&mfyId=Y
 */
export async function getDriverStreetGuide(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, mfyId, includeGeometry } = req.query as Record<string, string>
    if (!token) throw new AppError('Token talab qilinadi', 400)
    if (!mfyId) throw new AppError('mfyId talab qilinadi', 400)

    const decoded = verifyDriverToken(token)
    if (!decoded) throw new AppError('Noto\'g\'ri token', 401)

    const { vehicleId, orgId } = decoded
    const withGeometry = includeGeometry === 'true'

    const settings = await (prisma as any).thSetting.findUnique({ where: { organizationId: orgId } })
    if (!settings?.driverAccessEnabled) throw new AppError('Haydovchi kirish yoqilmagan', 403)

    const streets = await (prisma as any).thMfyStreet.findMany({
      where: { mfyId },
      orderBy: { lengthM: 'desc' },
    })

    if (!streets.length) {
      return res.json({ success: true, data: { streets: [], hasStreetData: false, isNewDriver: false, mfyVisitedToday: false, mfyCoveragePctToday: null } })
    }

    // Bugungi trip holati
    const todayDate = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z')
    const todayTrip = await (prisma as any).thServiceTrip.findFirst({
      where: { vehicleId, mfyId, date: todayDate },
      select: { status: true, coveragePct: true },
    }).catch(() => null)
    const mfyVisitedToday = todayTrip?.status === 'visited'
    const mfyCoveragePctToday: number | null = todayTrip?.coveragePct ?? null

    // Load fingerprints for this vehicle+MFY from last 6 months
    const months: string[] = []
    for (let i = 0; i < 6; i++) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const fps = await (prisma as any).thCoverageFingerprint.findMany({
      where: { vehicleId, mfyId, month: { in: months } },
      select: { cells: true, month: true },
    })

    // Build monthCoverage map: key = "lat1000_lon1000", value = months count
    const monthCoverage = new Map<string, number>()
    for (const fp of fps) {
      const cells: Array<{ lat: number; lon: number }> = Array.isArray(fp.cells) ? fp.cells : []
      const seen = new Set<string>()
      for (const cell of cells) {
        const key = `${Math.round(cell.lat * 1000)}_${Math.round(cell.lon * 1000)}`
        if (!seen.has(key)) {
          seen.add(key)
          monthCoverage.set(key, (monthCoverage.get(key) ?? 0) + 1)
        }
      }
    }

    // Flat covered points array
    const coveredPoints: Array<{ lat: number; lon: number; key: string }> = []
    for (const [key] of monthCoverage) {
      const [latStr, lonStr] = key.split('_')
      coveredPoints.push({ lat: parseInt(latStr) / 1000, lon: parseInt(lonStr) / 1000, key })
    }

    // Score each street
    const scored = streets.map((street: any) => {
      let geometry: [number, number][] = []
      try {
        const raw = Array.isArray(street.geometry) ? street.geometry : JSON.parse(street.geometry || '[]')
        geometry = raw
      } catch { geometry = [] }

      const samples = sampleLine(geometry, 25)
      let maxMonths = 0

      for (const [sLat, sLon] of samples) {
        for (const cp of coveredPoints) {
          if (distM2(sLat, sLon, cp.lat, cp.lon) <= 40) {
            const cnt = monthCoverage.get(cp.key) ?? 0
            if (cnt > maxMonths) maxMonths = cnt
          }
        }
      }

      const monthsCovered = Math.min(maxMonths, 6)
      let priority: 0 | 1 | 2 | 3
      if (monthsCovered === 0) priority = 0
      else if (monthsCovered <= 2) priority = 1
      else if (monthsCovered <= 4) priority = 2
      else priority = 3

      return {
        osmWayId: street.osmWayId,
        name: street.name ?? null,
        highway: street.highway,
        lengthM: street.lengthM,
        monthsCovered,
        priority,
        ...(withGeometry ? { geometry } : {}),
      }
    })

    // Sort: priority ASC, then lengthM DESC
    scored.sort((a: any, b: any) => a.priority !== b.priority ? a.priority - b.priority : b.lengthM - a.lengthM)

    const neverCount = scored.filter((s: any) => s.priority === 0).length
    const rareCount = scored.filter((s: any) => s.priority === 1).length

    // isNewDriver check
    const d14 = new Date(); d14.setDate(d14.getDate() - 14)
    const recentTripCount = await (prisma as any).thServiceTrip.count({
      where: { vehicleId, date: { gte: d14 }, status: 'visited' }
    })
    const isNewDriver = recentTripCount < 5

    res.json({
      success: true,
      data: {
        streets: scored,
        hasStreetData: true,
        isNewDriver,
        mfyVisitedToday,
        mfyCoveragePctToday,
        totalStreets: scored.length,
        neverCount,
        rareCount,
      },
    })
  } catch (err) { next(err) }
}

/**
 * Public: haydovchi token orqali bugungi marshut taklifini oladi.
 * GET /th/routes/public?token=X&date=Y
 */
export async function getRoutePublic(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, date } = req.query as Record<string, string>
    if (!token) return res.status(400).json({ error: 'token talab qilinadi' })

    const payload = verifyDriverToken(token)
    if (!payload) return res.status(401).json({ error: 'Token noto\'g\'ri yoki muddati o\'tgan' })

    const targetDate = date ? new Date(date + 'T00:00:00.000Z') : new Date()
    const route = await suggestDayRoute(payload.vehicleId, targetDate)

    res.json({ success: true, data: { vehicleId: payload.vehicleId, date: targetDate, route } })
  } catch (err) { next(err) }
}
