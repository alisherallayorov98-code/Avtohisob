/**
 * Toza-Hudud: GPS tarixiga asoslangan jadval taklifi (Hybrid)
 *
 * 1. DB fast path: thServiceTrip yozuvlari bo'lsa — ulardan dow-chastota hisoblanadi (ms)
 * 2. Wialon slow path: trips bo'lmasa — oxirgi 7 kunlik trek yuklash + pointInPolygon
 * 3. Fallback: na trips na GPS — round-robin (suggestOptimalSchedule)
 */

import { prisma } from '../../../lib/prisma'
import { getVehicleTracksBatch } from '../../../services/wialonService'
import { ScheduleSuggestion, suggestOptimalSchedule } from './thScheduleOptimizer'
import { pointInPolygon } from '../utils/geoUtils'

// UNIX timestamp dan UZT kun-of-week (0=Du...6=Ya)
function tsToUzDow(ts: number): number {
  return (new Date(ts * 1000).getUTCDay() + 6) % 7
}

// UNIX timestamp dan 'YYYY-MM-DD'
function tsToDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().split('T')[0]
}

export interface GpsSuggestResult {
  suggestions: ScheduleSuggestion[]
  source: 'db_trips' | 'gps' | 'fallback'
  analyzedDays: number
  vehiclesWithData: number
  mfysDetected: number
}

/** Org uchun aktiv vehicle ID larini qaytaradi */
async function getOrgVehicleIds(orgId: string): Promise<{ id: string; registrationNumber: string }[]> {
  const branches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  const branchIds = branches.map((b: any) => b.id)
  if (branchIds.length === 0) return []
  return prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true, registrationNumber: true },
  }).catch(() => [] as { id: string; registrationNumber: string }[])
}

/**
 * DB fast path: thServiceTrip yozuvlaridan dow-chastota.
 * O'tgan 30 kunlik "visited" triplarni guruhlab ScheduleSuggestion[] yaratadi.
 */
async function suggestFromDbTrips(
  orgId: string,
  vIds: string[],
): Promise<GpsSuggestResult | null> {
  const DAYS_BACK = 30
  const since = new Date(Date.now() - DAYS_BACK * 86400_000)

  const trips = await (prisma as any).thServiceTrip.findMany({
    where: {
      vehicleId: { in: vIds },
      date: { gte: since },
      status: 'visited',
    },
    select: { vehicleId: true, mfyId: true, date: true },
  }).catch(() => [] as any[])

  if (trips.length === 0) return null

  // vehicleId → mfyId → dow → count
  const freq = new Map<string, Map<string, Map<number, number>>>()

  for (const trip of trips) {
    const dow = tsToUzDow(new Date(trip.date).getTime() / 1000)
    const vid = trip.vehicleId
    const mid = trip.mfyId
    if (!freq.has(vid)) freq.set(vid, new Map())
    const vMap = freq.get(vid)!
    if (!vMap.has(mid)) vMap.set(mid, new Map())
    const dMap = vMap.get(mid)!
    dMap.set(dow, (dMap.get(dow) || 0) + 1)
  }

  const suggestions: ScheduleSuggestion[] = []
  const assignedMfys = new Set<string>()
  const mfysCovered = new Set<string>()
  const vehiclesWithData = new Set<string>()

  const pairs: Array<{ vehicleId: string; mfyId: string; days: number[]; total: number }> = []

  for (const [vehicleId, vMap] of freq) {
    for (const [mfyId, dMap] of vMap) {
      const total = [...dMap.values()].reduce((a, b) => a + b, 0)
      const days = [...dMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([dow]) => dow)
      pairs.push({ vehicleId, mfyId, days, total })
    }
  }

  pairs.sort((a, b) => b.total - a.total)

  for (const pair of pairs) {
    if (assignedMfys.has(pair.mfyId)) continue
    assignedMfys.add(pair.mfyId)
    mfysCovered.add(pair.mfyId)
    vehiclesWithData.add(pair.vehicleId)
    const selectedDays = pair.days.slice(0, 3)
    if (selectedDays.length === 0) continue
    suggestions.push({
      vehicleId: pair.vehicleId,
      mfyId: pair.mfyId,
      dayOfWeek: selectedDays,
      reason: `${DAYS_BACK} kunlik tarixdan: ${pair.total} marta tashrif`,
    })
  }

  return {
    suggestions,
    source: 'db_trips',
    analyzedDays: DAYS_BACK,
    vehiclesWithData: vehiclesWithData.size,
    mfysDetected: mfysCovered.size,
  }
}

/**
 * Wialon slow path: so'nggi 7 kunlik trek + pointInPolygon.
 * Faqat DB da trips bo'lmagan hollarda chaqiriladi.
 * Concurrency=4, DAYS_BACK=7 — timeout uchun xavfsiz chegaralar.
 */
async function suggestFromRawGps(
  orgId: string,
  vIds: string[],
  vehicles: { id: string; registrationNumber: string }[],
): Promise<GpsSuggestResult | null> {
  const DAYS_BACK = 7
  const MIN_POINTS_IN_POLYGON = 5
  const MIN_VISIT_MINUTES = 3

  const cred = await (prisma as any).gpsCredential.findFirst({
    where: { orgId, isActive: true },
    select: { id: true },
  }).catch(() => null)

  if (!cred) return null

  const mfys = await (prisma as any).thMfy.findMany({
    where: { organizationId: orgId, polygon: { not: null } },
    select: { id: true, polygon: true },
  }).catch(() => [] as any[])

  if (mfys.length === 0) return null

  const now = Math.floor(Date.now() / 1000)
  const fromTs = now - DAYS_BACK * 86400

  const vehicleInputs = vehicles.map(v => ({ vehicleId: v.id, lookupKey: v.registrationNumber }))
  const tracks = await getVehicleTracksBatch(cred.id, vehicleInputs, fromTs, now, 4)

  const freq = new Map<string, Map<string, Map<number, number>>>()
  let vehiclesWithData = 0
  const mfysCovered = new Set<string>()

  for (const vehicle of vehicles) {
    const points = tracks.get(vehicle.id) || []
    if (points.length === 0) continue
    vehiclesWithData++

    const byDate = new Map<string, typeof points>()
    for (const p of points) {
      const d = tsToDateStr(p.ts)
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(p)
    }

    for (const [dateStr, dayPoints] of byDate) {
      const ts = new Date(dateStr + 'T12:00:00.000Z').getTime() / 1000
      const dow = tsToUzDow(ts)

      for (const mfy of mfys) {
        let polygon: any
        try { polygon = typeof mfy.polygon === 'string' ? JSON.parse(mfy.polygon) : mfy.polygon }
        catch { continue }

        const inPoly = dayPoints.filter(p => pointInPolygon(p.lat, p.lon, polygon))
        if (inPoly.length < MIN_POINTS_IN_POLYGON) continue

        const sorted = inPoly.map(p => p.ts).sort()
        if ((sorted[sorted.length - 1] - sorted[0]) / 60 < MIN_VISIT_MINUTES) continue

        if (!freq.has(vehicle.id)) freq.set(vehicle.id, new Map())
        const vMap = freq.get(vehicle.id)!
        if (!vMap.has(mfy.id)) vMap.set(mfy.id, new Map())
        const dMap = vMap.get(mfy.id)!
        dMap.set(dow, (dMap.get(dow) || 0) + 1)
        mfysCovered.add(mfy.id)
      }
    }
  }

  if (freq.size === 0) return null

  const suggestions: ScheduleSuggestion[] = []
  const assignedMfys = new Set<string>()

  const pairs: Array<{ vehicleId: string; mfyId: string; days: number[]; total: number }> = []
  for (const [vehicleId, vMap] of freq) {
    for (const [mfyId, dMap] of vMap) {
      const total = [...dMap.values()].reduce((a, b) => a + b, 0)
      const days = [...dMap.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d)
      pairs.push({ vehicleId, mfyId, days, total })
    }
  }
  pairs.sort((a, b) => b.total - a.total)

  for (const pair of pairs) {
    if (assignedMfys.has(pair.mfyId)) continue
    assignedMfys.add(pair.mfyId)
    const selectedDays = pair.days.slice(0, 3)
    if (selectedDays.length === 0) continue
    suggestions.push({
      vehicleId: pair.vehicleId,
      mfyId: pair.mfyId,
      dayOfWeek: selectedDays,
      reason: `GPS tarixidan: ${pair.total} marta tashrif (${DAYS_BACK} kun)`,
    })
  }

  return {
    suggestions,
    source: 'gps',
    analyzedDays: DAYS_BACK,
    vehiclesWithData,
    mfysDetected: mfysCovered.size,
  }
}

/**
 * Asosiy funksiya: GPS/DB tarixidan jadval taklifi yaratadi.
 * Priority: DB trips → Wialon GPS → round-robin fallback
 */
export async function suggestScheduleFromGps(orgId: string): Promise<GpsSuggestResult> {
  const vehicles = await getOrgVehicleIds(orgId)

  if (vehicles.length === 0) {
    return { suggestions: [], source: 'fallback', analyzedDays: 0, vehiclesWithData: 0, mfysDetected: 0 }
  }

  const vIds = vehicles.map(v => v.id)

  // 1. DB trips fast path (ms darajada)
  const dbResult = await suggestFromDbTrips(orgId, vIds)
  if (dbResult) return dbResult

  // 2. Wialon GPS slow path (faqat trips yo'q bo'lganda)
  const gpsResult = await suggestFromRawGps(orgId, vIds, vehicles)
  if (gpsResult) return gpsResult

  // 3. Round-robin fallback
  const fallback = await suggestOptimalSchedule(orgId)
  return { suggestions: fallback, source: 'fallback', analyzedDays: 0, vehiclesWithData: 0, mfysDetected: 0 }
}
