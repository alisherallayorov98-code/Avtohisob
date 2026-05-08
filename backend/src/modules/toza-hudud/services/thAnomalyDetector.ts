/**
 * Toza-Hudud: Anomaliya va firibgarlik aniqlash
 *
 * Har bir thServiceTrip uchun 4 ta anomaliya tekshiruvi:
 *   tooFast       — maksimal tezlik sozlamadan yuqori (mavjud suspicious maydonini kengaytiradi)
 *   timeTooShort  — MFY maydoniga nisbatan ichida o'tkazilgan vaqt juda qisqa
 *   linearTrack   — GPS nuqtalari to'g'ri chiziq shaklida (qurilma manipulyatsiyasi)
 *   edgeOnly      — faqat polygon chetidan o'tib ketgan, ichiga kirmagan
 *
 * runAnomalyBatch(orgId, date) — barcha visited triplar uchun batch tahlil + Telegram
 */

import { prisma } from '../../../lib/prisma'
import type { TrackPoint } from './thMonitor'
import { getDayUtsRange, findCredForVehicle } from './thMonitor'
import { getVehicleTrackPoints } from '../../../services/wialonService'

// ── Interfeys ─────────────────────────────────────────────────────────────────

export interface AnomalyFlags {
  tooFast: boolean
  timeTooShort: boolean
  linearTrack: boolean
  edgeOnly: boolean
}

export interface AnomalyResult {
  vehicleId: string
  mfyId: string
  mfyName: string
  registrationNumber: string
  flags: AnomalyFlags
  durationMin: number | null
  maxSpeedKmh: number | null
}

// ── Geometriya yordamchilari ──────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** GeoJSON polygon maydonini km² da hisoblaydi (Shoelace formula) */
function polygonAreaKm2(polygon: any): number {
  let coords: number[][] = []
  if (!polygon) return 0
  try {
    if (polygon.type === 'Feature') coords = polygon.geometry?.coordinates?.[0] ?? []
    else if (polygon.type === 'Polygon') coords = polygon.coordinates?.[0] ?? []
    else if (polygon.type === 'FeatureCollection') coords = polygon.features?.[0]?.geometry?.coordinates?.[0] ?? []
    else if (Array.isArray(polygon)) {
      coords = Array.isArray(polygon[0][0]) ? polygon[0] : polygon
    }
  } catch { return 0 }

  if (coords.length < 3) return 0

  // Shoelace formula (lon=x, lat=y), approximate km² using 111km/degree
  let area = 0
  const n = coords.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (coords[j][0] + coords[i][0]) * (coords[j][1] - coords[i][1])
  }
  const degArea = Math.abs(area) / 2
  // 1 degree lat ≈ 111 km, 1 degree lon ≈ 111 * cos(lat) km
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length
  const km2 = degArea * 111 * 111 * Math.cos(midLat * Math.PI / 180)
  return Math.abs(km2)
}

/** Polygon centroidini hisoblaydi (lat, lon) */
function polygonCentroid(polygon: any): [number, number] {
  let coords: number[][] = []
  try {
    if (polygon.type === 'Feature') coords = polygon.geometry?.coordinates?.[0] ?? []
    else if (polygon.type === 'Polygon') coords = polygon.coordinates?.[0] ?? []
    else if (polygon.type === 'FeatureCollection') coords = polygon.features?.[0]?.geometry?.coordinates?.[0] ?? []
    else if (Array.isArray(polygon)) coords = Array.isArray(polygon[0][0]) ? polygon[0] : polygon
  } catch {}
  if (coords.length === 0) return [0, 0]
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length
  const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length
  return [lat, lon]
}

/** Polygon "radiusi" — markazdan eng uzoq vertex gacha bo'lgan masofa (metrda) */
function polygonRadius(centroid: [number, number], polygon: any): number {
  let coords: number[][] = []
  try {
    if (polygon.type === 'Feature') coords = polygon.geometry?.coordinates?.[0] ?? []
    else if (polygon.type === 'Polygon') coords = polygon.coordinates?.[0] ?? []
    else if (Array.isArray(polygon)) coords = Array.isArray(polygon[0][0]) ? polygon[0] : polygon
  } catch {}
  if (coords.length === 0) return 300
  return Math.max(...coords.map(c => haversineM(centroid[0], centroid[1], c[1], c[0])))
}

// ── Anomaliya detektorlari ────────────────────────────────────────────────────

/**
 * Vaqt anomaliyasi: MFY maydoni va haydovchi tezligiga nisbatan ichida juda kam vaqt.
 * Minimal kutilgan vaqt: sqrt(areaKm2) * 8 daqiqa (1 km² ≈ 8 daqiqa minimal xizmat vaqti).
 * Agar haqiqiy vaqt bu minimumning 30% dan kam bo'lsa — shubhali.
 */
function detectTimeTooShort(
  areaKm2: number,
  durationMin: number | null,
): boolean {
  if (durationMin === null || durationMin <= 0) return false
  if (areaKm2 < 0.05) return false  // Juda kichik MFY — tekshirmaylik
  const minExpectedMin = Math.sqrt(areaKm2) * 8
  return durationMin < minExpectedMin * 0.30
}

/**
 * GPS to'g'ri chiziq anomaliyasi: polygon ichidagi nuqtalar R² > 0.97 bo'lsa.
 * Signal yo'qolganda GPS oxirgi pozitsiyani takrorlaydi → to'g'ri chiziq hosil bo'ladi.
 */
function detectLinearTrack(points: TrackPoint[]): boolean {
  if (points.length < 8) return false

  const lats = points.map(p => p.lat)
  const lons = points.map(p => p.lon)
  const n = points.length

  const meanLat = lats.reduce((s, v) => s + v, 0) / n
  const meanLon = lons.reduce((s, v) => s + v, 0) / n

  let ssTotal = 0, ssRes = 0
  const ssXX = lats.reduce((s, v) => s + (v - meanLat) ** 2, 0)
  const ssXY = lats.reduce((s, v, i) => s + (v - meanLat) * (lons[i] - meanLon), 0)

  if (ssXX < 1e-12) return false  // Barcha lat bir xil — statik nuqta

  const slope = ssXY / ssXX
  const intercept = meanLon - slope * meanLat

  for (let i = 0; i < n; i++) {
    const predicted = slope * lats[i] + intercept
    ssRes += (lons[i] - predicted) ** 2
    ssTotal += (lons[i] - meanLon) ** 2
  }

  if (ssTotal < 1e-14) return false
  const r2 = 1 - ssRes / ssTotal
  return r2 > 0.97
}

/**
 * Chegara anomaliyasi: haydovchi polygon ichiga kirmay, faqat chetidan o'tgan.
 * O'rtacha GPS nuqtadan markazga masofa polygon radiusining 70% dan ortiq bo'lsa.
 */
function detectEdgeOnly(
  insidePoints: TrackPoint[],
  centroid: [number, number],
  radius: number,
): boolean {
  if (insidePoints.length < 3 || radius < 50) return false
  const avgDist = insidePoints.reduce(
    (s, p) => s + haversineM(centroid[0], centroid[1], p.lat, p.lon), 0
  ) / insidePoints.length
  return avgDist > radius * 0.72
}

// ── Bitta trip uchun barcha anomaliyalarni aniqlash ───────────────────────────

export function detectAnomalies(
  mfyPolygon: any,
  insidePoints: TrackPoint[],    // polygon ichidagi GPS nuqtalar
  durationMin: number | null,
  maxSpeedKmh: number | null,
  suspiciousSpeedKmh: number,
): AnomalyFlags {
  const area = polygonAreaKm2(mfyPolygon)
  const centroid = polygonCentroid(mfyPolygon)
  const radius = polygonRadius(centroid, mfyPolygon)

  return {
    tooFast: (maxSpeedKmh ?? 0) > suspiciousSpeedKmh,
    timeTooShort: detectTimeTooShort(area, durationMin),
    linearTrack: detectLinearTrack(insidePoints),
    edgeOnly: detectEdgeOnly(insidePoints, centroid, radius),
  }
}

// ── Batch tahlil (kechki monitoring uchun) ────────────────────────────────────

export async function runAnomalyBatch(
  orgId: string,
  date: Date,
): Promise<AnomalyResult[]> {
  const dateOnly = new Date(date.toISOString().split('T')[0] + 'T00:00:00.000Z')
  const { fromTs, toTs } = getDayUtsRange(date)

  // Org ga tegishli filiallar va mashinalar
  const branches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  const branchIds = branches.map((b: any) => b.id)
  if (branchIds.length === 0) return []

  const vehicles = await prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true, registrationNumber: true },
  }).catch(() => [] as any[])
  const vehicleMap = new Map(vehicles.map((v: any) => [v.id, v.registrationNumber]))
  const vIds = vehicles.map((v: any) => v.id)

  // Bugun borilgan triplar
  const trips = await (prisma as any).thServiceTrip.findMany({
    where: { vehicleId: { in: vIds }, date: dateOnly, status: 'visited' },
    select: {
      id: true, vehicleId: true, mfyId: true,
      enteredAt: true, exitedAt: true, maxSpeedKmh: true,
      mfy: { select: { name: true, polygon: true } },
    },
  }).catch(() => [] as any[])

  if (trips.length === 0) return []

  // Sozlamalar
  const settings = await (prisma as any).thSetting.findFirst({
    where: { organizationId: orgId },
    select: { suspiciousSpeedKmh: true },
  }).catch(() => null)
  const suspiciousSpeedKmh = settings?.suspiciousSpeedKmh ?? 25

  const results: AnomalyResult[] = []

  // Vehicle bo'yicha guruhlaymiz — bir marta GPS tortish uchun
  const byVehicle = new Map<string, typeof trips>()
  for (const t of trips) {
    const arr = byVehicle.get(t.vehicleId) ?? []
    arr.push(t)
    byVehicle.set(t.vehicleId, arr)
  }

  for (const [vehicleId, vTrips] of byVehicle) {
    // GPS trekni bir marta tortamiz
    const cred = await findCredForVehicle(vehicleId).catch(() => null)
    if (!cred) continue

    const track = await getVehicleTrackPoints(
      cred.credId, cred.lookupKey, fromTs, toTs
    ).catch(() => [] as TrackPoint[])

    if (track.length === 0) continue

    for (const trip of vTrips) {
      if (!trip.mfy?.polygon) continue
      try {
        const durationMin = (trip.enteredAt && trip.exitedAt)
          ? Math.round((new Date(trip.exitedAt).getTime() - new Date(trip.enteredAt).getTime()) / 60000)
          : null

        // Polygon ichidagi nuqtalarni filtrlash
        const insidePoints = track.filter((pt: TrackPoint) => {
          try {
            return pointInPolygonSimple(pt.lat, pt.lon, trip.mfy.polygon)
          } catch { return false }
        })

        const flags = detectAnomalies(
          trip.mfy.polygon,
          insidePoints,
          durationMin,
          trip.maxSpeedKmh,
          suspiciousSpeedKmh,
        )

        const hasAnomaly = flags.tooFast || flags.timeTooShort || flags.linearTrack || flags.edgeOnly

        // DB yangilash
        await (prisma as any).thServiceTrip.update({
          where: { id: trip.id },
          data: {
            anomalyFlags: flags as any,
            suspicious: flags.tooFast || flags.timeTooShort,
          },
        }).catch(() => null)

        if (hasAnomaly) {
          results.push({
            vehicleId,
            mfyId: trip.mfyId,
            mfyName: trip.mfy.name,
            registrationNumber: vehicleMap.get(vehicleId) ?? vehicleId,
            flags,
            durationMin,
            maxSpeedKmh: trip.maxSpeedKmh,
          })
        }
      } catch (e: any) {
        console.error(`[ThAnomaly] trip=${trip.id}:`, e?.message)
      }
    }
  }

  return results
}

// ── Oddiy ray-casting (thMonitor.ts ga bog'liq bo'lmaslik uchun) ──────────────

function pointInPolygonSimple(lat: number, lon: number, polygon: any): boolean {
  let coords: number[][] = []
  try {
    if (polygon.type === 'Feature') coords = polygon.geometry?.coordinates?.[0] ?? []
    else if (polygon.type === 'Polygon') coords = polygon.coordinates?.[0] ?? []
    else if (polygon.type === 'FeatureCollection') coords = polygon.features?.[0]?.geometry?.coordinates?.[0] ?? []
    else if (Array.isArray(polygon)) coords = Array.isArray(polygon[0][0]) ? polygon[0] : polygon
  } catch { return false }

  if (coords.length < 3) return false
  let inside = false
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1]
    const xj = coords[j][0], yj = coords[j][1]
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
