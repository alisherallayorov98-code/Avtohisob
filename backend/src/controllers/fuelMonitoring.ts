/**
 * Bakdagi yoqilg'i miqdori — real-time monitoring.
 *
 * Endpoints:
 *   GET    /api/fuel-monitoring/levels           — joriy holat (frontend har 30s polling)
 *   GET    /api/fuel-monitoring/savings?days=7   — tejov hisoblagichi (sliv aniqlash bilan)
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
import { detectFuelAnomaly, sendFuelAlertIfNeeded, lookupActiveDriver, FuelAnomalyType } from '../lib/fuelAnomalyDetector'

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

        // 3. Anomaliya bo'lsa, haydovchini topamiz (Waybill cross-check)
        //    Qonuniy snapshot uchun lookup qilmaymiz — har 30s'da DB so'rov
        //    qimmatga tushadi. Faqat anomaliya uchun.
        let driver: { id: string; fullName: string } | null = null
        if (detection.anomaly) {
          driver = await lookupActiveDriver(r.vehicleId, capturedAt)
        }

        // 4. Snapshot saqlash (anomaliya markeri, delta, GPS va haydovchi bilan)
        await (prisma as any).fuelReading.create({
          data: {
            vehicleId: r.vehicleId,
            level: r.liters,
            capacity: r.capacity,
            percentage: r.percentage,
            anomaly: detection.anomaly,
            deltaL: (detection as any).details?.deltaL ?? null,
            lat: r.lat,
            lon: r.lon,
            driverId: driver?.id ?? null,
            driverName: driver?.fullName ?? null,
            capturedAt,
          },
        }).catch(() => {})

        // 5. Telegram alert (faqat sliv va qayd etilmagan zapravka uchun)
        //    Qonuniy refuel uchun alertText bo'lmaydi → sendFuelAlertIfNeeded skip qiladi.
        //    Anti-spam: TelegramAlertDedupe (24 soat) sendToOrgAdminsFiltered ichida.
        if (detection.anomaly && detection.alertText) {
          sendFuelAlertIfNeeded(r.vehicleId, detection, driver).catch(() => {})
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

// ─── GET /api/fuel-monitoring/savings?days=7 ────────────────────────────────
// Tejov hisoblagichi: aniqlangan sliv va qayd etilmagan zapravkalardan tejov hisobi.
// Diesel narxi: oxirgi 30 kunlik FuelRecord'lardan o'rtacha. Yo'q bo'lsa fallback.
const DEFAULT_DIESEL_PRICE_UZS = 13_000  // 2026-yil O'zbekistondagi taxminiy diesel narxi
export async function getFuelSavings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'super_admin') throw new AppError('Faqat tashkilot foydalanuvchilari uchun', 403)

    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 365)
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)

    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    // Org doirasidagi mashinalar
    const vehicleWhere: any = {}
    if (bv !== undefined) vehicleWhere.branchId = bv
    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    const vehicleIds = vehicles.map(v => v.id)
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))

    // Anomaliya yozuvlari (sliv va qayd etilmagan zapravka)
    const anomalies = await (prisma as any).fuelReading.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        anomaly: { in: ['theft', 'unrecorded_refuel'] },
        capturedAt: { gte: since },
      },
      select: { vehicleId: true, anomaly: true, deltaL: true, capturedAt: true },
      orderBy: { capturedAt: 'desc' },
    })

    // Diesel narxini aniqlash — oxirgi 30 kun davomida o'rtacha
    const priceWindow = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const recentFuelRecords = await prisma.fuelRecord.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        fuelType: 'diesel',
        refuelDate: { gte: priceWindow },
      },
      select: { amountLiters: true, cost: true },
    })
    let dieselPrice = DEFAULT_DIESEL_PRICE_UZS
    if (recentFuelRecords.length > 0) {
      const totalLiters = recentFuelRecords.reduce((s, r) => s + Number(r.amountLiters), 0)
      const totalCost = recentFuelRecords.reduce((s, r) => s + Number(r.cost), 0)
      if (totalLiters > 0) dieselPrice = Math.round(totalCost / totalLiters)
    }

    // Statistika tuzish
    let theftLiters = 0
    let unrecordedLiters = 0
    let theftEvents = 0
    let unrecordedEvents = 0
    const byVehicle = new Map<string, { liters: number; events: number; lastAt: Date | null }>()

    for (const a of anomalies) {
      const delta = Math.abs(Number(a.deltaL ?? 0))
      // Eski yozuvlar deltaL=null bilan ham bo'lishi mumkin (migratsiyadan oldin) — skip
      if (delta === 0) {
        // Hodisa sanog'iga qo'shamiz, lekin litr 0
        if (a.anomaly === 'theft') theftEvents++
        else unrecordedEvents++
        continue
      }
      if (a.anomaly === 'theft') {
        theftLiters += delta
        theftEvents++
      } else {
        unrecordedLiters += delta
        unrecordedEvents++
      }
      const cur = byVehicle.get(a.vehicleId) || { liters: 0, events: 0, lastAt: null }
      cur.liters += delta
      cur.events++
      if (!cur.lastAt || a.capturedAt > cur.lastAt) cur.lastAt = a.capturedAt
      byVehicle.set(a.vehicleId, cur)
    }

    const totalLiters = theftLiters + unrecordedLiters
    const totalSavings = Math.round(totalLiters * dieselPrice)

    // Top 5 mashina (eng ko'p sliv)
    const topVehicles = [...byVehicle.entries()]
      .map(([vehicleId, s]) => ({
        vehicleId,
        registrationNumber: vehicleMap.get(vehicleId)?.registrationNumber || '',
        brand: vehicleMap.get(vehicleId)?.brand || '',
        model: vehicleMap.get(vehicleId)?.model || '',
        liters: Math.round(s.liters * 10) / 10,
        cost: Math.round(s.liters * dieselPrice),
        events: s.events,
        lastAt: s.lastAt,
      }))
      .sort((a, b) => b.liters - a.liters)
      .slice(0, 5)

    res.json({
      success: true,
      data: {
        days,
        since,
        dieselPrice,
        priceSource: recentFuelRecords.length > 0 ? 'fuel_records_avg' : 'default',
        totalSavings,
        totalLiters: Math.round(totalLiters * 10) / 10,
        theft: {
          liters: Math.round(theftLiters * 10) / 10,
          cost: Math.round(theftLiters * dieselPrice),
          events: theftEvents,
        },
        unrecordedRefuel: {
          liters: Math.round(unrecordedLiters * 10) / 10,
          cost: Math.round(unrecordedLiters * dieselPrice),
          events: unrecordedEvents,
        },
        topVehicles,
      },
    })
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
      select: { level: true, percentage: true, anomaly: true, deltaL: true, lat: true, lon: true, driverName: true, capturedAt: true },
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
          deltaL: r.deltaL,
          lat: r.lat,
          lon: r.lon,
          driverName: r.driverName,
          capturedAt: r.capturedAt,
        })),
        meta: { hours, count: readings.length },
      },
    })
  } catch (err) { next(err) }
}

// ─── POST /api/fuel-monitoring/bulk-tank-capacity ────────────────────────────
// Bak hajmlarini ommaviy sozlash. 60-80 mashinaga bittama-bitta kirish o'rniga
// bir vaqtning o'zida hammasini saqlash. Format:
// { items: [{ vehicleId | registrationNumber, tankCapacity, fuelSensorName? }] }
export async function bulkUpdateTankCapacity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!['admin', 'manager', 'branch_manager'].includes(req.user!.role)) {
      throw new AppError("Ruxsat yo'q", 403)
    }

    const items: Array<{
      vehicleId?: string
      registrationNumber?: string
      tankCapacity?: number | null
      fuelSensorName?: string | null
    }> = req.body?.items || []

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('Bo\'sh ro\'yxat yuborildi', 400)
    }
    if (items.length > 1000) {
      throw new AppError('Bir martada 1000 dan ko\'p mashina yangilanmaydi', 400)
    }

    // Org-filter: foydalanuvchi faqat o'z org/filialidagi mashinalarni o'zgartira oladi
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    // Mashinalarni topish: vehicleId orqali yoki registrationNumber bo'yicha
    const vehicleIds = items.map(i => i.vehicleId).filter(Boolean) as string[]
    const regs = items.map(i => i.registrationNumber).filter(Boolean) as string[]

    const where: any = { OR: [] }
    if (vehicleIds.length) where.OR.push({ id: { in: vehicleIds } })
    if (regs.length) where.OR.push({ registrationNumber: { in: regs } })
    if (where.OR.length === 0) {
      throw new AppError("Hech qaysi mashina aniqlanmadi (vehicleId yoki registrationNumber kerak)", 400)
    }
    if (bv !== undefined) where.branchId = bv

    const vehicles = await prisma.vehicle.findMany({
      where,
      select: { id: true, registrationNumber: true, branchId: true },
    })

    // Lookup map
    const byId = new Map(vehicles.map(v => [v.id, v]))
    const byReg = new Map(vehicles.map(v => [v.registrationNumber.toUpperCase().trim(), v]))

    let updated = 0
    let skipped = 0
    const errors: string[] = []

    for (const item of items) {
      // Hajmni tekshirish
      const cap = item.tankCapacity == null ? null : Number(item.tankCapacity)
      if (cap != null && (!isFinite(cap) || cap < 0 || cap > 10000)) {
        errors.push(`${item.registrationNumber || item.vehicleId}: bak hajmi 0-10000 oralig'ida bo'lishi kerak`)
        skipped++
        continue
      }

      // Mashinani topish
      let vehicle: { id: string; registrationNumber: string; branchId: string } | undefined
      if (item.vehicleId) vehicle = byId.get(item.vehicleId)
      if (!vehicle && item.registrationNumber) vehicle = byReg.get(item.registrationNumber.toUpperCase().trim())

      if (!vehicle) {
        errors.push(`${item.registrationNumber || item.vehicleId}: mashina topilmadi yoki sizning org/filialingizga tegishli emas`)
        skipped++
        continue
      }

      try {
        await prisma.vehicle.update({
          where: { id: vehicle.id },
          data: {
            ...(item.tankCapacity !== undefined && { tankCapacity: cap }),
            ...(item.fuelSensorName !== undefined && { fuelSensorName: item.fuelSensorName?.trim() || null }),
          },
        })
        updated++
      } catch (err: any) {
        errors.push(`${vehicle.registrationNumber}: ${err.message}`)
        skipped++
      }
    }

    res.json({
      success: true,
      data: { updated, skipped, errors: errors.slice(0, 50) }, // 50 dan ko'p xato qaytarmaymiz
      message: `${updated} ta mashina yangilandi${skipped > 0 ? `, ${skipped} ta o'tkazib yuborildi` : ''}`,
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
