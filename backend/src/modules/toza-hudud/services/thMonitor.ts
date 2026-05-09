import { prisma } from '../../../lib/prisma'
import { getVehicleTracksBatch } from '../../../services/wialonService'
import { loadThSettings } from '../controllers/settings'
import { haversineM, pointInPolygon } from '../utils/geoUtils'

export interface TrackPoint {
  lat: number
  lon: number
  speed: number
  ts: number
}

export interface GridCell {
  lat: number
  lon: number
  covered: boolean
}

export interface GridOptions {
  gridCellM?: number
  coverageRadiusM?: number
}

// Grid usulida MFY qamrovini hisoblaydi — polygon + track dan kataklar ro'yxatini qaytaradi
export function computeGridCoverageDetailed(
  polygon: any,
  track: TrackPoint[],
  options?: GridOptions,
): { cells: GridCell[]; coveredPct: number } {
  if (!polygon || track.length === 0) {
    return { cells: [], coveredPct: 0 }
  }

  let coords: number[][] | null = null
  try {
    if (polygon.type === 'Feature') coords = polygon.geometry?.coordinates?.[0]
    else if (polygon.type === 'Polygon') coords = polygon.coordinates?.[0]
    else if (polygon.type === 'FeatureCollection') {
      const f = polygon.features?.[0]
      if (f?.geometry?.type === 'Polygon') coords = f.geometry.coordinates[0]
    }
  } catch { return { cells: [], coveredPct: 0 } }
  if (!coords || coords.length < 3) return { cells: [], coveredPct: 0 }

  // Bounding box
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const [lon, lat] of coords) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }

  // Kataklarni settings dan olingan o'lchamda quramiz (default: 35m va 40m)
  const gridCellM = options?.gridCellM ?? 35
  const coverageRadiusM = options?.coverageRadiusM ?? 40
  const cellLat = gridCellM / 111000
  const midLat = (minLat + maxLat) / 2
  const cellLon = gridCellM / (111000 * Math.cos(midLat * Math.PI / 180))

  // Polygon ichidagi kataklar
  const cells: GridCell[] = []
  for (let lat = minLat + cellLat / 2; lat < maxLat; lat += cellLat) {
    for (let lon = minLon + cellLon / 2; lon < maxLon; lon += cellLon) {
      if (pointInPolygon(lat, lon, polygon)) {
        cells.push({ lat, lon, covered: false })
      }
    }
  }
  if (cells.length === 0) return { cells: [], coveredPct: 0 }

  const coverR = coverageRadiusM
  for (const pt of track) {
    for (const cell of cells) {
      if (!cell.covered && haversineM(pt.lat, pt.lon, cell.lat, cell.lon) <= coverR) {
        cell.covered = true
      }
    }
  }

  const coveredCount = cells.filter(c => c.covered).length
  const coveredPct = Math.round(coveredCount / cells.length * 100)
  return { cells, coveredPct }
}

function computeGridCoverage(polygon: any, track: TrackPoint[], options?: GridOptions): number {
  return computeGridCoverageDetailed(polygon, track, options).coveredPct
}

// Trek nuqtalarini thin qilish (max N ta, teng oraliqda)
function thinTrack(track: TrackPoint[], maxPoints: number): TrackPoint[] {
  if (track.length <= maxPoints) return track
  const step = track.length / maxPoints
  return Array.from({ length: maxPoints }, (_, i) => track[Math.floor(i * step)])
}

// Mashina uchun GPS credential va lookupKey ni topadi
export async function findCredForVehicle(vehicleId: string): Promise<{ credId: string; lookupKey: string } | null> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { registrationNumber: true, gpsUnitName: true, branchId: true },
  })
  if (!vehicle || !vehicle.branchId) return null

  const branch = await (prisma as any).branch.findUnique({
    where: { id: vehicle.branchId },
    select: { id: true, organizationId: true },
  })
  if (!branch) return null

  const orgId = branch.organizationId || branch.id
  const cred = await (prisma as any).gpsCredential.findFirst({
    where: {
      OR: [{ orgId }, { orgId: branch.id }],
      isActive: true,
    },
    select: { id: true },
  })
  if (!cred) return null

  return {
    credId: cred.id,
    lookupKey: (vehicle.gpsUnitName || vehicle.registrationNumber).trim().toUpperCase(),
  }
}

// Berilgan sana uchun UTC timestamp oralig'ini qaytaradi (UZT = UTC+5, 00:00-23:59 local)
export function getDayUtsRange(date: Date): { fromTs: number; toTs: number } {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  // UZT 00:00 = UTC 19:00 prev day. Ishchi soat 06:00-18:00 UZT = 01:00-13:00 UTC.
  // Butun kunni olish uchun: UTC prev day 19:00 to current day 18:59:59
  const fromTs = Math.floor(d.getTime() / 1000) - 5 * 3600  // 00:00 UZT in UTC
  const toTs = fromTs + 24 * 3600 - 1
  return { fromTs, toTs }
}

interface MonitorSettings {
  suspiciousSpeedKmh: number
  gridCellM?: number
  coverageRadiusM?: number
  minVisitSec?: number
}

// Bir mashina + MFY juftligini tahlil qiladi va natijani DB ga yozadi
async function analyzeServicePair(
  vehicleId: string,
  mfy: { id: string; polygon: any },
  track: TrackPoint[],
  date: Date,
  settings: MonitorSettings,
): Promise<void> {
  const dateOnly = new Date(date.toISOString().split('T')[0] + 'T00:00:00.000Z')

  if (!mfy.polygon) {
    await (prisma as any).thServiceTrip.upsert({
      where: { vehicleId_mfyId_date: { vehicleId, mfyId: mfy.id, date: dateOnly } },
      create: { vehicleId, mfyId: mfy.id, date: dateOnly, status: 'no_polygon' },
      update: { status: 'no_polygon', updatedAt: new Date() },
    })
    return
  }

  if (track.length === 0) {
    await (prisma as any).thServiceTrip.upsert({
      where: { vehicleId_mfyId_date: { vehicleId, mfyId: mfy.id, date: dateOnly } },
      create: { vehicleId, mfyId: mfy.id, date: dateOnly, status: 'no_gps' },
      update: { status: 'no_gps', updatedAt: new Date() },
    })
    return
  }

  let enteredAt: Date | null = null
  let exitedAt: Date | null = null
  let maxSpeed = 0
  let wasInside = false
  let firstInsideTs: number | null = null
  let lastInsideTs: number | null = null
  let totalInsideSec = 0

  for (const pt of track) {
    const inside = pointInPolygon(pt.lat, pt.lon, mfy.polygon)
    if (inside) {
      if (!wasInside) {
        wasInside = true
        firstInsideTs = pt.ts
        if (!enteredAt) enteredAt = new Date(pt.ts * 1000)
      }
      lastInsideTs = pt.ts
      exitedAt = new Date(pt.ts * 1000)
      if (pt.speed > maxSpeed) maxSpeed = pt.speed
    } else {
      if (wasInside && firstInsideTs !== null && lastInsideTs !== null) {
        totalInsideSec += lastInsideTs - firstInsideTs
      }
      wasInside = false
      firstInsideTs = null
    }
  }
  // Oxirgi segment (kun oxirigacha ichida qolgan)
  if (wasInside && firstInsideTs !== null && lastInsideTs !== null) {
    totalInsideSec += lastInsideTs - firstInsideTs
  }

  const timeInsideMin = totalInsideSec > 0 ? Math.max(1, Math.round(totalInsideSec / 60)) : null

  // minVisitSec: ichida yetarli vaqt o'tkazilmasa — not_visited sifatida hisoblanadi
  const minVisitSec = settings.minVisitSec ?? 30
  const effectivelyVisited = enteredAt !== null && totalInsideSec >= minVisitSec

  const status = effectivelyVisited ? 'visited' : 'not_visited'
  const suspicious = maxSpeed > settings.suspiciousSpeedKmh
  const gridOpts: GridOptions = { gridCellM: settings.gridCellM, coverageRadiusM: settings.coverageRadiusM }
  const coveragePct = computeGridCoverage(mfy.polygon, track, gridOpts)

  // Trek snapshot (xaritada ko'rsatish uchun, max 500 ta nuqta)
  const trackSnapshot = thinTrack(track, 500).map(p => ({ lat: p.lat, lon: p.lon, ts: p.ts }))

  await (prisma as any).thServiceTrip.upsert({
    where: { vehicleId_mfyId_date: { vehicleId, mfyId: mfy.id, date: dateOnly } },
    create: {
      vehicleId, mfyId: mfy.id, date: dateOnly, status,
      enteredAt: effectivelyVisited ? enteredAt : null,
      exitedAt: effectivelyVisited ? exitedAt : null,
      maxSpeedKmh: maxSpeed || null, suspicious, coveragePct,
      timeInsideMin, trackSnapshot,
    },
    update: {
      status,
      enteredAt: effectivelyVisited ? enteredAt : null,
      exitedAt: effectivelyVisited ? exitedAt : null,
      maxSpeedKmh: maxSpeed || null, suspicious, coveragePct,
      timeInsideMin, trackSnapshot,
      updatedAt: new Date(),
    },
  })
}

// Landfill tashriflari: har bir kirish/chiqish juftligini trip sifatida saqlaydi
async function analyzeLandfillTrips(
  vehicleId: string,
  landfills: Array<{ id: string; polygon: any }>,
  track: TrackPoint[],
  date: Date,
): Promise<void> {
  if (track.length === 0) return

  const dateOnly = new Date(date.toISOString().split('T')[0] + 'T00:00:00.000Z')

  for (const landfill of landfills) {
    if (!landfill.polygon) continue

    // Avvalgi triplarni o'chiramiz (qayta tahlil)
    await (prisma as any).thLandfillTrip.deleteMany({
      where: { vehicleId, landfillId: landfill.id, date: dateOnly },
    })

    let arrivedAt: Date | null = null
    let wasInside = false

    for (const pt of track) {
      const inside = pointInPolygon(pt.lat, pt.lon, landfill.polygon)

      if (inside && !wasInside) {
        // Kirish
        arrivedAt = new Date(pt.ts * 1000)
        wasInside = true
      } else if (!inside && wasInside) {
        // Chiqish — bir trip tugadi
        const leftAt = new Date(pt.ts * 1000)
        const durationMin = arrivedAt
          ? Math.round((leftAt.getTime() - arrivedAt.getTime()) / 60000)
          : null

        if (arrivedAt) {
          await (prisma as any).thLandfillTrip.create({
            data: {
              vehicleId,
              landfillId: landfill.id,
              date: dateOnly,
              arrivedAt,
              leftAt,
              durationMin,
            },
          })
        }
        arrivedAt = null
        wasInside = false
      }
    }

    // Agar kun oxirigacha poligon ichida qolgan bo'lsa
    if (wasInside && arrivedAt) {
      await (prisma as any).thLandfillTrip.create({
        data: {
          vehicleId,
          landfillId: landfill.id,
          date: dateOnly,
          arrivedAt,
          leftAt: null,
          durationMin: null,
        },
      })
    }
  }
}

// Konteyner tashriflari: har bir konteyner uchun mashina radiusga kirgan-chiqqan paytlarni hisoblaydi
async function analyzeContainerVisits(
  vehicleId: string,
  containers: Array<{ id: string; latitude: number; longitude: number; radiusM: number }>,
  track: TrackPoint[],
  date: Date,
): Promise<void> {
  if (track.length === 0 || containers.length === 0) return

  const dateOnly = new Date(date.toISOString().split('T')[0] + 'T00:00:00.000Z')

  // Eski visitlarni o'chirib qayta tahlil
  await (prisma as any).thContainerVisit.deleteMany({
    where: { vehicleId, date: dateOnly },
  })

  const visits: Array<{ vehicleId: string; containerId: string; date: Date; arrivedAt: Date; leftAt: Date | null; durationMin: number | null }> = []

  for (const c of containers) {
    let arrivedAt: Date | null = null
    let lastInsideTs = 0
    let consecutiveInside = 0
    let wasInside = false

    for (const pt of track) {
      const distM = haversineM(pt.lat, pt.lon, c.latitude, c.longitude)
      const inside = distM <= c.radiusM

      if (inside) {
        consecutiveInside++
        // Kamida 2 ta ketma-ket nuqta kerak — bitta nuqta "bounce" hisoblanmaydi
        if (consecutiveInside >= 2 && !wasInside) {
          arrivedAt = new Date(pt.ts * 1000)
          wasInside = true
        }
        lastInsideTs = pt.ts
      } else {
        consecutiveInside = 0
        if (wasInside && arrivedAt) {
          const leftAt = new Date(lastInsideTs * 1000)
          const durationSec = leftAt.getTime() / 1000 - arrivedAt.getTime() / 1000
          // 30 sek dan kam bo'lsa — tasodifiy o'tish, saqlamayamiz
          if (durationSec >= 30) {
            visits.push({
              vehicleId,
              containerId: c.id,
              date: dateOnly,
              arrivedAt,
              leftAt,
              durationMin: Math.max(1, Math.round(durationSec / 60)),
            })
          }
          arrivedAt = null
          wasInside = false
        }
      }
    }

    // Kun oxiriga qadar ichida qoldi
    if (wasInside && arrivedAt) {
      visits.push({
        vehicleId, containerId: c.id, date: dateOnly,
        arrivedAt, leftAt: null, durationMin: null,
      })
    }
  }

  if (visits.length > 0) {
    await (prisma as any).thContainerVisit.createMany({ data: visits })
  }
}

/**
 * Berilgan sana uchun barcha jadvallarni GPS orqali tahlil qiladi.
 * orgId — multi-tenant: faqat shu tashkilot mashinalari va ma'lumotlari ishlatiladi.
 */
export async function runDailyMonitoring(date: Date, orgId?: string | null): Promise<{
  analyzed: number
  noGps: number
  noPolygon: number
  errors: string[]
}> {
  const dateOnly = new Date(date.toISOString().split('T')[0] + 'T00:00:00.000Z')

  const jsDow = date.getDay()
  const uzDow = (jsDow + 6) % 7

  // Sozlamalarni yuklash (orgId yo'q bo'lsa default ishlatiladi)
  const settings = await loadThSettings(orgId ?? null)
  // Agar tashkilot avto-monitoringni o'chirib qo'ygan bo'lsa — qaytamiz
  // (Faqat orgId aniq bo'lsa tekshiriladi; global cron uchun har bir org ichida tekshirilishi kerak)
  if (orgId && settings.autoMonitorEnabled === false) {
    return { analyzed: 0, noGps: 0, noPolygon: 0, errors: [] }
  }

  // Bayram kuni tekshiruvi — bayram bo'lsa monitoring o'tkazib yuboriladi
  if (orgId) {
    const holiday = await (prisma as any).thHoliday.findFirst({
      where: { organizationId: orgId, date: dateOnly },
    }).catch(() => null)
    if (holiday) {
      console.log(`[thMonitor] Bayram kuni (${holiday.name}) — monitoring o'tkazib yuborildi: org=${orgId}`)
      return { analyzed: 0, noGps: 0, noPolygon: 0, errors: [] }
    }
  }

  // Tashkilot doirasidagi vehicleId larni topamiz
  let orgVehicleIdSet: Set<string> | null = null
  if (orgId) {
    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    })
    const branchIds = branches.map((b: any) => b.id)
    const vs = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds } },
      select: { id: true },
    })
    orgVehicleIdSet = new Set(vs.map(v => v.id))
  }

  const scheduleWhere: any = { dayOfWeek: { has: uzDow } }
  if (orgVehicleIdSet) scheduleWhere.vehicleId = { in: Array.from(orgVehicleIdSet) }

  const schedules = await (prisma as any).thSchedule.findMany({
    where: scheduleWhere,
    include: { mfy: { select: { id: true, polygon: true } } },
  })

  if (schedules.length === 0) return { analyzed: 0, noGps: 0, noPolygon: 0, errors: [] }

  const vehicleIds: string[] = [...new Set<string>(schedules.map((s: any) => s.vehicleId as string))]

  const landfillWhere: any = { polygon: { not: null } }
  if (orgId) landfillWhere.organizationId = orgId
  const landfills = await (prisma as any).thLandfill.findMany({
    where: landfillWhere,
    select: { id: true, polygon: true },
  })

  // Konteynerlarni bir martada yuklab olamiz (ko'pincha 100-1000 ta)
  const containerWhere: any = {}
  if (orgId) containerWhere.organizationId = orgId
  const containers = await (prisma as any).thContainer.findMany({
    where: containerWhere,
    select: { id: true, latitude: true, longitude: true, radiusM: true },
  })

  const { fromTs, toTs } = getDayUtsRange(dateOnly)

  // ── Ishchi soatlar filtrasi parametrlari (bir marta hisoblanadi) ──────────────
  const startH: number = (settings as any).monitorStartHour ?? 6
  const endH: number = (settings as any).monitorEndHour ?? 18
  const startUtc = ((startH - 5) + 24) % 24
  const endUtc = ((endH - 5) + 24) % 24

  // ── Batch GPS trek yuklash: 1 login + 1 getUnits + parallel track ─────────────
  // Per-vehicle getVehicleTrackPoints o'rniga getVehicleTracksBatch ishlatiladi.
  // 94 mashina × (login+getUnits+tracks) → 1 login + 1 getUnits + parallel tracks
  const trackMap = new Map<string, TrackPoint[]>()

  // Barcha mashina lookup keylarini BITTA DB so'rovda yuklaymiz
  const vehicleInfoList = await prisma.vehicle.findMany({
    where: { id: { in: vehicleIds } },
    select: { id: true, registrationNumber: true, gpsUnitName: true },
  }).catch(() => [] as { id: string; registrationNumber: string; gpsUnitName: string | null }[])

  if (vehicleInfoList.length > 0) {
    if (orgId) {
      // Eng keng tarqalgan holat: bitta org → bitta credential → batch
      const cred = await (prisma as any).gpsCredential.findFirst({
        where: { orgId, isActive: true },
        select: { id: true },
      }).catch(() => null)

      if (cred) {
        const inputs = vehicleInfoList.map(v => ({
          vehicleId: v.id,
          lookupKey: (v.gpsUnitName || v.registrationNumber).trim().toUpperCase(),
        }))
        const batchResult = await getVehicleTracksBatch(cred.id, inputs, fromTs, toTs, 6)
        for (const [vId, pts] of batchResult) trackMap.set(vId, pts)
      }
    } else {
      // Global run: credential bo'yicha guruhlab batch
      const vehicleMap = new Map(vehicleInfoList.map(v => [v.id, v]))
      const credToVehicles = new Map<string, Array<{ vehicleId: string; lookupKey: string }>>()

      for (const v of vehicleInfoList) {
        const credInfo = await findCredForVehicle(v.id)
        if (!credInfo) continue
        if (!credToVehicles.has(credInfo.credId)) credToVehicles.set(credInfo.credId, [])
        credToVehicles.get(credInfo.credId)!.push({
          vehicleId: v.id,
          lookupKey: (vehicleMap.get(v.id)?.gpsUnitName || vehicleMap.get(v.id)?.registrationNumber || '').trim().toUpperCase(),
        })
      }

      for (const [credId, inputs] of credToVehicles) {
        const batchResult = await getVehicleTracksBatch(credId, inputs, fromTs, toTs, 6)
        for (const [vId, pts] of batchResult) trackMap.set(vId, pts)
      }
    }
  }

  let analyzed = 0
  let noGps = 0
  let noPolygon = 0
  const errors: string[] = []

  const monitorSettings: MonitorSettings = {
    suspiciousSpeedKmh: settings.suspiciousSpeedKmh,
    gridCellM: (settings as any).gridCellM ?? 35,
    coverageRadiusM: (settings as any).coverageRadiusM ?? 40,
    minVisitSec: (settings as any).minVisitSec ?? 30,
  }

  for (const vehicleId of vehicleIds) {
    try {
      // Batch dan olingan trek; ishchi soatlar bo'yicha filtrlash
      let track: TrackPoint[] = trackMap.get(vehicleId) ?? []
      if (track.length > 0 && startUtc !== endUtc) {
        track = track.filter(pt => {
          const h = new Date(pt.ts * 1000).getUTCHours()
          return startUtc < endUtc
            ? h >= startUtc && h < endUtc
            : h >= startUtc || h < endUtc
        })
      }

      // Ushbu mashinaning barcha MFY jadvallarini tahlil qilish
      const vehicleSchedules = schedules.filter((s: any) => s.vehicleId === vehicleId)
      for (const sched of vehicleSchedules) {
        await analyzeServicePair(vehicleId, sched.mfy, track, dateOnly, monitorSettings)
        if (!sched.mfy.polygon) noPolygon++
        else if (track.length === 0) noGps++
        else analyzed++
      }

      // Landfill va konteyner tashriflarini tahlil qilish (faqat GPS trek bo'lsa)
      if (track.length > 0) {
        if (landfills.length > 0) await analyzeLandfillTrips(vehicleId, landfills, track, dateOnly)
        if (containers.length > 0) await analyzeContainerVisits(vehicleId, containers, track, dateOnly)
      }
    } catch (err: any) {
      errors.push(`vehicleId=${vehicleId}: ${err.message}`)
    }
  }

  return { analyzed, noGps, noPolygon, errors }
}
