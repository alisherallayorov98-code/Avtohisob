/**
 * Ish vaqti nazorati: har kuni mashina qachon ish boshladi va tugatdi.
 * GPS dan birinchi va oxirgi harakat nuqtasi olinadi, kutilgan vaqt bilan solishtiriladi.
 */

import { prisma } from '../../../lib/prisma'
import { loadThSettings } from '../controllers/settings'
import { getDayUtsRange, findCredForVehicle, TrackPoint } from './thMonitor'
import { getVehicleTrackPoints } from '../../../services/wialonService'

// "HH:MM" → shu kunning UTC timestamp (UZT = UTC+5)
function timeStrToUtcMs(dateStr: string, timeHHMM: string): number {
  const [h, m] = timeHHMM.split(':').map(Number)
  const uztH = isNaN(h) ? 8 : h
  const uztM = isNaN(m) ? 0 : m
  const utcH = ((uztH - 5) + 24) % 24
  const d = new Date(dateStr + 'T00:00:00.000Z')
  // Agar UZT soat < 5 bo'lsa bu oldingi kunning UTC si
  if (uztH < 5) d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(utcH, uztM, 0, 0)
  return d.getTime()
}

function computeStatus(
  actualMs: number | null,
  expectedMs: number,
  toleranceMin = 10,
): { status: 'early' | 'on_time' | 'late' | 'absent'; diffMin: number } {
  if (actualMs === null) return { status: 'absent', diffMin: 0 }
  const diffMin = Math.round((actualMs - expectedMs) / 60000)
  if (Math.abs(diffMin) <= toleranceMin) return { status: 'on_time', diffMin: 0 }
  if (diffMin < 0) return { status: 'early', diffMin: Math.abs(diffMin) }
  return { status: 'late', diffMin }
}

export interface WorkSessionResult {
  vehicleId: string
  date: string
  firstGpsAt: Date | null
  lastGpsAt: Date | null
  durationMin: number
  startStatus: 'early' | 'on_time' | 'late' | 'absent'
  endStatus: 'early' | 'on_time' | 'late' | null
  lateStartMin: number
  earlyEndMin: number
}

/**
 * Bitta mashina uchun bitta kun work session hisoblaydi.
 * GPS API dan trek olib, birinchi/oxirgi nuqtani topadi.
 */
export async function computeWorkSession(
  vehicleId: string,
  orgId: string,
  dateStr: string,         // "YYYY-MM-DD"
  workStartTime: string,   // "HH:MM" UZT
  workEndTime: string,     // "HH:MM" UZT
): Promise<WorkSessionResult> {
  const { fromTs, toTs } = getDayUtsRange(new Date(dateStr + 'T00:00:00.000Z'))

  const credInfo = await findCredForVehicle(vehicleId).catch(() => null)
  let points: TrackPoint[] = []
  if (credInfo) {
    points = await getVehicleTrackPoints(credInfo.credId, credInfo.lookupKey, fromTs, toTs)
      .catch(() => [] as TrackPoint[])
  }

  // Faqat harakatdagi nuqtalar (speed > 0 yoki kamida 2 ta nuqta orasida > 50m)
  const moving = points.filter(p => p.speed > 1)

  const firstGpsAt = moving.length > 0 ? new Date(moving[0].ts * 1000) : null
  const lastGpsAt  = moving.length > 0 ? new Date(moving[moving.length - 1].ts * 1000) : null
  const durationMin = firstGpsAt && lastGpsAt
    ? Math.round((lastGpsAt.getTime() - firstGpsAt.getTime()) / 60000)
    : 0

  const expectedStartMs = timeStrToUtcMs(dateStr, workStartTime)
  const expectedEndMs   = timeStrToUtcMs(dateStr, workEndTime)

  const startRes = computeStatus(firstGpsAt?.getTime() ?? null, expectedStartMs)
  const endRes   = firstGpsAt
    ? computeStatus(lastGpsAt?.getTime() ?? null, expectedEndMs)
    : { status: null as any, diffMin: 0 }

  return {
    vehicleId,
    date: dateStr,
    firstGpsAt,
    lastGpsAt,
    durationMin,
    startStatus: startRes.status,
    endStatus: firstGpsAt ? endRes.status : null,
    lateStartMin: startRes.status === 'late' ? startRes.diffMin : 0,
    earlyEndMin: endRes.status === 'early' ? endRes.diffMin : 0,
  }
}

/**
 * Tashkilot uchun barcha aktiv mashinalar bo'yicha bir kun work sessionlarini hisoblaydi va saqlaydi.
 * thMonitor scheduler tomonidan kuniga bir marta chaqiriladi.
 */
export async function runWorkSessionsForDate(orgId: string, dateStr: string): Promise<void> {
  const settings = await loadThSettings(orgId)
  if (!(settings as any).workTrackingEnabled) return

  const workStartTime: string = (settings as any).workStartTime ?? '08:00'
  const workEndTime: string   = (settings as any).workEndTime   ?? '18:00'

  // Shu tashkilotning aktiv mashinalarini olish (GPS bilan bog'langan)
  const vehicles = await prisma.vehicle.findMany({
    where: {
      branch: { organizationId: orgId },
      status: { not: 'inactive' },
      NOT: { gpsUnitName: null },
    },
    select: { id: true },
  })

  for (const v of vehicles) {
    try {
      const result = await computeWorkSession(v.id, orgId, dateStr, workStartTime, workEndTime)
      await (prisma as any).thWorkSession.upsert({
        where: { vehicleId_date: { vehicleId: v.id, date: new Date(dateStr + 'T00:00:00.000Z') } },
        create: {
          organizationId: orgId,
          vehicleId: v.id,
          date: new Date(dateStr + 'T00:00:00.000Z'),
          firstGpsAt: result.firstGpsAt,
          lastGpsAt: result.lastGpsAt,
          durationMin: result.durationMin,
          startStatus: result.startStatus,
          endStatus: result.endStatus,
          lateStartMin: result.lateStartMin,
          earlyEndMin: result.earlyEndMin,
        },
        update: {
          firstGpsAt: result.firstGpsAt,
          lastGpsAt: result.lastGpsAt,
          durationMin: result.durationMin,
          startStatus: result.startStatus,
          endStatus: result.endStatus,
          lateStartMin: result.lateStartMin,
          earlyEndMin: result.earlyEndMin,
        },
      })
    } catch (err: any) {
      console.error(`[ThWorkSession] ${v.id} ${dateStr} xatosi:`, err?.message)
    }
  }
}

/**
 * Tarixiy davr uchun work sessionlarni qayta hisoblaydi (backfill).
 * Admin tomonidan chaqiriladi, o'tmishdagi sanalar uchun GPS dan ma'lumot tortadi.
 */
export async function backfillWorkSessions(
  orgId: string,
  fromDate: string,
  toDate: string,
  vehicleIds?: string[],
): Promise<{ processed: number; errors: number }> {
  const settings = await loadThSettings(orgId)
  const workStartTime: string = (settings as any).workStartTime ?? '08:00'
  const workEndTime: string   = (settings as any).workEndTime   ?? '18:00'

  let vehicles: { id: string }[]
  if (vehicleIds && vehicleIds.length > 0) {
    vehicles = vehicleIds.map(id => ({ id }))
  } else {
    vehicles = await prisma.vehicle.findMany({
      where: {
        branch: { organizationId: orgId },
        status: { not: 'inactive' },
        NOT: { gpsUnitName: null },
      },
      select: { id: true },
    })
  }

  const dates: string[] = []
  const cur = new Date(fromDate + 'T00:00:00.000Z')
  const end = new Date(toDate   + 'T00:00:00.000Z')
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0])
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  let processed = 0
  let errors = 0

  for (const dateStr of dates) {
    for (const v of vehicles) {
      try {
        const result = await computeWorkSession(v.id, orgId, dateStr, workStartTime, workEndTime)
        await (prisma as any).thWorkSession.upsert({
          where: { vehicleId_date: { vehicleId: v.id, date: new Date(dateStr + 'T00:00:00.000Z') } },
          create: {
            organizationId: orgId,
            vehicleId: v.id,
            date: new Date(dateStr + 'T00:00:00.000Z'),
            firstGpsAt: result.firstGpsAt,
            lastGpsAt: result.lastGpsAt,
            durationMin: result.durationMin,
            startStatus: result.startStatus,
            endStatus: result.endStatus,
            lateStartMin: result.lateStartMin,
            earlyEndMin: result.earlyEndMin,
          },
          update: {
            firstGpsAt: result.firstGpsAt,
            lastGpsAt: result.lastGpsAt,
            durationMin: result.durationMin,
            startStatus: result.startStatus,
            endStatus: result.endStatus,
            lateStartMin: result.lateStartMin,
            earlyEndMin: result.earlyEndMin,
          },
        })
        processed++
      } catch {
        errors++
      }
    }
  }

  return { processed, errors }
}
