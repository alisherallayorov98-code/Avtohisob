/**
 * Toza-Hudud: Marshut taklifi (Greedy Nearest-Neighbor TSP)
 *
 * Haydovchining bugungi MFYlari uchun optimal tartibni hisoblaydi.
 * Algoritm: polygon centroidlaridan greedy eng yaqin qo'shni.
 */

import { prisma } from '../../../lib/prisma'

export interface RoutePoint {
  order: number
  mfyId: string
  mfyName: string
  district: string
  centroid: [number, number]        // [lat, lon] — Leaflet formatida
  distanceFromPrevKm: number | null // null birinchi nuqta uchun
  cumulativeKm: number
}

// ── Geometriya yordamchilari ──────────────────────────────────────────────────

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLon = (b[1] - a[1]) * Math.PI / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const c = sinLat * sinLat +
    Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * sinLon * sinLon
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c))
}

/**
 * GeoJSON polygon koordinatalaridan centroid hisoblaydi.
 * GeoJSON: [[lon, lat], ...] — biz [lat, lon] qaytaramiz (Leaflet uchun).
 */
function computeCentroid(polygon: any): [number, number] {
  // polygon — GeoJSON Polygon.coordinates[0]: [[lon, lat], ...]
  let coords: number[][] = []

  if (Array.isArray(polygon)) {
    if (polygon.length === 0) return [41.3, 69.2]
    // GeoJSON Polygon.coordinates[0] yoki to'g'ridan-to'g'ri koordinatalar massivi
    const first = polygon[0]
    if (Array.isArray(first) && Array.isArray(first[0])) {
      // [[lon, lat], ...] ichida nested bo'lishi mumkin
      coords = first as number[][]
    } else if (Array.isArray(first) && typeof first[0] === 'number') {
      coords = polygon as number[][]
    }
  } else if (polygon?.coordinates) {
    // GeoJSON Polygon object
    coords = polygon.coordinates[0] as number[][]
  }

  if (coords.length === 0) return [41.3, 69.2]

  let sumLat = 0, sumLon = 0
  for (const pt of coords) {
    sumLon += pt[0]
    sumLat += pt[1]
  }
  return [sumLat / coords.length, sumLon / coords.length]
}

// ── Greedy nearest-neighbor ───────────────────────────────────────────────────

interface Candidate {
  mfyId: string
  mfyName: string
  district: string
  centroid: [number, number]
}

function greedyRoute(candidates: Candidate[]): RoutePoint[] {
  if (candidates.length === 0) return []
  if (candidates.length === 1) {
    return [{
      order: 1,
      mfyId: candidates[0].mfyId,
      mfyName: candidates[0].mfyName,
      district: candidates[0].district,
      centroid: candidates[0].centroid,
      distanceFromPrevKm: null,
      cumulativeKm: 0,
    }]
  }

  const remaining = [...candidates]
  const result: RoutePoint[] = []
  // Geografik markazdan eng yaqin nuqtadan boshlaymiz
  const centerLat = candidates.reduce((s, c) => s + c.centroid[0], 0) / candidates.length
  const centerLon = candidates.reduce((s, c) => s + c.centroid[1], 0) / candidates.length
  let current: [number, number] = [centerLat, centerLon]
  let cumulative = 0

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i].centroid)
      if (d < nearestDist) { nearestDist = d; nearestIdx = i }
    }

    const chosen = remaining.splice(nearestIdx, 1)[0]
    const isFirst = result.length === 0
    const dist = isFirst ? null : haversineKm(current, chosen.centroid)
    if (!isFirst && dist !== null) cumulative += dist

    result.push({
      order: result.length + 1,
      mfyId: chosen.mfyId,
      mfyName: chosen.mfyName,
      district: chosen.district,
      centroid: chosen.centroid,
      distanceFromPrevKm: isFirst ? null : Math.round((dist ?? 0) * 10) / 10,
      cumulativeKm: Math.round(cumulative * 10) / 10,
    })

    current = chosen.centroid
  }

  return result
}

// ── Asosiy export ─────────────────────────────────────────────────────────────

/**
 * Berilgan mashina va sana uchun optimal marshut tartibini qaytaradi.
 * vehicleId + date → jadval → MFY polygonlar → centroid → greedy TSP.
 */
export async function suggestDayRoute(vehicleId: string, date: Date): Promise<RoutePoint[]> {
  const uzDow = (date.getUTCDay() + 6) % 7

  // Bugun ushbu mashina uchun belgilangan MFYlar
  const schedules = await (prisma as any).thSchedule.findMany({
    where: { vehicleId, dayOfWeek: { has: uzDow } },
    select: { mfyId: true },
  }).catch(() => [] as any[])

  if (schedules.length === 0) return []

  const mfyIds: string[] = [...new Set<string>(schedules.map((s: any) => s.mfyId as string))]

  const mfys = await (prisma as any).thMfy.findMany({
    where: { id: { in: mfyIds } },
    select: {
      id: true, name: true, polygon: true,
      district: { select: { name: true } },
    },
  }).catch(() => [] as any[])

  const all: Candidate[] = mfys.map((m: any) => ({
    mfyId: m.id,
    mfyName: m.name,
    district: m.district?.name ?? '',
    centroid: computeCentroid(m.polygon),
  }))

  // Polygon mavjud MFYlarni ustuvor ko'rsatamiz (centroid Toshkent default emas)
  const candidates = all.filter((c: Candidate) => c.centroid[0] !== 41.3 || c.centroid[1] !== 69.2)

  // Agar hech bir polygon bo'lmasa — barchasini ishlatamiz
  return greedyRoute(candidates.length > 0 ? candidates : all)
}
