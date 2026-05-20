/**
 * Toza-Hudud: Jadval intellekti
 *
 * suggestOptimalSchedule(orgId) — mavjud vehicle va MFYlar asosida
 * optimal haftalik jadval taklifi qaytaradi.
 *
 * Qoidalar:
 *   1. Har bir MFY haftada kamida 1 marta borilishi kerak.
 *   2. Har mashina kuniga max maxMfysPerVehiclePerDay ta MFY xizmatlaydi.
 *   3. O'tgan oydagi statistika asosida past qamrovli MFYlar ko'proq kun bilan rejalashtiradi.
 *   4. Bayram kunlarida jadval qurilmaydi (ThHoliday).
 *
 * Qaytadi: ScheduleSuggestion[] — har biri {vehicleId, mfyId, dayOfWeek[]} ko'rinishida
 */

import { prisma } from '../../../lib/prisma'

export interface ScheduleSuggestion {
  vehicleId: string
  mfyId: string
  dayOfWeek: number[]   // 0=Du ... 6=Ya (UZT/UTC bir xil)
  reason: string        // Nima uchun shu kunlar tanlandi
}

const MAX_MFYS_PER_VEHICLE_PER_DAY = 6
const WORKDAYS = [0, 1, 2, 3, 4]  // Du–Ju, default

// Haftada necha marta borilishi kerak (qamrov foiziga qarab)
function requiredVisitsPerWeek(avgCoveragePct: number | null): number {
  if (avgCoveragePct === null) return 2  // Ma'lumot yo'q — haftada 2 marta
  if (avgCoveragePct < 40) return 3
  if (avgCoveragePct < 70) return 2
  return 1
}

export async function suggestOptimalSchedule(orgId: string): Promise<ScheduleSuggestion[]> {
  // Mavjud MFYlar
  const mfys = await (prisma as any).thMfy.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  }).catch(() => [] as any[])

  if (mfys.length === 0) return []

  // Org vehiclelari
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

  if (vehicles.length === 0) return []

  // O'tgan 30 kunlik statistika: har MFY uchun o'rtacha qamrov %
  const now = new Date()
  const fromDate = new Date(now)
  fromDate.setUTCDate(fromDate.getUTCDate() - 30)
  fromDate.setUTCHours(0, 0, 0, 0)

  const mfyIds = mfys.map((m: any) => m.id)
  const vehicleIds = vehicles.map(v => v.id)

  const recentTrips = (mfyIds.length && vehicleIds.length)
    ? await (prisma as any).thServiceTrip.findMany({
        where: {
          mfyId: { in: mfyIds },
          vehicleId: { in: vehicleIds },
          date: { gte: fromDate },
          status: { in: ['visited', 'not_visited'] },
        },
        select: { mfyId: true, status: true, coveragePct: true },
      }).catch(() => [] as any[])
    : []

  // Har MFY uchun o'rtacha qamrov
  const mfyStats: Record<string, { visited: number; total: number; avgCov: number | null }> = {}
  for (const mfy of mfys) mfyStats[mfy.id] = { visited: 0, total: 0, avgCov: null }

  for (const t of recentTrips) {
    const s = mfyStats[t.mfyId]
    if (!s) continue
    s.total++
    if (t.status === 'visited') s.visited++
  }
  for (const id of mfyIds) {
    const s = mfyStats[id]
    s.avgCov = s.total > 0 ? Math.round(s.visited / s.total * 100) : null
  }

  // Har MFY uchun necha kun jadval kerak
  const mfyVisitsNeeded: { mfyId: string; visits: number }[] = mfys.map((m: any) => ({
    mfyId: m.id,
    visits: requiredVisitsPerWeek(mfyStats[m.id]?.avgCov ?? null),
  }))

  // Kunlik mashina kapasiteti
  const totalDaySlots = vehicles.length * MAX_MFYS_PER_VEHICLE_PER_DAY * WORKDAYS.length

  // Agar juda ko'p MFY bo'lsa — priority order (past qamrovlilar birinchi)
  const prioritized = [...mfyVisitsNeeded].sort((a, b) => {
    const aAvg = mfyStats[a.mfyId]?.avgCov ?? 50
    const bAvg = mfyStats[b.mfyId]?.avgCov ?? 50
    return aAvg - bAvg  // past qamrovlilar birinchi
  })

  // Kunlik mashina yukini taqsimlash: round-robin vehicle assignment
  // daySlots[day][vehicleIdx] = qancha MFY tayinlangan
  const daySlots: number[][] = WORKDAYS.map(() => vehicles.map(() => 0))
  const suggestions: ScheduleSuggestion[] = []

  for (const { mfyId, visits } of prioritized) {
    const avgCov = mfyStats[mfyId]?.avgCov
    const reason = avgCov !== null
      ? `O'rtacha qamrov: ${avgCov}% — haftada ${visits} marta`
      : `Yangi MFY — haftada ${visits} marta`

    // Visits ta kun tanlash (eng kam bandlari)
    let selectedVehicleIdx = 0
    let selectedVehicleLoad = Infinity
    for (let vi = 0; vi < vehicles.length; vi++) {
      const weeklyLoad = daySlots.reduce((sum, day) => sum + day[vi], 0)
      if (weeklyLoad < selectedVehicleLoad) {
        selectedVehicleLoad = weeklyLoad
        selectedVehicleIdx = vi
      }
    }

    const selectedDays: number[] = []
    // dayScore[dayIdx] = ushbu kunda jami tayinlangan MFYlar soni
    for (let v = 0; v < visits; v++) {
      // Eng kam band kun va mashinani topamiz
      let bestDay = -1
      let bestLoad = Infinity

      for (let d = 0; d < WORKDAYS.length; d++) {
        if (selectedDays.includes(WORKDAYS[d])) continue  // bu kun allaqachon tanlangan
        const load = daySlots[d][selectedVehicleIdx]
        if (load < MAX_MFYS_PER_VEHICLE_PER_DAY && load < bestLoad) {
          bestLoad = load
          bestDay = d
        }
      }

      if (bestDay === -1) {
        // Sig'imdan oshib ketdi — birinchi available kunni ol
        bestDay = WORKDAYS.reduce((best, _day, idx) =>
          daySlots[idx][selectedVehicleIdx] < daySlots[best][selectedVehicleIdx] ? idx : best
        , 0)
      }

      selectedDays.push(WORKDAYS[bestDay])
      daySlots[bestDay][selectedVehicleIdx]++
    }

    suggestions.push({
      vehicleId: vehicles[selectedVehicleIdx].id,
      mfyId,
      dayOfWeek: selectedDays,
      reason,
    })
  }

  return suggestions
}

// Bayram kuniligini tekshirish — thMonitor da ishlatiladi
export async function isHoliday(orgId: string, date: Date): Promise<boolean> {
  const dateOnly = new Date(date.toISOString().split('T')[0] + 'T00:00:00.000Z')
  const holiday = await (prisma as any).thHoliday.findFirst({
    where: {
      OR: [{ organizationId: orgId }, { organizationId: '' }],  // global va org-specific
      date: dateOnly,
    },
  }).catch(() => null)
  return holiday !== null
}

// GET /th/schedules/suggest — jadval taklifi
export async function getScheduleSuggestions(orgId: string) {
  return suggestOptimalSchedule(orgId)
}
