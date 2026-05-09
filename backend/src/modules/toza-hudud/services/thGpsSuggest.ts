/**
 * Toza-Hudud: GPS tarixiga asoslangan jadval taklifi
 *
 * So'nggi 14 kun ichida qaysi mashina qaysi MFY da bo'lganini GPS trek ma'lumotlaridan aniqlaydi.
 * pointInPolygon algoritmi orqali har bir kun uchun mashina-MFY juftlarini hisoblab,
 * haftalik chastotani chiqaradi va ScheduleSuggestion[] qaytaradi.
 *
 * GPS ma'lumoti yo'q bo'lsa — suggestOptimalSchedule() fallback ishlatiladi.
 */

import { prisma } from '../../../lib/prisma'
import { getVehicleTracksBatch } from '../../../services/wialonService'
import { ScheduleSuggestion, suggestOptimalSchedule } from './thScheduleOptimizer'

// pointInPolygon — thMonitor.ts dan ko'chirilgan, local nusxa
function pointInPolygon(lat: number, lon: number, geojson: any): boolean {
  let coords: number[][] | null = null
  try {
    if (geojson.type === 'Feature') coords = geojson.geometry?.coordinates?.[0]
    else if (geojson.type === 'Polygon') coords = geojson.coordinates?.[0]
    else if (geojson.type === 'FeatureCollection') {
      const f = geojson.features?.[0]
      if (f?.geometry?.type === 'Polygon') coords = f.geometry.coordinates[0]
    }
  } catch { return false }
  if (!coords || coords.length < 3) return false

  let inside = false
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1]
    const xj = coords[j][0], yj = coords[j][1]
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// GPS nuqtalarning qaysi soni polygon ichida ekanini aniqlaydi
function countPointsInPolygon(
  points: Array<{ lat: number; lon: number; ts: number }>,
  polygon: any,
): number {
  let count = 0
  for (const p of points) {
    if (pointInPolygon(p.lat, p.lon, polygon)) count++
  }
  return count
}

// UNIX timestamp dan UTC kun-of-week (0=Du...6=Ya, UZT) ni chiqaradi
function tsToUzDow(ts: number): number {
  const d = new Date(ts * 1000)
  return (d.getUTCDay() + 6) % 7
}

// UNIX timestamp dan 'YYYY-MM-DD' sana chiqaradi
function tsToDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().split('T')[0]
}

export interface GpsSuggestResult {
  suggestions: ScheduleSuggestion[]
  source: 'gps' | 'fallback'
  analyzedDays: number
  vehiclesWithData: number
  mfysDetected: number
}

/**
 * Asosiy funksiya: GPS tarixidan jadval taklifi yaratadi.
 * orgId bo'yicha barcha aktiv mashinalar va MFYlar olinadi,
 * 14 kunlik trek ma'lumotlari yuklangach polygon-in-point tekshiruvi o'tkaziladi.
 */
export async function suggestScheduleFromGps(orgId: string): Promise<GpsSuggestResult> {
  const DAYS_BACK = 14
  const MIN_POINTS_IN_POLYGON = 5   // MFY ga tashrif hisob qilinishi uchun minimum GPS nuqtalar soni
  const MIN_VISIT_MINUTES = 3        // Tashrifning minimal davomiyligi (daqiqa)

  // GPS credential
  const cred = await (prisma as any).gpsCredential.findFirst({
    where: { orgId, isActive: true },
    select: { id: true },
  }).catch(() => null)

  if (!cred) {
    const fallback = await suggestOptimalSchedule(orgId)
    return { suggestions: fallback, source: 'fallback', analyzedDays: 0, vehiclesWithData: 0, mfysDetected: 0 }
  }

  // Org vehicle lar
  const branches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  const branchIds = branches.map((b: any) => b.id)

  const vehicles = branchIds.length
    ? await prisma.vehicle.findMany({
        where: { branchId: { in: branchIds }, status: 'active' },
        select: { id: true, registrationNumber: true },
      }).catch(() => [] as { id: string; registrationNumber: string }[])
    : []

  if (vehicles.length === 0) {
    return { suggestions: [], source: 'gps', analyzedDays: DAYS_BACK, vehiclesWithData: 0, mfysDetected: 0 }
  }

  // Polygon mavjud MFYlar
  const mfys = await (prisma as any).thMfy.findMany({
    where: { organizationId: orgId, polygon: { not: null } },
    select: { id: true, name: true, polygon: true },
  }).catch(() => [] as any[])

  if (mfys.length === 0) {
    // Polygon yo'q — fallback
    const fallback = await suggestOptimalSchedule(orgId)
    return { suggestions: fallback, source: 'fallback', analyzedDays: 0, vehiclesWithData: 0, mfysDetected: 0 }
  }

  // 14 kunlik vaqt oralig'i
  const now = Math.floor(Date.now() / 1000)
  const fromTs = now - DAYS_BACK * 86400

  const vehicleInputs = vehicles.map(v => ({
    vehicleId: v.id,
    lookupKey: v.registrationNumber,
  }))

  // Batch trek yuklash — 1 ta login + 1 ta getUnits
  const tracks = await getVehicleTracksBatch(cred.id, vehicleInputs, fromTs, now, 6)

  // vehicleId → sana → Set<mfyId> (tashrif bo'lgan MFYlar)
  const visitMap = new Map<string, Map<string, Set<string>>>()

  let vehiclesWithData = 0

  for (const vehicle of vehicles) {
    const points = tracks.get(vehicle.id) || []
    if (points.length === 0) continue
    vehiclesWithData++

    // Kunlar bo'yicha guruh: dateStr → points[]
    const byDate = new Map<string, typeof points>()
    for (const p of points) {
      const d = tsToDateStr(p.ts)
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(p)
    }

    const dateVisits = new Map<string, Set<string>>()
    visitMap.set(vehicle.id, dateVisits)

    for (const [dateStr, dayPoints] of byDate) {
      const visitedMfys = new Set<string>()

      for (const mfy of mfys) {
        let polygon: any
        try {
          polygon = typeof mfy.polygon === 'string' ? JSON.parse(mfy.polygon) : mfy.polygon
        } catch { continue }

        // MFY polygon ichidagi nuqtalar
        const inPoly = dayPoints.filter(p => pointInPolygon(p.lat, p.lon, polygon))
        if (inPoly.length < MIN_POINTS_IN_POLYGON) continue

        // Minimal davomiylik tekshiruvi (daqiqa)
        const times = inPoly.map(p => p.ts).sort()
        const durationMin = (times[times.length - 1] - times[0]) / 60
        if (durationMin < MIN_VISIT_MINUTES) continue

        visitedMfys.add(mfy.id)
      }

      if (visitedMfys.size > 0) {
        dateVisits.set(dateStr, visitedMfys)
      }
    }
  }

  // vehicle-MFY juftlari uchun kun-of-week chastotasini hisoblash
  // structure: vehicleId → mfyId → dow → count
  const freq = new Map<string, Map<string, Map<number, number>>>()

  for (const [vehicleId, dateMap] of visitMap) {
    for (const [dateStr, mfyIds] of dateMap) {
      const ts = new Date(dateStr + 'T12:00:00.000Z').getTime() / 1000
      const dow = tsToUzDow(ts)

      for (const mfyId of mfyIds) {
        if (!freq.has(vehicleId)) freq.set(vehicleId, new Map())
        const vMap = freq.get(vehicleId)!
        if (!vMap.has(mfyId)) vMap.set(mfyId, new Map())
        const dMap = vMap.get(mfyId)!
        dMap.set(dow, (dMap.get(dow) || 0) + 1)
      }
    }
  }

  // GPS asosidagi takliflarni yaratish
  const suggestions: ScheduleSuggestion[] = []
  const mfysCovered = new Set<string>()
  const assignedMfys = new Set<string>() // har bir MFY faqat bir marta (eng yaxshi vehicle)

  // Har vehicle-MFY juftini yig'ish
  const pairs: Array<{
    vehicleId: string
    mfyId: string
    days: number[]
    totalVisits: number
  }> = []

  for (const [vehicleId, vMap] of freq) {
    for (const [mfyId, dMap] of vMap) {
      // Haftada necha marta borgan (14 kunda)
      const totalVisits = [...dMap.values()].reduce((a, b) => a + b, 0)
      // Qaysi kunlar borilgan (2+ haftalik bo'lsa takroriy kunlar bor)
      const days = [...dMap.entries()]
        .filter(([, count]) => count >= 1)
        .sort((a, b) => b[1] - a[1])
        .map(([dow]) => dow)

      pairs.push({ vehicleId, mfyId, days, totalVisits })
    }
  }

  // Ko'p tashrif bo'lgan juftlar avval (reliable data)
  pairs.sort((a, b) => b.totalVisits - a.totalVisits)

  for (const pair of pairs) {
    if (assignedMfys.has(pair.mfyId)) continue // bir MFY — bir jadval
    assignedMfys.add(pair.mfyId)
    mfysCovered.add(pair.mfyId)

    // Haftada max 3 kun (GPS dan real kunlar)
    const selectedDays = pair.days.slice(0, 3)
    if (selectedDays.length === 0) continue

    const totalVisits = pair.totalVisits
    suggestions.push({
      vehicleId: pair.vehicleId,
      mfyId: pair.mfyId,
      dayOfWeek: selectedDays,
      reason: `GPS tarixidan: ${totalVisits} marta tashrif (${DAYS_BACK} kun)`,
    })
  }

  // Qolgan MFYlar uchun fallback (polygon bor lekin GPS da ko'rinmagan)
  const uncoveredMfyIds = mfys
    .map((m: any) => m.id)
    .filter((id: string) => !mfysCovered.has(id))

  if (uncoveredMfyIds.length > 0 && vehicles.length > 0) {
    // Round-robin assignment for uncovered MFYs
    const WORKDAYS = [0, 1, 2, 3, 4]
    let vi = 0
    for (const mfyId of uncoveredMfyIds) {
      suggestions.push({
        vehicleId: vehicles[vi % vehicles.length].id,
        mfyId,
        dayOfWeek: [WORKDAYS[vi % WORKDAYS.length], WORKDAYS[(vi + 2) % WORKDAYS.length]],
        reason: 'GPS da ko\'rilmagan — avtomatik taqsimlash',
      })
      vi++
    }
  }

  return {
    suggestions,
    source: 'gps',
    analyzedDays: DAYS_BACK,
    vehiclesWithData,
    mfysDetected: mfysCovered.size,
  }
}
