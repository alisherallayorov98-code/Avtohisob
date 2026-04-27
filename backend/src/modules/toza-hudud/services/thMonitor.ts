import { prisma } from '../../../lib/prisma'
import { getVehicleTrackPoints } from '../../../services/wialonService'
import { loadThSettings } from '../controllers/settings'

interface TrackPoint {
  lat: number
  lon: number
  speed: number
  ts: number
}

// Ray casting algorithm: nuqta ko'pburchak ichida yoki tashqarida ekanligini aniqlaydi
function pointInPolygon(lat: number, lon: number, geojson: any): boolean {
  let coords: number[][] | null = null

  try {
    if (geojson.type === 'Feature') {
      coords = geojson.geometry?.coordinates?.[0]
    } else if (geojson.type === 'Polygon') {
      coords = geojson.coordinates?.[0]
    } else if (geojson.type === 'FeatureCollection') {
      const f = geojson.features?.[0]
      if (f?.geometry?.type === 'Polygon') coords = f.geometry.coordinates[0]
    }
  } catch {
    return false
  }

  if (!coords || coords.length < 3) return false

  // GeoJSON koordinatalari: [lon, lat]
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

// Mashina uchun GPS credential va lookupKey ni topadi
async function findCredForVehicle(vehicleId: string): Promise<{ credId: string; lookupKey: string } | null> {
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
function getDayUtsRange(date: Date): { fromTs: number; toTs: number } {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  // UZT 00:00 = UTC 19:00 prev day. Ishchi soat 06:00-18:00 UZT = 01:00-13:00 UTC.
  // Butun kunni olish uchun: UTC prev day 19:00 to current day 18:59:59
  const fromTs = Math.floor(d.getTime() / 1000) - 5 * 3600  // 00:00 UZT in UTC
  const toTs = fromTs + 24 * 3600 - 1
  return { fromTs, toTs }
}

// Bir mashina + MFY juftligini tahlil qiladi va natijani DB ga yozadi
async function analyzeServicePair(
  vehicleId: string,
  mfy: { id: string; polygon: any },
  track: TrackPoint[],
  date: Date,
  suspiciousSpeedKmh: number,
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

  for (const pt of track) {
    const inside = pointInPolygon(pt.lat, pt.lon, mfy.polygon)
    if (inside) {
      if (!wasInside) {
        wasInside = true
        if (!enteredAt) enteredAt = new Date(pt.ts * 1000)
      }
      exitedAt = new Date(pt.ts * 1000)
      if (pt.speed > maxSpeed) maxSpeed = pt.speed
    } else {
      wasInside = false
    }
  }

  const status = enteredAt ? 'visited' : 'not_visited'
  const suspicious = maxSpeed > suspiciousSpeedKmh // tezligi yuqori — chiqindilar to'planmagan bo'lishi mumkin

  await (prisma as any).thServiceTrip.upsert({
    where: { vehicleId_mfyId_date: { vehicleId, mfyId: mfy.id, date: dateOnly } },
    create: { vehicleId, mfyId: mfy.id, date: dateOnly, status, enteredAt, exitedAt, maxSpeedKmh: maxSpeed || null, suspicious },
    update: { status, enteredAt, exitedAt, maxSpeedKmh: maxSpeed || null, suspicious, updatedAt: new Date() },
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

  const { fromTs, toTs } = getDayUtsRange(dateOnly)

  let analyzed = 0
  let noGps = 0
  let noPolygon = 0
  const errors: string[] = []

  for (const vehicleId of vehicleIds) {
    try {
      // GPS trek olish
      const credInfo = await findCredForVehicle(vehicleId)
      let track: TrackPoint[] = []

      if (credInfo) {
        track = await getVehicleTrackPoints(credInfo.credId, credInfo.lookupKey, fromTs, toTs)
      }

      // Ushbu mashinaning barcha MFY jadvallarini tahlil qilish
      const vehicleSchedules = schedules.filter((s: any) => s.vehicleId === vehicleId)
      for (const sched of vehicleSchedules) {
        await analyzeServicePair(vehicleId, sched.mfy, track, dateOnly, settings.suspiciousSpeedKmh)
        if (!sched.mfy.polygon) noPolygon++
        else if (track.length === 0) noGps++
        else analyzed++
      }

      // Landfill tashriflarini tahlil qilish (faqat GPS trek bo'lsa)
      if (track.length > 0 && landfills.length > 0) {
        await analyzeLandfillTrips(vehicleId, landfills, track, dateOnly)
      }
    } catch (err: any) {
      errors.push(`vehicleId=${vehicleId}: ${err.message}`)
    }
  }

  return { analyzed, noGps, noPolygon, errors }
}
