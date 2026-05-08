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
import { getVehicleTrackPoints } from '../../../services/wialonService'
import { computeGridCoverageDetailed, getDayUtsRange, findCredForVehicle, TrackPoint } from './thMonitor'

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
  if (!credInfo) return { cells: [], pointCount: 0 }
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

// ── Tashkilot bo'yicha batch fingerprint qurilishi ────────────────────────────

export async function runFingerprintBatch(
  orgId: string | null,
  monthsBack: number = 6,
  onProgress?: (done: number, total: number) => void,
): Promise<{ processed: number; errors: number }> {
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
    select: { id: true },
  })

  const vehicleIds = vehicles.map(v => v.id)
  if (vehicleIds.length === 0) return { processed: 0, errors: 0 }

  const schedules = await (prisma as any).thSchedule.findMany({
    where: { vehicleId: { in: vehicleIds } },
    include: { mfy: { select: { id: true, polygon: true } } },
  }).catch(() => [] as any[])

  if (schedules.length === 0) return { processed: 0, errors: 0 }

  const pairs = new Map<string, { vehicleId: string; mfy: { id: string; polygon: any }; dows: number[] }>()
  for (const s of schedules) {
    const key = `${s.vehicleId}::${s.mfyId}`
    if (!pairs.has(key)) {
      pairs.set(key, { vehicleId: s.vehicleId, mfy: s.mfy, dows: s.dayOfWeek })
    }
  }

  const pairList = Array.from(pairs.values())
  let processed = 0
  let errors = 0

  for (let i = 0; i < pairList.length; i++) {
    const p = pairList[i]
    onProgress?.(i, pairList.length)
    try {
      await buildFingerprintForPair(p.vehicleId, p.mfy, p.dows, monthsBack)
      processed++
    } catch (err: any) {
      errors++
      console.error(`[ThCoverageAI] batch pair error:`, err?.message)
    }
    await new Promise(r => setTimeout(r, 200))
  }

  onProgress?.(pairList.length, pairList.length)
  console.log(`[ThCoverageAI] Batch done: ${processed} pairs, ${errors} errors, ${monthsBack} months each`)
  return { processed, errors }
}

// ── Inkremental o'qitish: faqat oxirgi N oy ──────────────────────────────────

export async function runIncrementalTraining(
  orgId: string,
  monthsBack: number = 1,
): Promise<{ processed: number; errors: number }> {
  return runFingerprintBatch(orgId, monthsBack)
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
