/**
 * Toza-Hudud AI Coverage Service
 *
 * GPS tarixidan har bir vehicle+MFY uchun "fingerprint" (katak xotirasi) yaratadi.
 * 6 oylik ma'lumot asosida qaysi ko'chalar odatda qoplanishini o'rganadi.
 *
 * Fingerprint foydasi:
 *   - currentCells: bu haftada qoplangan kataklar
 *   - historicalCells: 6 oyda kamida 1 marta qoplangan kataklar
 *   →  historically_missed = historical - current  →  haydovchi ODA borardi, ENDI bormadi
 */

import { prisma } from '../../../lib/prisma'
import { getVehicleTrackPoints } from '../../../services/wialonService'
import { computeGridCoverageDetailed, getDayUtsRange, findCredForVehicle, TrackPoint } from './thMonitor'

export interface CellPoint { lat: number; lon: number }

export type CellState = 'covered' | 'historically_missed' | 'never_visited'

export interface AnnotatedCell {
  lat: number
  lon: number
  covered: boolean
  state: CellState
}

// ── Katak kaliti (lossless qiyoslov uchun) ────────────────────────────────────

function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat * 1e6)},${Math.round(lon * 1e6)}`
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

  // Shu oydagi barcha sanalarni aylantirish
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

      monthsProcessed++
      totalCells += cells.length
    } catch (err: any) {
      console.error(`[ThCoverageAI] ${vehicleId} + ${mfy.id} ${monthStr}:`, err?.message)
    }
  }

  return { monthsProcessed, totalCells }
}

// ── Tashkilot bo'yicha batch fingerprint qurilishi ────────────────────────────

export async function runFingerprintBatch(
  orgId: string | null,
  monthsBack: number = 6,
  onProgress?: (done: number, total: number) => void,
): Promise<{ processed: number; errors: number }> {
  // Org doirasidagi vehicleId lar
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

  // Barcha jadvallarni yuklab olamiz (vehicle + MFY + dayOfWeek)
  const schedules = await (prisma as any).thSchedule.findMany({
    where: { vehicleId: { in: vehicleIds } },
    include: { mfy: { select: { id: true, polygon: true } } },
  }).catch(() => [] as any[])

  if (schedules.length === 0) return { processed: 0, errors: 0 }

  // vehicle+MFY juftliklarini birlashtirish (dublikatlarni olib tashlash)
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
    // Wialon API ni haddan ko'p qistirmaslik uchun kichik kutish
    await new Promise(r => setTimeout(r, 200))
  }

  onProgress?.(pairList.length, pairList.length)
  console.log(`[ThCoverageAI] Batch done: ${processed} pairs, ${errors} errors, ${monthsBack} months each`)
  return { processed, errors }
}

// ── Tarixiy kataklar to'plamini olish ────────────────────────────────────────

export async function getHistoricalCells(
  vehicleId: string,
  mfyId: string,
): Promise<Set<string>> {
  const fingerprints = await (prisma as any).thCoverageFingerprint.findMany({
    where: { vehicleId, mfyId },
    select: { cells: true },
  }).catch(() => [] as { cells: any }[])

  const visited = new Set<string>()
  for (const fp of fingerprints) {
    const cells = Array.isArray(fp.cells) ? fp.cells : []
    for (const c of cells) {
      if (c.lat != null && c.lon != null) {
        visited.add(cellKey(c.lat, c.lon))
      }
    }
  }
  return visited
}

// ── Hozirgi kataklar + tarix asosida annotatsiya ──────────────────────────────

export async function annotateWithHistory(
  vehicleId: string,
  mfyId: string,
  currentCells: Array<{ lat: number; lon: number; covered: boolean }>,
): Promise<AnnotatedCell[]> {
  const historical = await getHistoricalCells(vehicleId, mfyId)
  const hasHistory = historical.size > 0

  return currentCells.map(c => {
    const key = cellKey(c.lat, c.lon)
    let state: CellState

    if (c.covered) {
      state = 'covered'
    } else if (hasHistory && historical.has(key)) {
      state = 'historically_missed'  // Tarixda borardi — endi bormadi (MUHIM!)
    } else {
      state = 'never_visited'  // Hech qachon bormagan
    }

    return { lat: c.lat, lon: c.lon, covered: c.covered, state }
  })
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
      // Jami vehicle+MFY jadval juftliklari
      (prisma as any).thSchedule.count({ where: { vehicleId: { in: vIds } } }).catch(() => 0),
      // O'rganilgan noyob vehicle+MFY juftliklari
      (prisma as any).thCoverageFingerprint.findMany({
        where: { vehicleId: { in: vIds } },
        select: { vehicleId: true, mfyId: true },
        distinct: ['vehicleId', 'mfyId'],
      }).catch(() => [] as any[]),
      // Oxirgi yangilanish vaqti
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
