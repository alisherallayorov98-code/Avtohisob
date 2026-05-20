/**
 * Ko'cha qamrovini GPS trek nuqtalariga asoslanib hisoblaydi.
 * OSM ko'chalari (ThMfyStreet) va mavjud ThCoverageFingerprint kataklar ishlatiladi.
 */

import { prisma } from '../../../lib/prisma'
import { getVehicleTrackPoints } from '../../../services/wialonService'
import { getDayUtsRange, findCredForVehicle, TrackPoint } from './thMonitor'

const R = 6371000

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Ko'cha polyline'ini interval metrda nuqtalarga bo'ladi
function samplePolyline(coords: [number, number][], intervalM = 20): [number, number][] {
  if (coords.length < 2) return coords
  const samples: [number, number][] = [coords[0]]
  let carry = 0
  for (let i = 1; i < coords.length; i++) {
    const segLen = distM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
    carry += segLen
    while (carry >= intervalM) {
      carry -= intervalM
      const t = 1 - carry / segLen
      samples.push([
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ])
    }
  }
  samples.push(coords[coords.length - 1])
  return samples
}

// Nuqta ko'cha polyline'iga radiusM dan yaqinmi?
function isPointNearPolyline(lat: number, lon: number, coords: [number, number][], radiusM: number): boolean {
  for (const [clat, clon] of coords) {
    if (distM(lat, lon, clat, clon) <= radiusM) return true
  }
  return false
}

export interface StreetCoverageResult {
  osmWayId: string
  name: string | null
  highway: string
  lengthM: number
  covered: boolean
  coverPct: number   // 0-100: qancha ulushi qoplangan
}

export interface MfyStreetStats {
  mfyId: string
  mfyName: string
  totalStreets: number
  coveredStreets: number
  totalLengthM: number
  coveredLengthM: number
  coveragePct: number
  streets: StreetCoverageResult[]
}

// GPS track nuqtalaridan ko'cha qamrovini hisoblaydi
export function computeStreetCoverage(
  streets: Array<{ osmWayId: string; name: string | null; highway: string; geometry: any; lengthM: number }>,
  trackPoints: TrackPoint[],
  coverageRadiusM = 30,
): StreetCoverageResult[] {
  return streets.map(st => {
    const coords = (st.geometry as [number, number][])
    const samples = samplePolyline(coords, 15)

    let coveredSamples = 0
    for (const [slat, slon] of samples) {
      for (const tp of trackPoints) {
        if (distM(slat, slon, tp.lat, tp.lon) <= coverageRadiusM) {
          coveredSamples++
          break
        }
      }
    }
    const coverPct = samples.length > 0 ? Math.round(coveredSamples * 100 / samples.length) : 0
    return {
      osmWayId: st.osmWayId,
      name: st.name,
      highway: st.highway,
      lengthM: st.lengthM,
      covered: coverPct >= 50,
      coverPct,
    }
  })
}

// MFY uchun ko'cha statistikasini tayyorlaydi (oxirgi N kun yoki sanalar)
export async function getMfyStreetStats(
  mfyId: string,
  vehicleIds: string[],
  dates: string[],
  coverageRadiusM = 30,
): Promise<MfyStreetStats> {
  const mfy = await (prisma as any).thMfy.findUnique({
    where: { id: mfyId },
    select: { id: true, name: true, streets: true },
  })
  if (!mfy) throw new Error('MFY topilmadi')

  if (!mfy.streets?.length) {
    return {
      mfyId,
      mfyName: mfy.name,
      totalStreets: 0,
      coveredStreets: 0,
      totalLengthM: 0,
      coveredLengthM: 0,
      coveragePct: 0,
      streets: [],
    }
  }

  // Barcha mashinalar + sanalar uchun GPS track nuqtalarini yig'amiz
  const allPoints: TrackPoint[] = []
  for (const vehicleId of vehicleIds) {
    const credInfo = await findCredForVehicle(vehicleId).catch(() => null)
    if (!credInfo) continue
    for (const dateStr of dates) {
      const { fromTs, toTs } = getDayUtsRange(new Date(dateStr + 'T00:00:00.000Z'))
      const pts = await getVehicleTrackPoints(credInfo.credId, credInfo.lookupKey, fromTs, toTs).catch(() => [] as TrackPoint[])
      allPoints.push(...pts)
    }
  }

  const results = computeStreetCoverage(mfy.streets, allPoints, coverageRadiusM)

  const covered = results.filter(r => r.covered)
  const totalLengthM = results.reduce((s, r) => s + r.lengthM, 0)
  const coveredLengthM = covered.reduce((s, r) => s + r.lengthM, 0)

  return {
    mfyId,
    mfyName: mfy.name,
    totalStreets: results.length,
    coveredStreets: covered.length,
    totalLengthM: Math.round(totalLengthM),
    coveredLengthM: Math.round(coveredLengthM),
    coveragePct: totalLengthM > 0 ? Math.round(coveredLengthM * 100 / totalLengthM) : 0,
    streets: results,
  }
}

// Tashkilot bo'yicha barcha MFY larning ko'cha qamrovini hisoblaydi (oxirgi 7 kun)
export async function getOrgStreetCoverageStats(organizationId: string): Promise<{
  totalMfys: number
  mfysWithStreets: number
  avgCoveragePct: number
  topMissed: Array<{ mfyId: string; mfyName: string; coveragePct: number; coveredStreets: number; totalStreets: number }>
}> {
  const mfys = await (prisma as any).thMfy.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      streets: { select: { osmWayId: true, lengthM: true } },
    },
  })

  const mfysWithStreets = mfys.filter((m: any) => m.streets?.length > 0)

  // Last 7 days
  const dates: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }

  // Per-MFY get trips' vehicles
  const mfyStats: Array<{ mfyId: string; mfyName: string; coveragePct: number; coveredStreets: number; totalStreets: number }> = []
  for (const mfy of mfysWithStreets.slice(0, 20)) {
    const trips = await (prisma as any).thServiceTrip.findMany({
      where: {
        mfyId: mfy.id,
        date: { in: dates.map((d: string) => new Date(d + 'T00:00:00.000Z')) },
      },
      select: { vehicleId: true },
      distinct: ['vehicleId'],
    })
    const vehicleIds = trips.map((t: any) => t.vehicleId)
    if (!vehicleIds.length) {
      mfyStats.push({ mfyId: mfy.id, mfyName: mfy.name, coveragePct: 0, coveredStreets: 0, totalStreets: mfy.streets.length })
      continue
    }
    try {
      const stats = await getMfyStreetStats(mfy.id, vehicleIds, dates.slice(-3))
      mfyStats.push({ mfyId: stats.mfyId, mfyName: stats.mfyName, coveragePct: stats.coveragePct, coveredStreets: stats.coveredStreets, totalStreets: stats.totalStreets })
    } catch {
      mfyStats.push({ mfyId: mfy.id, mfyName: mfy.name, coveragePct: 0, coveredStreets: 0, totalStreets: mfy.streets.length })
    }
  }

  const avgCoveragePct = mfyStats.length > 0
    ? Math.round(mfyStats.reduce((s, m) => s + m.coveragePct, 0) / mfyStats.length)
    : 0

  const topMissed = [...mfyStats].sort((a, b) => a.coveragePct - b.coveragePct).slice(0, 10)

  return {
    totalMfys: mfys.length,
    mfysWithStreets: mfysWithStreets.length,
    avgCoveragePct,
    topMissed,
  }
}
