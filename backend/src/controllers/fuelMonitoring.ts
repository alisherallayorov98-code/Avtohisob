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
import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, resolveOrgId } from '../lib/orgFilter'
import { resolvePriceForDate } from './fuelPrices'
import { getOrgFuelLevels } from '../services/wialonService'

// Yoqilg'i turi → birlik (gaz m³, elektr kWh, qolgani L)
const unitForFuelType = (ft: string) => ft === 'gas' ? 'm³' : ft === 'electric' ? 'kWh' : 'L'
// Narx topilmaganda zaxira (so'm/birlik)
const defaultPriceForFuelType = (ft: string) => ft === 'diesel' ? 13_000 : ft === 'gas' ? 5_500 : ft === 'electric' ? 1_000 : 12_000
import { detectFuelAnomaly, sendFuelAlertIfNeeded, lookupActiveDriver, getThresholdsForOrg, FuelAnomalyType } from '../lib/fuelAnomalyDetector'
import { emitToOrg } from '../lib/socket'
import { latinToCyrillic } from '../lib/transliterate'

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

      // Tashkilot uchun threshold'larni bir marta o'qib olamiz (cache 60s).
      // Barcha mashinalar uchun shu qiymatlardan foydalanamiz.
      const thresholds = await getThresholdsForOrg(orgId)

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
        //    Threshold'lar OrgSettings'dan (yoki default) — har tashkilot moslashtira oladi.
        const detection = await detectFuelAnomaly({
          vehicleId: r.vehicleId,
          newLevel: r.liters,
          newCapturedAt: capturedAt,
          thresholds,
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

        // 5. Telegram alert + WebSocket push (faqat sliv va qayd etilmagan zapravka uchun)
        //    Qonuniy refuel uchun alertText bo'lmaydi → sendFuelAlertIfNeeded skip qiladi.
        //    Anti-spam: TelegramAlertDedupe (24 soat) sendToOrgAdminsFiltered ichida.
        if (detection.anomaly && detection.alertText) {
          sendFuelAlertIfNeeded(r.vehicleId, detection, driver).catch(() => {})
          // Real-time push: orgdagi barcha online foydalanuvchilarga toast
          // (Telegram ulanmaganlar ham darrov ko'radi)
          emitToOrg(orgId, 'fuel:anomaly', {
            vehicleId: r.vehicleId,
            registrationNumber: r.registrationNumber,
            anomaly: detection.anomaly,
            deltaL: (detection as any).details?.deltaL ?? null,
            level: r.liters,
            lat: r.lat,
            lon: r.lon,
            driverName: driver?.fullName ?? null,
            capturedAt,
          })
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
// Narx: har yoqilg'i turi uchun "Narxlar" tarixidan yoki chek o'rtachasidan.
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
      select: { id: true, registrationNumber: true, brand: true, model: true, fuelType: true },
    })
    const vehicleIds = vehicles.map(v => v.id)
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
    const vehFuel = new Map(vehicles.map(v => [v.id, v.fuelType]))

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

    // Narx — HAR yoqilg'i turi uchun alohida (gaz/dizel/benzin har xil narx).
    // Avval "Narxlar" tarixidan, topilmasa oxirgi 30 kun chek o'rtachasidan, oxirida zaxira.
    const orgId = await resolveOrgId(req.user!)
    const priceWindow = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const fuelTypes = [...new Set(vehicles.map(v => v.fuelType))]
    const priceMap = new Map<string, number>()
    const priceSrcMap = new Map<string, string>()
    for (const ft of fuelTypes) {
      let price = orgId ? await resolvePriceForDate(orgId, ft, new Date()) : null
      let src = 'price_history'
      if (!price || price <= 0) {
        const recs = await prisma.fuelRecord.findMany({
          where: { vehicleId: { in: vehicleIds }, fuelType: ft, refuelDate: { gte: priceWindow } },
          select: { amountLiters: true, cost: true },
        })
        const tL = recs.reduce((s, r) => s + Number(r.amountLiters), 0)
        const tC = recs.reduce((s, r) => s + Number(r.cost), 0)
        if (tL > 0 && tC > 0) { price = Math.round(tC / tL); src = 'fuel_records_avg' }
      }
      if (!price || price <= 0) { price = defaultPriceForFuelType(ft); src = 'default' }
      priceMap.set(ft, price)
      priceSrcMap.set(ft, src)
    }
    const priceForV = (vid: string) => priceMap.get(vehFuel.get(vid) || '') ?? 0

    // Statistika tuzish — narx har mashinaning yoqilg'i turiga qarab
    let theftLiters = 0, unrecordedLiters = 0, theftEvents = 0, unrecordedEvents = 0
    let theftCost = 0, unrecordedCost = 0
    const byVehicle = new Map<string, { liters: number; cost: number; events: number; lastAt: Date | null }>()

    for (const a of anomalies) {
      const delta = Math.abs(Number(a.deltaL ?? 0))
      const cost = Math.round(delta * priceForV(a.vehicleId))
      if (a.anomaly === 'theft') { theftLiters += delta; theftCost += cost; theftEvents++ }
      else { unrecordedLiters += delta; unrecordedCost += cost; unrecordedEvents++ }
      if (delta === 0) continue  // eski deltaL=null yozuvlar — litr 0, faqat hodisa sanaladi
      const cur = byVehicle.get(a.vehicleId) || { liters: 0, cost: 0, events: 0, lastAt: null }
      cur.liters += delta
      cur.cost += cost
      cur.events++
      if (!cur.lastAt || a.capturedAt > cur.lastAt) cur.lastAt = a.capturedAt
      byVehicle.set(a.vehicleId, cur)
    }

    const totalLiters = theftLiters + unrecordedLiters
    const totalSavings = theftCost + unrecordedCost

    // Top 5 mashina (eng ko'p sliv summasi bo'yicha)
    const topVehicles = [...byVehicle.entries()]
      .map(([vehicleId, s]) => ({
        vehicleId,
        registrationNumber: vehicleMap.get(vehicleId)?.registrationNumber || '',
        brand: vehicleMap.get(vehicleId)?.brand || '',
        model: vehicleMap.get(vehicleId)?.model || '',
        unit: unitForFuelType(vehFuel.get(vehicleId) || 'diesel'),
        liters: Math.round(s.liters * 10) / 10,
        cost: s.cost,
        events: s.events,
        lastAt: s.lastAt,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5)

    // Dominant yoqilg'i turi — footer/birlik uchun
    const fuelCount = new Map<string, number>()
    for (const v of vehicles) fuelCount.set(v.fuelType, (fuelCount.get(v.fuelType) || 0) + 1)
    const dominant = [...fuelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'diesel'

    res.json({
      success: true,
      data: {
        days,
        since,
        fuelType: dominant,
        unit: unitForFuelType(dominant),
        unitPrice: priceMap.get(dominant) ?? 0,
        priceSource: priceSrcMap.get(dominant) ?? 'default',
        dieselPrice: priceMap.get(dominant) ?? 0,  // eski frontend uchun
        totalSavings,
        totalLiters: Math.round(totalLiters * 10) / 10,
        theft: { liters: Math.round(theftLiters * 10) / 10, cost: theftCost, events: theftEvents },
        unrecordedRefuel: { liters: Math.round(unrecordedLiters * 10) / 10, cost: unrecordedCost, events: unrecordedEvents },
        topVehicles,
      },
    })
  } catch (err) { next(err) }
}

// ─── GET /api/fuel-monitoring/efficiency?days=30 ─────────────────────────────
// Mashinalar yoqilg'i samaradorligi: L/100km hisobi.
// FuelRecord.amountLiters (kirim) / GPS km (o'tilgan masofa) × 100.
// Sortlangan: eng yomon (yuqori L/100km) tepaga.
export async function getFuelEfficiency(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'super_admin') throw new AppError('Faqat tashkilot foydalanuvchilari uchun', 403)

    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365)
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)

    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    const vehicleWhere: any = { status: 'active' }
    if (bv !== undefined) vehicleWhere.branchId = bv

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: { id: true, registrationNumber: true, brand: true, model: true, fuelType: true, mileage: true },
    })
    const vehicleIds = vehicles.map(v => v.id)

    // Davr boshidagi GPS km (eng birinchi log)
    const firstLogs = await (prisma as any).gpsMileageLog.findMany({
      where: { vehicleId: { in: vehicleIds }, skipped: false, syncedAt: { gte: since } },
      orderBy: { syncedAt: 'asc' },
      select: { vehicleId: true, gpsMileageKm: true, syncedAt: true },
    })
    // Vehicle uchun birinchi log (har vehicleId uchun bittasi)
    const firstByVehicle = new Map<string, number>()
    for (const log of firstLogs) {
      if (!firstByVehicle.has(log.vehicleId)) {
        firstByVehicle.set(log.vehicleId, Number(log.gpsMileageKm))
      }
    }

    // Davr ichidagi yoqilg'i kirimlari
    const fuelRecords = await prisma.fuelRecord.groupBy({
      by: ['vehicleId'],
      where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: since } },
      _sum: { amountLiters: true, cost: true },
      _count: true,
    })
    const fuelByVehicle = new Map<string, { liters: number; cost: number; count: number }>()
    for (const f of fuelRecords) {
      fuelByVehicle.set(f.vehicleId, {
        liters: Number(f._sum.amountLiters || 0),
        cost: Number(f._sum.cost || 0),
        count: f._count,
      })
    }

    // Hisoblash
    const items = vehicles.map(v => {
      const startKm = firstByVehicle.get(v.id) ?? null
      const endKm = Number(v.mileage)
      const km = startKm != null ? Math.max(0, endKm - startKm) : 0
      const fuel = fuelByVehicle.get(v.id) || { liters: 0, cost: 0, count: 0 }
      // L/100km — faqat yetarli ma'lumot bo'lganda hisoblanadi
      const efficient = km >= 100 && fuel.liters >= 10
      const lPer100km = efficient ? Math.round((fuel.liters * 100 / km) * 10) / 10 : null

      return {
        vehicleId: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand,
        model: v.model,
        fuelType: v.fuelType,
        km: Math.round(km),
        liters: Math.round(fuel.liters * 10) / 10,
        cost: Math.round(fuel.cost),
        refuelCount: fuel.count,
        lPer100km,
        startKm,
        endKm,
      }
    })

    // Statistika: o'rtacha, max, min — faqat hisoblanganlar bo'yicha
    const computed = items.filter(i => i.lPer100km != null)
    const avg = computed.length > 0
      ? Math.round((computed.reduce((s, i) => s + i.lPer100km!, 0) / computed.length) * 10) / 10
      : null
    const max = computed.length > 0 ? Math.max(...computed.map(i => i.lPer100km!)) : null
    const min = computed.length > 0 ? Math.min(...computed.map(i => i.lPer100km!)) : null

    // Sort: yomondan yaxshigacha (yuqori L/100km tepada)
    items.sort((a, b) => {
      if (a.lPer100km == null && b.lPer100km == null) return 0
      if (a.lPer100km == null) return 1
      if (b.lPer100km == null) return -1
      return b.lPer100km - a.lPer100km
    })

    res.json({
      success: true,
      data: {
        days,
        since,
        items,
        stats: {
          totalVehicles: vehicles.length,
          computedCount: computed.length,
          avg, max, min,
        },
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

// ─── GET /api/fuel-monitoring/report?days=30&lang=uz|uz-cyrl|ru ──────────────
// Excel hisobot: 3 sheet — Xulosa, Anomaliyalar, Mashinalar.
// uz-cyrl uchun butun workbook avto-transliteratsiya qilinadi.
export async function exportFuelReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'super_admin') throw new AppError('Faqat tashkilot foydalanuvchilari uchun', 403)

    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)
    const lang = (req.query.lang as string)?.toLowerCase()
    const useCyrl = lang === 'uz-cyrl'

    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    // Mashinalar
    const vehicleWhere: any = { status: { in: ['active', 'maintenance'] } }
    if (bv !== undefined) vehicleWhere.branchId = bv
    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true,
                branch: { select: { name: true } } },
    })
    const vehicleIds = vehicles.map(v => v.id)
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))

    // Anomaliyalar
    const anomalies = await (prisma as any).fuelReading.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        anomaly: { in: ['theft', 'unrecorded_refuel'] },
        capturedAt: { gte: since },
      },
      orderBy: { capturedAt: 'desc' },
      select: {
        vehicleId: true, anomaly: true, deltaL: true, level: true,
        lat: true, lon: true, driverName: true, capturedAt: true,
      },
    })

    // Diesel narxi (savings endpoint'idagi mantiq)
    const priceWindow = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const recent = await prisma.fuelRecord.findMany({
      where: { vehicleId: { in: vehicleIds }, fuelType: 'diesel', refuelDate: { gte: priceWindow } },
      select: { amountLiters: true, cost: true },
    })
    let dieselPrice = 13_000
    if (recent.length > 0) {
      const tL = recent.reduce((s, r) => s + Number(r.amountLiters), 0)
      const tC = recent.reduce((s, r) => s + Number(r.cost), 0)
      if (tL > 0) dieselPrice = Math.round(tC / tL)
    }

    // Per-vehicle summary
    const vehSummary = new Map<string, { theftL: number; theftCount: number; refuelL: number; refuelCount: number }>()
    let totalTheft = 0, totalUnrecorded = 0, theftEvents = 0, unrecordedEvents = 0
    for (const a of anomalies) {
      const dl = Math.abs(Number(a.deltaL ?? 0))
      const cur = vehSummary.get(a.vehicleId) || { theftL: 0, theftCount: 0, refuelL: 0, refuelCount: 0 }
      if (a.anomaly === 'theft') {
        cur.theftL += dl; cur.theftCount++
        totalTheft += dl; theftEvents++
      } else {
        cur.refuelL += dl; cur.refuelCount++
        totalUnrecorded += dl; unrecordedEvents++
      }
      vehSummary.set(a.vehicleId, cur)
    }

    // Workbook yaratish
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Avtohisob'
    wb.created = new Date()

    // ── Sheet 1: Xulosa ──
    const wsSummary = wb.addWorksheet('Xulosa')
    wsSummary.columns = [
      { header: 'Ko\'rsatkich', key: 'k', width: 36 },
      { header: 'Qiymat', key: 'v', width: 30 },
    ]
    wsSummary.addRow({ k: 'Davr', v: `${since.toLocaleDateString('uz-UZ')} — ${new Date().toLocaleDateString('uz-UZ')} (${days} kun)` })
    wsSummary.addRow({ k: 'Hisobot yaratildi', v: new Date().toLocaleString('uz-UZ') })
    wsSummary.addRow({})
    wsSummary.addRow({ k: 'Mashinalar soni', v: vehicles.length })
    wsSummary.addRow({})
    wsSummary.addRow({ k: 'Sliv hodisalari', v: theftEvents })
    wsSummary.addRow({ k: 'Sliv miqdori (L)', v: Math.round(totalTheft * 10) / 10 })
    wsSummary.addRow({ k: 'Sliv summasi (so\'m)', v: Math.round(totalTheft * dieselPrice) })
    wsSummary.addRow({})
    wsSummary.addRow({ k: 'Qayd etilmagan zapravka hodisalari', v: unrecordedEvents })
    wsSummary.addRow({ k: 'Qayd etilmagan miqdor (L)', v: Math.round(totalUnrecorded * 10) / 10 })
    wsSummary.addRow({ k: 'Qayd etilmagan summa (so\'m)', v: Math.round(totalUnrecorded * dieselPrice) })
    wsSummary.addRow({})
    wsSummary.addRow({ k: 'JAMI TEJOV (so\'m)', v: Math.round((totalTheft + totalUnrecorded) * dieselPrice) })
    wsSummary.addRow({ k: 'Diesel narxi (so\'m/L)', v: dieselPrice })
    // Sarlavha bezagi
    const summaryHeader = wsSummary.getRow(1)
    summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } }
    summaryHeader.height = 24
    // Eng oxirgi qator (jami) yorqinroq
    const totalRow = wsSummary.getRow(13)
    totalRow.font = { bold: true, size: 12 }
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }

    // ── Sheet 2: Anomaliyalar ──
    const wsAnomaly = wb.addWorksheet('Anomaliyalar')
    wsAnomaly.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Sana', key: 'date', width: 18 },
      { header: 'Mashina', key: 'reg', width: 16 },
      { header: 'Filial', key: 'branch', width: 20 },
      { header: 'Tur', key: 'type', width: 18 },
      { header: 'Miqdor (L)', key: 'liters', width: 12 },
      { header: 'Bak (L)', key: 'level', width: 10 },
      { header: 'Haydovchi', key: 'driver', width: 24 },
      { header: 'GPS Lat', key: 'lat', width: 14 },
      { header: 'GPS Lon', key: 'lon', width: 14 },
      { header: 'Xarita', key: 'mapLink', width: 28 },
    ]
    let no = 1
    for (const a of anomalies) {
      const v = vehicleMap.get(a.vehicleId)
      const isTheft = a.anomaly === 'theft'
      const dl = Math.abs(Number(a.deltaL ?? 0))
      const mapLink = (a.lat != null && a.lon != null)
        ? `https://yandex.uz/maps/?ll=${a.lon},${a.lat}&z=17&pt=${a.lon},${a.lat}`
        : ''
      wsAnomaly.addRow({
        no: no++,
        date: new Date(a.capturedAt).toLocaleString('uz-UZ'),
        reg: v?.registrationNumber || '—',
        branch: v?.branch?.name || '—',
        type: isTheft ? '🚨 Sliv' : '⚠️ Qayd etilmagan zapravka',
        liters: dl ? Math.round(dl * 10) / 10 : '',
        level: Math.round(Number(a.level) * 10) / 10,
        driver: a.driverName || '—',
        lat: a.lat ?? '',
        lon: a.lon ?? '',
        mapLink,
      })
    }
    const aHeader = wsAnomaly.getRow(1)
    aHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    aHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB71C1C' } }
    aHeader.height = 28

    // ── Sheet 3: Mashinalar bo'yicha xulosa ──
    const wsVeh = wb.addWorksheet('Mashinalar')
    wsVeh.columns = [
      { header: '№', key: 'no', width: 5 },
      { header: 'Mashina', key: 'reg', width: 16 },
      { header: 'Brand', key: 'brand', width: 14 },
      { header: 'Filial', key: 'branch', width: 20 },
      { header: 'Sliv hodisalari', key: 'tc', width: 14 },
      { header: 'Sliv miqdori (L)', key: 'tl', width: 16 },
      { header: 'Sliv summasi (so\'m)', key: 'ts', width: 18 },
      { header: 'Qayd etilmagan hodisalar', key: 'rc', width: 22 },
      { header: 'Qayd etilmagan (L)', key: 'rl', width: 18 },
      { header: 'Jami tejov (so\'m)', key: 'total', width: 18 },
    ]
    // Sortlangan: eng zararli birinchi
    const sortedVehs = [...vehSummary.entries()].sort((a, b) =>
      (b[1].theftL + b[1].refuelL) - (a[1].theftL + a[1].refuelL)
    )
    let no2 = 1
    for (const [vid, s] of sortedVehs) {
      const v = vehicleMap.get(vid)
      if (!v) continue
      const total = Math.round((s.theftL + s.refuelL) * dieselPrice)
      if (total === 0) continue  // anomaliyasiz mashinalarni qo'shmaymiz
      wsVeh.addRow({
        no: no2++,
        reg: v.registrationNumber,
        brand: `${v.brand} ${v.model}`,
        branch: v.branch?.name || '—',
        tc: s.theftCount || '',
        tl: s.theftL ? Math.round(s.theftL * 10) / 10 : '',
        ts: s.theftL ? Math.round(s.theftL * dieselPrice) : '',
        rc: s.refuelCount || '',
        rl: s.refuelL ? Math.round(s.refuelL * 10) / 10 : '',
        total,
      })
    }
    if (no2 === 1) wsVeh.addRow({ no: '—', reg: 'Bu davr uchun anomaliya aniqlanmagan' })
    const vHeader = wsVeh.getRow(1)
    vHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    vHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } }
    vHeader.height = 28

    // uz-cyrl bo'lsa hammasini transliteratsiya qilamiz
    if (useCyrl) {
      wb.eachSheet(ws => {
        if (ws.name) {
          const c = latinToCyrillic(ws.name)
          if (c.length <= 31) ws.name = c
        }
        ws.eachRow(row => {
          row.eachCell({ includeEmpty: false }, cell => {
            if (typeof cell.value === 'string') {
              const c = latinToCyrillic(cell.value)
              if (c !== cell.value) cell.value = c
            }
          })
        })
      })
    }

    const dateStr = new Date().toISOString().split('T')[0]
    const filename = `yoqilgi-hisobot-${days}kun-${dateStr}.xlsx`
    const finalFilename = useCyrl ? latinToCyrillic(filename) : filename

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(finalFilename)}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`)
    await wb.xlsx.write(res)
    res.end()
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
