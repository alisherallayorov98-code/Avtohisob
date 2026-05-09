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
import { haversineM, pointInPolygon, polygonAreaKm2, polygonCentroid, polygonRadius } from '../utils/geoUtils'

// ── Interfeys ─────────────────────────────────────────────────────────────────

export interface AnomalyFlags {
  tooFast: boolean
  timeTooShort: boolean
  linearTrack: boolean
  edgeOnly: boolean
}

export interface AnomalyDetails {
  maxSpeedKmh: number | null
  limitKmh: number          // suspiciousSpeedKmh sozlamasi
  durationMin: number | null
  expectedMinMin: number | null  // timeTooShort uchun minimal kutilgan vaqt
  areaKm2: number               // MFY maydoni
}

export interface AnomalyResult {
  vehicleId: string
  mfyId: string
  mfyName: string
  registrationNumber: string
  flags: AnomalyFlags
  durationMin: number | null
  maxSpeedKmh: number | null
  details: AnomalyDetails
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
): { flags: AnomalyFlags; details: AnomalyDetails } {
  const area = polygonAreaKm2(mfyPolygon)
  const centroid = polygonCentroid(mfyPolygon)
  const radius = polygonRadius(centroid, mfyPolygon)
  const expectedMinMin = area >= 0.05 ? Math.round(Math.sqrt(area) * 8 * 0.30 * 10) / 10 : null

  const flags: AnomalyFlags = {
    tooFast: (maxSpeedKmh ?? 0) > suspiciousSpeedKmh,
    timeTooShort: detectTimeTooShort(area, durationMin),
    linearTrack: detectLinearTrack(insidePoints),
    edgeOnly: detectEdgeOnly(insidePoints, centroid, radius),
  }
  const details: AnomalyDetails = {
    maxSpeedKmh,
    limitKmh: suspiciousSpeedKmh,
    durationMin,
    expectedMinMin,
    areaKm2: Math.round(area * 1000) / 1000,
  }
  return { flags, details }
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
            return pointInPolygon(pt.lat, pt.lon, trip.mfy.polygon)
          } catch { return false }
        })

        const { flags, details } = detectAnomalies(
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
            anomalyFlags: { ...flags, details } as any,
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
            details,
          })
        }
      } catch (e: any) {
        console.error(`[ThAnomaly] trip=${trip.id}:`, e?.message)
      }
    }
  }

  return results
}

