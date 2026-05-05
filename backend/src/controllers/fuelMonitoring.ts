/**
 * Bakdagi yoqilg'i miqdori — real-time monitoring.
 *
 * Endpoints:
 *   GET    /api/fuel-monitoring/levels           — joriy holat (frontend har 30s polling)
 *   POST   /api/fuel-monitoring/refresh          — Wialon'dan yangilab olish (manual / cache miss)
 *   GET    /api/fuel-monitoring/:vehicleId/history?hours=24  — sutkalik grafik
 *   PATCH  /api/fuel-monitoring/:vehicleId/settings — bak hajmi va sensor nomini sozlash
 *
 * Cache strategiyasi:
 *   - Vehicle.lastFuelLevel + Vehicle.lastFuelUpdate → DB cache (30s TTL)
 *   - GET /levels — agar cache yangi bo'lsa darhol qaytaradi
 *   - Cache eskirgan bo'lsa — fonda Wialon'dan tortadi (yoki sync_throttle bilan bloklanadi)
 *
 * Kerakli rolar:
 *   GET levels, history → all (filial menejerlari ham)
 *   PATCH settings → admin / manager
 */
import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'
import { getOrgFuelLevels } from '../services/wialonService'
import { detectFuelAnomaly, sendFuelAlertIfNeeded, FuelAnomalyType } from '../lib/fuelAnomalyDetector'

const CACHE_TTL_MS = 30 * 1000  // 30 sekund — frontend polling intervaliga moslangan

// In-flight protection: bir vaqtning o'zida bir tashkilot uchun bitta sync
const inFlightOrg = new Map<string, Promise<void>>()

async function syncOrgFromWialon(orgId: string): Promise<void> {
  // Mavjud sync bor bo'lsa unga ulanamiz (duplicate Wialon API call'lar oldini olamiz)
  const existing = inFlightOrg.get(orgId)
  if (existing) return existing

  const promise = (async () => {
    try {
      // Tashkilot uchun faol GPS credential topamiz
      const cred = await (prisma as any).gpsCredential.findFirst({
        where: { orgId, isActive: true },
        select: { id: true },
      })
      if (!cred) return  // GPS ulanmagan — silently skip

      const readings = await getOrgFuelLevels(cred.id)

      // Vehicle cache yangilash + anomaliya aniqlash + snapshot saqlash
      for (const r of readings) {
        if (r.liters == null) continue  // sensor yo'q yoki signal yo'q

        const capturedAt = r.capturedAt ?? new Date()

        // 1. Cache yangilash (UI tezkor javob uchun)
        await prisma.vehicle.update({
          where: { id: r.vehicleId },
          data: {
            lastFuelLevel: r.liters,
            lastFuelUpdate: capturedAt,
          },
        }).catch(() => {})

        // 2. Anomaliya aniqlash (oldingi snapshot bilan solishtirib)
        //    Eslatma: detector DB ga hech narsa yozmaydi — natijani qaytaradi.
        const detection = await detectFuelAnomaly({
          vehicleId: r.vehicleId,
          newLevel: r.liters,
          newCapturedAt: capturedAt,
        }).catch(err => {
          console.warn('[fuelMonitoring] anomaly detect xato:', err.message)
          return { anomaly: null as FuelAnomalyType | null, alertText: undefined }
        })

        // 3. Snapshot saqlash (anomaliya markeri bilan)
        await (prisma as any).fuelReading.create({
          data: {
            vehicleId: r.vehicleId,
            level: r.liters,
            capacity: r.capacity,
            percentage: r.percentage,
            anomaly: detection.anomaly,
            capturedAt,
          },
        }).catch(() => {})

        // 4. Telegram alert (faqat sliv va qayd etilmagan zapravka uchun)
        //    Qonuniy refuel uchun alertText bo'lmaydi → sendFuelAlertIfNeeded skip qiladi.
        //    Anti-spam: TelegramAlertDedupe (24 soat) sendToOrgAdminsFiltered ichida.
        if (detection.anomaly && detection.alertText) {
          sendFuelAlertIfNeeded(r.vehicleId, detection).catch(() => {})
        }
      }
    } finally {
      inFlightOrg.delete(orgId)
    }
  })()

  inFlightOrg.set(orgId, promise)
  return promise
}

// ─── GET /api/fuel-monitoring/levels ─────────────────────────────────────────
// Frontend har 30s da chaqiradi. DB cache'dan tezkor javob, fonda yangilash.
export async function getFuelLevels(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'super_admin') throw new AppError('Faqat tashkilot foydalanuvchilari uchun', 403)

    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    const where: any = { status: { in: ['active', 'maintenance'] } }
    if (bv !== undefined) where.branchId = bv

    // 1. DB cache'dan o'qiymiz (tez)
    const vehicles = await prisma.vehicle.findMany({
      where,
      select: {
        id: true, registrationNumber: true, brand: true, model: true,
        tankCapacity: true, fuelSensorName: true,
        lastFuelLevel: true, lastFuelUpdate: true,
        gpsUnitName: true, lastGpsSignal: true,
      },
      orderBy: { registrationNumber: 'asc' },
    })

    // 2. Cache eskirganmi tekshiramiz — eskirgan bo'lsa fonda yangilab olamiz
    const now = Date.now()
    const newest = vehicles.reduce((max, v) => {
      const t = v.lastFuelUpdate ? new Date(v.lastFuelUpdate).getTime() : 0
      return t > max ? t : max
    }, 0)
    const cacheStale = !newest || (now - newest) > CACHE_TTL_MS

    // Tashkilot ID'sini aniqlash (orgId — branchId yoki uning organizationId'si)
    let orgId: string | null = null
    if (req.user!.role === 'admin' && req.user!.branchId) {
      orgId = req.user!.branchId  // admin filiali = root tashkilot
    } else if (req.user!.branchId) {
      const b = await prisma.branch.findUnique({
        where: { id: req.user!.branchId },
        select: { organizationId: true },
      })
      orgId = b?.organizationId ?? req.user!.branchId
    }

    let syncTriggered = false
    if (cacheStale && orgId) {
      // Foreground emas, fire-and-forget — frontend keyingi pollingda yangi qiymatlarni oladi
      syncOrgFromWialon(orgId).catch(() => {})
      syncTriggered = true
    }

    // 3. Format the response
    const data = vehicles.map(v => {
      const liters = v.lastFuelLevel != null ? Number(v.lastFuelLevel) : null
      const capacity = v.tankCapacity ? Number(v.tankCapacity) : null
      const percentage = liters != null && capacity && capacity > 0
        ? Math.round((liters / capacity) * 1000) / 10
        : null

      const updatedAt = v.lastFuelUpdate ? new Date(v.lastFuelUpdate).getTime() : null
      const ageSec = updatedAt ? Math.floor((now - updatedAt) / 1000) : null

      // Status:
      //   no_setup     — bak hajmi sozlanmagan
      //   no_signal    — sensor sozlangan, lekin GPS dan signal yo'q (5 daqiqadan ko'p)
      //   live         — yangi (< 1 daqiqa)
      //   stale        — 1-5 daqiqa orasida
      //   ok           — boshqa
      let status: 'no_setup' | 'no_signal' | 'live' | 'stale' | 'ok' = 'ok'
      if (capacity == null) status = 'no_setup'
      else if (ageSec == null || ageSec > 300) status = 'no_signal'
      else if (ageSec < 60) status = 'live'
      else if (ageSec < 300) status = 'stale'

      // Tank darajasi:
      //   critical (< 10%), low (< 25%), normal
      let level: 'critical' | 'low' | 'normal' | null = null
      if (percentage != null) {
        if (percentage < 10) level = 'critical'
        else if (percentage < 25) level = 'low'
        else level = 'normal'
      }

      return {
        vehicleId: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand,
        model: v.model,
        tankCapacity: capacity,
        currentLiters: liters,
        percentage,
        sensorName: v.fuelSensorName,
        gpsUnitName: v.gpsUnitName,
        lastUpdate: v.lastFuelUpdate,
        ageSec,
        status,
        level,
      }
    })

    res.json({
      success: true,
      data,
      meta: {
        total: data.length,
        cacheAgeSec: newest ? Math.floor((now - newest) / 1000) : null,
        syncTriggered,
      },
    })
  } catch (err) { next(err) }
}

// ─── POST /api/fuel-monitoring/refresh ───────────────────────────────────────
// Foydalanuvchi qo'lda yangilash so'raydi (UI tugma).
export async function refreshFuelLevels(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'super_admin') throw new AppError('Faqat tashkilot foydalanuvchilari uchun', 403)

    let orgId: string | null = null
    if (req.user!.role === 'admin' && req.user!.branchId) {
      orgId = req.user!.branchId
    } else if (req.user!.branchId) {
      const b = await prisma.branch.findUnique({
        where: { id: req.user!.branchId },
        select: { organizationId: true },
      })
      orgId = b?.organizationId ?? req.user!.branchId
    }

    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 400)

    await syncOrgFromWialon(orgId)
    res.json(successResponse(null, 'Yangilandi'))
  } catch (err) { next(err) }
}

// ─── GET /api/fuel-monitoring/:vehicleId/history?hours=24 ────────────────────
// Mashina uchun sutkalik (yoki boshqa davr) grafik.
export async function getFuelHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168)  // 1h - 7 kun

    // Vehicle org-filter check
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, registrationNumber: true, branchId: true, tankCapacity: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)
    if (bv !== undefined && vehicle.branchId !== bv) throw new AppError("Ruxsat yo'q", 403)

    const since = new Date(Date.now() - hours * 3600 * 1000)
    const readings = await (prisma as any).fuelReading.findMany({
      where: { vehicleId, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
      select: { level: true, percentage: true, anomaly: true, capturedAt: true },
    })

    res.json({
      success: true,
      data: {
        vehicle: {
          id: vehicle.id,
          registrationNumber: vehicle.registrationNumber,
          tankCapacity: vehicle.tankCapacity ? Number(vehicle.tankCapacity) : null,
        },
        readings: readings.map((r: any) => ({
          level: Number(r.level),
          percentage: r.percentage != null ? Number(r.percentage) : null,
          anomaly: r.anomaly,
          capturedAt: r.capturedAt,
        })),
        meta: { hours, count: readings.length },
      },
    })
  } catch (err) { next(err) }
}

// ─── PATCH /api/fuel-monitoring/:vehicleId/settings ──────────────────────────
// Bak hajmi va sensor nomini sozlash.
export async function updateFuelSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!['admin', 'manager', 'branch_manager'].includes(req.user!.role)) {
      throw new AppError("Ruxsat yo'q", 403)
    }
    const { vehicleId } = req.params
    const { tankCapacity, fuelSensorName } = req.body

    if (tankCapacity != null) {
      const cap = Number(tankCapacity)
      if (!isFinite(cap) || cap < 0 || cap > 10000) {
        throw new AppError("Bak hajmi 0-10000 litr orasida bo'lishi kerak", 400)
      }
    }

    // Org-filter
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { branchId: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)
    if (bv !== undefined && vehicle.branchId !== bv) throw new AppError("Ruxsat yo'q", 403)

    const updated = await prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        ...(tankCapacity !== undefined && { tankCapacity: tankCapacity != null ? Number(tankCapacity) : null }),
        ...(fuelSensorName !== undefined && { fuelSensorName: fuelSensorName?.trim() || null }),
      },
      select: { id: true, tankCapacity: true, fuelSensorName: true },
    })
    res.json(successResponse(updated, 'Saqlandi'))
  } catch (err) { next(err) }
}
