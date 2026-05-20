/**
 * Toza-Hudud AI Coverage Service
 *
 * GPS tarixidan har bir vehicle+MFY uchun "fingerprint" (katak xotirasi) yaratadi.
 * 6 oylik ma'lumot asosida qaysi ko'chalar odatda qoplanishini o'rganadi.
 *
 * Cell states (annotateWithHistory):
 *   covered             — bugun qoplangan ✅
 *   high_risk_missed    — 4+ oyda qoplangan, bugun yo'q 🔴
 *   medium_risk_missed  — 2-3 oyda qoplangan, bugun yo'q 🟡
 *   low_risk_missed     — 1 oyda qoplangan, bugun yo'q 🔵
 *   never_visited       — 6 oyda biror marta ham qoplanmagan ⬜
 */

import { prisma } from '../../../lib/prisma'
import { getVehicleTrackPoints, getVehicleTracksBatch } from '../../../services/wialonService'
import { computeGridCoverageDetailed, getDayUtsRange, findCredForVehicle, TrackPoint } from './thMonitor'
import { pointInPolygon } from '../utils/geoUtils'

export interface CellPoint { lat: number; lon: number }

export type CellState =
  | 'covered'
  | 'high_risk_missed'
  | 'medium_risk_missed'
  | 'low_risk_missed'
  | 'never_visited'

export interface AnnotatedCell {
  lat: number
  lon: number
  covered: boolean
  state: CellState
}

export interface MonthlyTrend {
  month: string
  coveredCells: number
  totalCells: number
  coveragePct: number
  pointCount: number
}

export interface MissedPattern {
  mfyId: string
  mfyName: string
  vehicleId: string
  vehicleNumber: string
  neverVisitedCells: number
  totalCells: number
  neverPct: number
  lastTrainedAt: Date | null
}

// ── Katak kaliti (lossless qiyoslov uchun) ────────────────────────────────────

function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat * 1e6)},${Math.round(lon * 1e6)}`
}

// ── In-memory cache (1 soat TTL) ─────────────────────────────────────────────

interface CacheEntry {
  cells: Set<string>
  frequencies: Map<string, number>
  cachedAt: number
}

const historicalCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 60 * 1000

export function invalidateFingerprintCache(vehicleId?: string, mfyId?: string): void {
  if (vehicleId && mfyId) {
    historicalCache.delete(`${vehicleId}::${mfyId}`)
  } else if (vehicleId) {
    for (const k of historicalCache.keys()) {
      if (k.startsWith(`${vehicleId}::`)) historicalCache.delete(k)
    }
  } else {
    historicalCache.clear()
  }
}

// ── Bir oy uchun fingerprint hisoblash ───────────────────────────────────────

async function fetchMonthTracks(
  vehicleId: string,
  mfy: { id: string; polygon: any },
  year: number,
  month: number, // 1-12
  scheduledDows: number[], // 0=Du .. 6=Ya
): Promise<{ cells: CellPoint[]; pointCount: number }> {
  const credInfo = await findCredForVehicle(vehicleId)
  if (!credInfo) {
    console.warn(`[ThCoverageAI] No GPS cred for vehicle ${vehicleId} — skipping ${year}-${month}`)
    return { cells: [], pointCount: 0 }
  }
  if (!mfy.polygon) return { cells: [], pointCount: 0 }

  const daysInMonth = new Date(year, month, 0).getDate()
  let allTrack: TrackPoint[] = []

  for (let day = 1; day <= daysInMonth; day++) {
    const dt = new Date(Date.UTC(year, month - 1, day))
    const jsDow = dt.getUTCDay()
    const uzDow = (jsDow + 6) % 7
    if (!scheduledDows.includes(uzDow)) continue

    const { fromTs, toTs } = getDayUtsRange(dt)
    const track = await getVehicleTrackPoints(credInfo.credId, credInfo.lookupKey, fromTs, toTs)
      .catch(() => [] as TrackPoint[])
    allTrack.push(...track)
    // Wialon API ni haddan zo'r yuklamaslik uchun
    await new Promise(r => setTimeout(r, 100))
  }

  console.log(`[ThCoverageAI] ${vehicleId} + mfy:${mfy.id} ${year}-${month}: ${allTrack.length} GPS points`)

  if (allTrack.length === 0) return { cells: [], pointCount: 0 }

  const { cells } = computeGridCoverageDetailed(mfy.polygon, allTrack)
  const covered: CellPoint[] = cells
    .filter(c => c.covered)
    .map(c => ({ lat: Math.round(c.lat * 1e6) / 1e6, lon: Math.round(c.lon * 1e6) / 1e6 }))

  return { cells: covered, pointCount: allTrack.length }
}

// ── Bir vehicle+MFY juftligi uchun N oy fingerprint qurish ───────────────────

export async function buildFingerprintForPair(
  vehicleId: string,
  mfy: { id: string; polygon: any },
  scheduledDows: number[],
  monthsBack: number = 6,
): Promise<{ monthsProcessed: number; totalCells: number }> {
  const now = new Date()
  let monthsProcessed = 0
  let totalCells = 0

  // Har oy uchun covered cells larni to'playmiz
  const monthData: Array<{ monthStr: string; cells: CellPoint[]; pointCount: number }> = []

  for (let i = 1; i <= monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = d.getFullYear()
    const month = d.getMonth() + 1
    const monthStr = `${year}-${String(month).padStart(2, '0')}`

    try {
      const { cells, pointCount } = await fetchMonthTracks(vehicleId, mfy, year, month, scheduledDows)

      await (prisma as any).thCoverageFingerprint.upsert({
        where: { vehicleId_mfyId_month: { vehicleId, mfyId: mfy.id, month: monthStr } },
        create: { vehicleId, mfyId: mfy.id, month: monthStr, cells, pointCount },
        update: { cells, pointCount, updatedAt: new Date() },
      })

      monthData.push({ monthStr, cells, pointCount })
      monthsProcessed++
      totalCells += cells.length
    } catch (err: any) {
      console.error(`[ThCoverageAI] ${vehicleId} + ${mfy.id} ${monthStr}:`, err?.message)
    }
  }

  // Chastota jadvali quramiz: kalit → necha oyda qoplangan (1-monthsBack)
  const freqMap = new Map<string, number>()
  for (const { cells } of monthData) {
    for (const c of cells) {
      const k = cellKey(c.lat, c.lon)
      freqMap.set(k, (freqMap.get(k) ?? 0) + 1)
    }
  }

  // [[lat_int, lon_int, count]] formatida ixcham saqlash
  if (freqMap.size > 0) {
    const frequencies: [number, number, number][] = []
    for (const [k, count] of freqMap) {
      const [latS, lonS] = k.split(',')
      frequencies.push([parseInt(latS), parseInt(lonS), count])
    }

    // Eng so'nggi fingerprint yozuviga chastotani qo'shib saqlaymiz
    const latestMonth = monthData[0]?.monthStr
    if (latestMonth) {
      await (prisma as any).thCoverageFingerprint.update({
        where: { vehicleId_mfyId_month: { vehicleId, mfyId: mfy.id, month: latestMonth } },
        data: { cellFrequencies: frequencies },
      }).catch(() => {})
    }
  }

  // Cache'ni tozalab, yangi ma'lumot olinsin
  invalidateFingerprintCache(vehicleId, mfy.id)

  return { monthsProcessed, totalCells }
}

// ── Tashkilot bo'yicha batch fingerprint qurilishi (thServiceTrip asosida) ────
//
// Asosiy manba: thServiceTrip.trackSnapshot (monitoring saqlagan GPS nuqtalar)
// Fallback:    Wialon API — trackSnapshot yo'q yoki bo'sh bo'lgan triplar uchun

export async function runFingerprintBatch(
  orgId: string | null,
  monthsBack: number = 6,
  onProgress?: (done: number, total: number) => void,
  onLog?: (msg: string) => void,
): Promise<{ processed: number; errors: number }> {
  const log = (msg: string) => { console.log(`[ThCoverageAI] ${msg}`); onLog?.(msg) }

  let vehicleFilter: any = { status: 'active' }
  if (orgId) {
    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    }).catch(() => [] as { id: string }[])
    const branchIds = branches.map((b: any) => b.id)
    vehicleFilter.branchId = { in: branchIds }
  }

  const vehicles = await prisma.vehicle.findMany({
    where: vehicleFilter,
    select: { id: true, registrationNumber: true, gpsUnitName: true },
  })
  const vehicleIds = vehicles.map(v => v.id)
  const vehicleNumMap = new Map(vehicles.map(v => [v.id, v.registrationNumber]))
  const vehicleLookupMap = new Map(vehicles.map(v => [
    v.id,
    (v.gpsUnitName || v.registrationNumber).trim().toUpperCase(),
  ]))

  if (vehicleIds.length === 0) {
    log('Faol mashina topilmadi')
    return { processed: 0, errors: 0 }
  }

  // So'nggi N oy ichidagi bajarilgan tashriflarni yuklaymiz
  const fromDate = new Date()
  fromDate.setMonth(fromDate.getMonth() - monthsBack)
  fromDate.setDate(1)
  fromDate.setHours(0, 0, 0, 0)

  log(`${vehicleIds.length} ta mashina | so'nggi ${monthsBack} oy | ${fromDate.toISOString().slice(0, 10)} dan beri`)

  // ── MFY polygon larini bir martada yuklaymiz (tashkilot doirasida) ──────────
  const orgMfys: Array<{ id: string; polygon: any }> = await (prisma as any).thMfy.findMany({
    where: orgId ? { organizationId: orgId, polygon: { not: null } } : { polygon: { not: null } },
    select: { id: true, polygon: true },
  }).catch(() => [])

  if (orgMfys.length === 0) {
    log('MFY topilmadi yoki polygonlar yo\'q — avval xaritada chegara chizing')
    return { processed: 0, errors: 0 }
  }
  log(`${orgMfys.length} ta MFY polygon yuklandi`)

  // ── STEP 1: thServiceTrip — GPS monitoring tomonidan yozilgan haqiqiy tashriflar ──
  // Grafik emas, amaliy GPS tahlili asosida. Mashina o'zgarse ham yozuv saqlanadi.
  const trips = await (prisma as any).thServiceTrip.findMany({
    where: { vehicleId: { in: vehicleIds }, status: 'visited', date: { gte: fromDate } },
    select: { vehicleId: true, mfyId: true, date: true, trackSnapshot: true },
  }).catch(() => [] as any[])

  log(`${trips.length} ta GPS-tasdiqlangan tashrif topildi`)

  // vehicle+MFY+oy bo'yicha guruhlash
  type MonthGroup = {
    vehicleId: string; mfyId: string; month: string
    tracks: TrackPoint[]
  }
  const monthGroups = new Map<string, MonthGroup>()

  const ensureGroup = (vehicleId: string, mfyId: string, month: string) => {
    const gKey = `${vehicleId}::${mfyId}::${month}`
    if (!monthGroups.has(gKey)) {
      monthGroups.set(gKey, { vehicleId, mfyId, month, tracks: [] })
    }
    return monthGroups.get(gKey)!
  }

  // trackSnapshot mavjud tashriflardan to'g'ridan-to'g'ri olamiz
  const tripsWithoutSnapshot: Array<{ vehicleId: string; dateStr: string }> = []
  for (const trip of trips) {
    const month = (trip.date as Date).toISOString().slice(0, 7)
    const dateStr = (trip.date as Date).toISOString().slice(0, 10)
    const snap = trip.trackSnapshot
    if (Array.isArray(snap) && snap.length > 0) {
      ensureGroup(trip.vehicleId, trip.mfyId, month).tracks.push(...(snap as TrackPoint[]))
    } else {
      tripsWithoutSnapshot.push({ vehicleId: trip.vehicleId, dateStr })
    }
  }

  // ── STEP 2: trackSnapshot yo'q kunlar + umuman thServiceTrip bo'lmagan mashinalar ──
  // GPS trekini oylik batch bilan tortamiz, keyin pointInPolygon bilan MFY ni ANIQLAYMIZ.
  // Grafik o'zgarsa ham, mashina o'zgarse ham — GPS tarix to'g'ri qoladi.

  // Credential topish
  const credCache = new Map<string, { credId: string } | null>()
  for (const vId of vehicleIds) {
    const info = await findCredForVehicle(vId).catch(() => null)
    credCache.set(vId, info ? { credId: info.credId } : null)
  }

  // credId → month → Set<vehicleId>
  const credMonthVehicles = new Map<string, Map<string, Set<string>>>()

  // trackSnapshot yo'q tashriflar uchun
  for (const { vehicleId, dateStr } of tripsWithoutSnapshot) {
    const cred = credCache.get(vehicleId)
    if (!cred) continue
    const month = dateStr.slice(0, 7)
    if (!credMonthVehicles.has(cred.credId)) credMonthVehicles.set(cred.credId, new Map())
    const mm = credMonthVehicles.get(cred.credId)!
    if (!mm.has(month)) mm.set(month, new Set())
    mm.get(month)!.add(vehicleId)
  }

  // thServiceTrip bo'lmagan mashinalar — 6 oylik to'liq GPS skan
  const vehiclesWithTrips = new Set(trips.map((t: any) => t.vehicleId as string))
  for (const vId of vehicleIds) {
    if (vehiclesWithTrips.has(vId)) continue
    const cred = credCache.get(vId)
    if (!cred) continue
    // 6 oyning har birini qo'shamiz
    for (let m = 0; m < monthsBack; m++) {
      const d = new Date(fromDate)
      d.setMonth(d.getMonth() + m)
      const month = d.toISOString().slice(0, 7)
      if (!credMonthVehicles.has(cred.credId)) credMonthVehicles.set(cred.credId, new Map())
      const mm = credMonthVehicles.get(cred.credId)!
      if (!mm.has(month)) mm.set(month, new Set())
      mm.get(month)!.add(vId)
    }
  }

  // Oylik batch GPS yuklash + pointInPolygon bilan MFY aniqlash
  if (credMonthVehicles.size > 0) {
    log(`📡 GPS tarix skaneri: ${credMonthVehicles.size} credential, oylik batch...`)

    for (const [credId, monthMap] of credMonthVehicles) {
      for (const [monthStr, vIds] of monthMap) {
        const [yr, mo] = monthStr.split('-').map(Number)
        const fromTs = Math.floor(Date.UTC(yr, mo - 1, 1) / 1000) - 5 * 3600
        const toTs   = Math.floor(Date.UTC(yr, mo,     1) / 1000) - 5 * 3600 - 1

        const vehicleInputs = [...vIds].map(vId => ({
          vehicleId: vId,
          lookupKey: vehicleLookupMap.get(vId) ?? vId,
        }))

        log(`  📡 ${monthStr}: ${vehicleInputs.length} ta mashina...`)
        const batchResult = await getVehicleTracksBatch(credId, vehicleInputs, fromTs, toTs, 8)
          .catch(() => new Map<string, TrackPoint[]>())

        for (const [vId, pts] of batchResult) {
          if (pts.length === 0) continue

          // Nuqtalarni kun bo'yicha ajratamiz (UZT: UTC+5)
          const dayMap = new Map<string, TrackPoint[]>()
          for (const pt of pts) {
            const dayStr = new Date((pt.ts + 5 * 3600) * 1000).toISOString().slice(0, 10)
            if (!dayMap.has(dayStr)) dayMap.set(dayStr, [])
            dayMap.get(dayStr)!.push(pt)
          }

          // Har kun uchun: qaysi MFY poligonida harakatlanganini aniqlaymiz
          for (const [dayStr, dayPts] of dayMap) {
            const month = dayStr.slice(0, 7)
            const detectedMfys = new Set<string>()

            for (const mfy of orgMfys) {
              // Har 5-nuqtani tekshirish kifoya (tezlik uchun)
              for (let i = 0; i < dayPts.length; i += 5) {
                if (pointInPolygon(dayPts[i].lat, dayPts[i].lon, mfy.polygon)) {
                  detectedMfys.add(mfy.id)
                  break
                }
              }
            }

            for (const mfyId of detectedMfys) {
              ensureGroup(vId, mfyId, month).tracks.push(...dayPts)
            }
          }
        }

        log(`  ✅ ${monthStr} skanerlandi`)
      }
    }
  }

  // Har vehicle+MFY juftligi uchun fingerprint qurish
  type PairData = { vehicleId: string; mfyId: string; byMonth: Map<string, TrackPoint[]> }
  const pairMap = new Map<string, PairData>()

  for (const [, g] of monthGroups) {
    const pKey = `${g.vehicleId}::${g.mfyId}`
    if (!pairMap.has(pKey)) pairMap.set(pKey, { vehicleId: g.vehicleId, mfyId: g.mfyId, byMonth: new Map() })
    const p = pairMap.get(pKey)!
    const existing = p.byMonth.get(g.month) ?? []
    existing.push(...g.tracks)
    p.byMonth.set(g.month, existing)
  }

  // MFY polygon larini yuklaymiz
  const mfyIds = [...new Set([...pairMap.values()].map(p => p.mfyId))]
  const mfys: Array<{ id: string; polygon: any }> = await (prisma as any).thMfy.findMany({
    where: { id: { in: mfyIds } },
    select: { id: true, polygon: true },
  }).catch(() => [])
  const mfyMap = new Map(mfys.map(m => [m.id, m]))

  const pairList = [...pairMap.values()]
  const total = pairList.length
  let processed = 0, errors = 0

  log(`${total} ta vehicle+MFY juftligi uchun fingerprint qurilmoqda...`)
  onProgress?.(0, total)

  for (let i = 0; i < pairList.length; i++) {
    const { vehicleId, mfyId, byMonth } = pairList[i]
    const mfy = mfyMap.get(mfyId)
    const vNum = vehicleNumMap.get(vehicleId) ?? vehicleId.slice(0, 8)

    if (!mfy?.polygon) {
      log(`⚠ ${vNum}: MFY polygon topilmadi (${mfyId})`)
      errors++
      onProgress?.(i + 1, total)
      continue
    }

    try {
      const monthData: { monthStr: string; cells: CellPoint[]; pointCount: number }[] = []

      for (const [month, tracks] of byMonth) {
        if (tracks.length === 0) continue
        const { cells } = computeGridCoverageDetailed(mfy.polygon, tracks)
        const covered = cells.filter(c => c.covered).map(c => ({
          lat: Math.round(c.lat * 1e6) / 1e6,
          lon: Math.round(c.lon * 1e6) / 1e6,
        }))

        await (prisma as any).thCoverageFingerprint.upsert({
          where: { vehicleId_mfyId_month: { vehicleId, mfyId, month } },
          create: { vehicleId, mfyId, month, cells: covered, pointCount: tracks.length },
          update: { cells: covered, pointCount: tracks.length, updatedAt: new Date() },
        })

        monthData.push({ monthStr: month, cells: covered, pointCount: tracks.length })
        log(`✅ ${vNum} → ${month}: ${tracks.length} GPS nuqta, ${covered.length} katak saqlandi`)
      }

      // Chastota jadvali (barcha oylar bo'yicha)
      const freqMap = new Map<string, number>()
      for (const { cells } of monthData) {
        for (const c of cells) { const k = cellKey(c.lat, c.lon); freqMap.set(k, (freqMap.get(k) ?? 0) + 1) }
      }

      if (freqMap.size > 0 && monthData.length > 0) {
        const frequencies: [number, number, number][] = []
        for (const [k, count] of freqMap) {
          const [latS, lonS] = k.split(',')
          frequencies.push([parseInt(latS), parseInt(lonS), count])
        }
        await (prisma as any).thCoverageFingerprint.update({
          where: { vehicleId_mfyId_month: { vehicleId, mfyId, month: monthData[0].monthStr } },
          data: { cellFrequencies: frequencies },
        }).catch(() => {})
      }

      invalidateFingerprintCache(vehicleId, mfyId)
      processed++
    } catch (err: any) {
      errors++
      log(`❌ ${vNum} xato: ${err?.message}`)
    }

    onProgress?.(i + 1, total)
    await new Promise(r => setTimeout(r, 50))
  }

  log(`O'qitish tugadi: ${processed} juftlik, ${errors} xato`)
  return { processed, errors }
}

// ── Inkremental o'qitish: faqat oxirgi N oy ──────────────────────────────────

export async function runIncrementalTraining(
  orgId: string,
  monthsBack: number = 1,
  onProgress?: (done: number, total: number) => void,
  onLog?: (msg: string) => void,
): Promise<{ processed: number; errors: number }> {
  return runFingerprintBatch(orgId, monthsBack, onProgress, onLog)
}

// ── Tarixiy kataklar + chastotani cache bilan olish ───────────────────────────

export async function getCachedHistoricalCells(
  vehicleId: string,
  mfyId: string,
): Promise<{ cells: Set<string>; frequencies: Map<string, number> }> {
  const cacheKey = `${vehicleId}::${mfyId}`
  const entry = historicalCache.get(cacheKey)
  const now = Date.now()

  if (entry && now - entry.cachedAt < CACHE_TTL_MS) {
    return { cells: entry.cells, frequencies: entry.frequencies }
  }

  // DB dan yuklab olamiz
  const fingerprints = await (prisma as any).thCoverageFingerprint.findMany({
    where: { vehicleId, mfyId },
    select: { cells: true, cellFrequencies: true },
  }).catch(() => [] as { cells: any; cellFrequencies: any }[])

  const cellSet = new Set<string>()
  const freqMap = new Map<string, number>()

  for (const fp of fingerprints) {
    // cells [{lat, lon}] — oylik coverage
    const cells = Array.isArray(fp.cells) ? fp.cells : []
    for (const c of cells) {
      if (c.lat != null && c.lon != null) {
        cellSet.add(cellKey(c.lat, c.lon))
      }
    }
    // cellFrequencies [[lat_int, lon_int, count]] — chastota
    const freqs = Array.isArray(fp.cellFrequencies) ? fp.cellFrequencies : []
    for (const f of freqs) {
      if (Array.isArray(f) && f.length === 3) {
        const k = `${f[0]},${f[1]}`
        const existing = freqMap.get(k) ?? 0
        freqMap.set(k, Math.max(existing, f[2]))
      }
    }
  }

  const result = { cells: cellSet, frequencies: freqMap }
  historicalCache.set(cacheKey, { ...result, cachedAt: now })
  return result
}

// ── Legacy: getHistoricalCells (orqaga muvofiqlik) ───────────────────────────

export async function getHistoricalCells(
  vehicleId: string,
  mfyId: string,
): Promise<Set<string>> {
  const { cells } = await getCachedHistoricalCells(vehicleId, mfyId)
  return cells
}

// ── Annotatsiya: chastotaga asoslangan 5 holat ───────────────────────────────

export async function annotateWithHistory(
  vehicleId: string,
  mfyId: string,
  currentCells: Array<{ lat: number; lon: number; covered: boolean }>,
): Promise<AnnotatedCell[]> {
  const { cells: historical, frequencies } = await getCachedHistoricalCells(vehicleId, mfyId)
  const hasHistory = historical.size > 0

  return currentCells.map(c => {
    const key = cellKey(c.lat, c.lon)
    let state: CellState

    if (c.covered) {
      state = 'covered'
    } else if (hasHistory && historical.has(key)) {
      const count = frequencies.get(key) ?? 1
      if (count >= 4) state = 'high_risk_missed'
      else if (count >= 2) state = 'medium_risk_missed'
      else state = 'low_risk_missed'
    } else {
      state = 'never_visited'
    }

    return { lat: c.lat, lon: c.lon, covered: c.covered, state }
  })
}

// ── Oylik trend: 6 oy bo'yicha qamrov %ni qaytaradi ─────────────────────────

export async function getMfyMonthlyTrend(
  vehicleId: string,
  mfyId: string,
  polygon: any,
): Promise<MonthlyTrend[]> {
  const fingerprints = await (prisma as any).thCoverageFingerprint.findMany({
    where: { vehicleId, mfyId },
    select: { month: true, cells: true, pointCount: true },
    orderBy: { month: 'desc' },
    take: 6,
  }).catch(() => [] as { month: string; cells: any; pointCount: number }[])

  if (fingerprints.length === 0) return []

  // Polygon dagi jami kataklar (bo'sh trek bilan bir marta hisob)
  const { cells: allCells } = computeGridCoverageDetailed(polygon, [])
  const totalCells = allCells.length || 1

  return fingerprints.map((fp: any) => {
    const covered = Array.isArray(fp.cells) ? fp.cells.length : 0
    return {
      month: fp.month,
      coveredCells: covered,
      totalCells,
      coveragePct: Math.round(covered / totalCells * 100),
      pointCount: fp.pointCount || 0,
    }
  })
}

// ── Persistently missed areas: neverPct > threshold bo'lgan juftliklar ───────

export async function getMissedPatterns(
  orgId: string,
  neverPctThreshold = 20,
): Promise<MissedPattern[]> {
  const branches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  const branchIds = branches.map((b: any) => b.id)

  const vehicles = await prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true, registrationNumber: true },
  })
  if (vehicles.length === 0) return []

  const vehicleIds = vehicles.map(v => v.id)
  const vehicleMap = new Map(vehicles.map(v => [v.id, v.registrationNumber]))

  // Barcha fingerprint larni yuklab olamiz (mfyId va distinctCell soni uchun)
  const fingerprints = await (prisma as any).thCoverageFingerprint.findMany({
    where: { vehicleId: { in: vehicleIds } },
    select: { vehicleId: true, mfyId: true, cells: true, updatedAt: true },
  }).catch(() => [] as any[])

  if (fingerprints.length === 0) return []

  // MFY lar (polygon bilan)
  const mfyIds = [...new Set(fingerprints.map((f: any) => f.mfyId))]
  const mfys: Array<{ id: string; name: string; polygon: any }> = await (prisma as any).thMfy.findMany({
    where: { id: { in: mfyIds } },
    select: { id: true, name: true, polygon: true },
  }).catch(() => [])
  const mfyMap = new Map<string, { id: string; name: string; polygon: any }>(mfys.map(m => [m.id, m]))

  // vehicle+MFY juftliklari bo'yicha barcha qoplangan kataklar birlashtirish
  type PairKey = string
  const pairCells = new Map<PairKey, { vehicleId: string; mfyId: string; cellSet: Set<string>; lastUpdatedAt: Date | null }>()

  for (const fp of fingerprints) {
    const pairKey = `${fp.vehicleId}::${fp.mfyId}`
    if (!pairCells.has(pairKey)) {
      pairCells.set(pairKey, { vehicleId: fp.vehicleId, mfyId: fp.mfyId, cellSet: new Set(), lastUpdatedAt: null })
    }
    const entry = pairCells.get(pairKey)!
    const cells = Array.isArray(fp.cells) ? fp.cells : []
    for (const c of cells) {
      if (c.lat != null && c.lon != null) entry.cellSet.add(cellKey(c.lat, c.lon))
    }
    const updAt = fp.updatedAt ? new Date(fp.updatedAt) : null
    if (!entry.lastUpdatedAt || (updAt && updAt > entry.lastUpdatedAt)) {
      entry.lastUpdatedAt = updAt
    }
  }

  const results: MissedPattern[] = []

  for (const [, pair] of pairCells) {
    const mfy = mfyMap.get(pair.mfyId)
    if (!mfy?.polygon) continue

    const { cells: allCells } = computeGridCoverageDetailed(mfy.polygon, [])
    const totalCells = allCells.length
    if (totalCells === 0) continue

    const visitedCells = pair.cellSet.size
    const neverVisitedCells = totalCells - visitedCells
    const neverPct = Math.round(neverVisitedCells / totalCells * 100)

    if (neverPct < neverPctThreshold) continue

    results.push({
      mfyId: pair.mfyId,
      mfyName: mfy.name,
      vehicleId: pair.vehicleId,
      vehicleNumber: vehicleMap.get(pair.vehicleId) ?? pair.vehicleId,
      neverVisitedCells,
      totalCells,
      neverPct,
      lastTrainedAt: pair.lastUpdatedAt,
    })
  }

  // neverPct bo'yicha kamayish tartibida
  return results.sort((a, b) => b.neverPct - a.neverPct).slice(0, 100)
}

// ── Fingerprint mavjudligini tekshirish ───────────────────────────────────────

export async function getFingerprintStatus(orgId: string): Promise<{
  total: number
  trained: number
  lastUpdated: Date | null
}> {
  try {
    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    }).catch(() => [] as { id: string }[])
    const branchIds = branches.map((b: any) => b.id)

    const vIds = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds }, status: 'active' },
      select: { id: true },
    }).then(vs => vs.map(v => v.id)).catch(() => [] as string[])

    if (vIds.length === 0) return { total: 0, trained: 0, lastUpdated: null }

    const [scheduleCount, trainedPairs, latestFingerprint] = await Promise.all([
      (prisma as any).thSchedule.count({ where: { vehicleId: { in: vIds } } }).catch(() => 0),
      (prisma as any).thCoverageFingerprint.findMany({
        where: { vehicleId: { in: vIds } },
        select: { vehicleId: true, mfyId: true },
        distinct: ['vehicleId', 'mfyId'],
      }).catch(() => [] as any[]),
      (prisma as any).thCoverageFingerprint.findFirst({
        where: { vehicleId: { in: vIds } },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }).catch(() => null),
    ])

    return {
      total: scheduleCount,
      trained: trainedPairs.length,
      lastUpdated: latestFingerprint?.updatedAt ?? null,
    }
  } catch {
    return { total: 0, trained: 0, lastUpdated: null }
  }
}
