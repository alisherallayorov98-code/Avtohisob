/**
 * Toza-Hudud: Haydovchi (mashina) statistikasi
 *
 * Har hafta va oy uchun qamrov foizi, streak va reyting hisoblanadi.
 * updateAllDriverStats() — 20:00 UZT monitoring tugagach va dushanba 09:00 UZT da chaqiriladi.
 */

import { prisma } from '../../../lib/prisma'

export interface DriverStatRow {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  weekCoveragePct: number
  monthCoveragePct: number
  streak: number
  weekVisited: number
  weekTotal: number
  rank: number
}

// ── Sana oralig'lari ──────────────────────────────────────────────────────────

function getWeekBounds(today: Date): { weekStart: Date; weekEnd: Date } {
  const uzDow = (today.getUTCDay() + 6) % 7  // 0=Du..6=Ya
  const weekStart = new Date(today)
  weekStart.setUTCDate(today.getUTCDate() - uzDow)
  weekStart.setUTCHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7)
  return { weekStart, weekEnd }
}

function getMonthBounds(today: Date): { monthStart: Date; monthEnd: Date } {
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
  return { monthStart, monthEnd }
}

// ── Streak hisoblash (bitta query) ────────────────────────────────────────────

async function computeStreak(vehicleId: string, today: Date): Promise<number> {
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setUTCDate(today.getUTCDate() - 30)
  thirtyDaysAgo.setUTCHours(0, 0, 0, 0)

  const trips = await (prisma as any).thServiceTrip.findMany({
    where: { vehicleId, date: { gte: thirtyDaysAgo, lt: today } },
    select: { date: true, status: true },
  }).catch(() => [] as any[])

  // Sana bo'yicha guruhlaymiz
  const byDate = new Map<string, { visited: number; total: number }>()
  for (const t of trips) {
    const key = new Date(t.date).toISOString().split('T')[0]
    const entry = byDate.get(key) ?? { visited: 0, total: 0 }
    entry.total++
    if (t.status === 'visited') entry.visited++
    byDate.set(key, entry)
  }

  // Kechadan boshlab orqaga ketma-ket 80%+ kunlarni sanash.
  // Jadvalsiz kunlar o'tkazib yuboriladi, lekin 7+ ketma-ket jadvalsiz kun streak ni uzadi.
  let streak = 0
  let gapDays = 0  // Ketma-ket jadvalsiz kunlar soni
  for (let i = 1; i <= 30; i++) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().split('T')[0]
    const entry = byDate.get(key)
    if (!entry || entry.total === 0) {
      gapDays++
      if (gapDays > 7) break  // Uzoq dam olish yoki ma'lumot bo'shliq — streak uziladi
      continue
    }
    gapDays = 0
    const pct = Math.round(entry.visited / entry.total * 100)
    if (pct >= 80) streak++
    else break
  }
  return streak
}

// ── Tashkilot uchun barcha haydovchilar statistikasini yangilash ──────────────

export async function updateAllDriverStats(orgId: string): Promise<void> {
  const branches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  const branchIds = branches.map((b: any) => b.id)
  if (branchIds.length === 0) return

  const vIds = await prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true },
  }).then(vs => vs.map(v => v.id)).catch(() => [] as string[])
  if (vIds.length === 0) return

  // Faqat jadvalda bor mashinalar
  const scheduledRows = await (prisma as any).thSchedule.findMany({
    where: { vehicleId: { in: vIds } },
    select: { vehicleId: true },
    distinct: ['vehicleId'],
  }).catch(() => [] as any[])
  const scheduledVIds: string[] = scheduledRows.map((s: any) => s.vehicleId)
  if (scheduledVIds.length === 0) return

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)  // bugun 00:00 UTC
  const { weekStart, weekEnd } = getWeekBounds(today)
  const { monthStart, monthEnd } = getMonthBounds(today)

  const rankList: Array<{ vehicleId: string; weekCoveragePct: number }> = []

  for (const vehicleId of scheduledVIds) {
    try {
      const [weekVisited, weekTotal, monthVisited, monthTotal] = await Promise.all([
        (prisma as any).thServiceTrip.count({
          where: { vehicleId, date: { gte: weekStart, lt: weekEnd }, status: 'visited' },
        }),
        (prisma as any).thServiceTrip.count({
          where: { vehicleId, date: { gte: weekStart, lt: weekEnd } },
        }),
        (prisma as any).thServiceTrip.count({
          where: { vehicleId, date: { gte: monthStart, lt: monthEnd }, status: 'visited' },
        }),
        (prisma as any).thServiceTrip.count({
          where: { vehicleId, date: { gte: monthStart, lt: monthEnd } },
        }),
      ])

      const weekCoveragePct = weekTotal > 0 ? Math.round(weekVisited / weekTotal * 100) : 0
      const monthCoveragePct = monthTotal > 0 ? Math.round(monthVisited / monthTotal * 100) : 0
      const streak = await computeStreak(vehicleId, today)

      rankList.push({ vehicleId, weekCoveragePct })

      await (prisma as any).thDriverStat.upsert({
        where: { vehicleId },
        create: {
          vehicleId, weekCoveragePct, monthCoveragePct,
          streak, weekVisited, weekTotal,
        },
        update: {
          weekCoveragePct, monthCoveragePct,
          streak, weekVisited, weekTotal,
          updatedAt: new Date(),
        },
      })
    } catch (e: any) {
      console.error(`[ThDriverStats] vehicleId=${vehicleId}:`, e?.message)
    }
  }

  // Reyting: haftalik qamrov bo'yicha saralash
  rankList.sort((a, b) => b.weekCoveragePct - a.weekCoveragePct)
  for (let i = 0; i < rankList.length; i++) {
    await (prisma as any).thDriverStat.update({
      where: { vehicleId: rankList[i].vehicleId },
      data: { rank: i + 1 },
    }).catch(() => null)
  }

  console.log(`[ThDriverStats] Updated ${rankList.length} vehicles for org=${orgId}`)
}

// ── Tashkilot uchun reytingni olish (dashboard va Telegram uchun) ─────────────

export async function getDriverRankings(orgId: string): Promise<DriverStatRow[]> {
  const branches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  const branchIds = branches.map((b: any) => b.id)

  const vehicles = await prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true, registrationNumber: true, brand: true, model: true },
  }).catch(() => [] as any[])

  const vehicleMap = new Map(vehicles.map((v: any) => [v.id, v]))
  const vIds = vehicles.map((v: any) => v.id)
  if (vIds.length === 0) return []

  const stats = await (prisma as any).thDriverStat.findMany({
    where: { vehicleId: { in: vIds } },
    orderBy: { rank: 'asc' },
  }).catch(() => [] as any[])

  return stats.map((s: any) => {
    const v = vehicleMap.get(s.vehicleId) as any
    return {
      vehicleId: s.vehicleId,
      registrationNumber: v?.registrationNumber ?? '—',
      brand: v?.brand ?? '',
      model: v?.model ?? '',
      weekCoveragePct: s.weekCoveragePct,
      monthCoveragePct: s.monthCoveragePct,
      streak: s.streak,
      weekVisited: s.weekVisited,
      weekTotal: s.weekTotal,
      rank: s.rank ?? 0,
    }
  })
}

// ── O'tgan haftaning statistikasini hisoblash (haftalik Telegram uchun) ────────

export async function getLastWeekStats(orgId: string): Promise<{
  avgCoveragePct: number
  topDrivers: DriverStatRow[]
  bottomDrivers: DriverStatRow[]
  totalVehicles: number
}> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // O'tgan hafta (dushanba → yakshanba)
  const uzDow = (today.getUTCDay() + 6) % 7
  const thisMonday = new Date(today)
  thisMonday.setUTCDate(today.getUTCDate() - uzDow)

  const lastMonday = new Date(thisMonday)
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7)
  const lastSunday = new Date(thisMonday)  // thisMonday = o'tgan haftaning yakshanbasidan keyingi kun

  const branches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  const branchIds = branches.map((b: any) => b.id)

  const vehicles = await prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true, registrationNumber: true, brand: true, model: true },
  }).catch(() => [] as any[])

  const vehicleMap = new Map(vehicles.map((v: any) => [v.id, v]))
  const vIds = vehicles.map((v: any) => v.id)
  if (vIds.length === 0) return { avgCoveragePct: 0, topDrivers: [], bottomDrivers: [], totalVehicles: 0 }

  // O'tgan hafta trip'larini olamiz
  const trips = await (prisma as any).thServiceTrip.findMany({
    where: { vehicleId: { in: vIds }, date: { gte: lastMonday, lt: lastSunday } },
    select: { vehicleId: true, status: true },
  }).catch(() => [] as any[])

  // Vehicle bo'yicha guruhlaymiz
  const perVehicle = new Map<string, { visited: number; total: number }>()
  for (const t of trips) {
    const entry = perVehicle.get(t.vehicleId) ?? { visited: 0, total: 0 }
    entry.total++
    if (t.status === 'visited') entry.visited++
    perVehicle.set(t.vehicleId, entry)
  }

  const rows: DriverStatRow[] = []
  let rankCounter = 0

  for (const [vehicleId, counts] of perVehicle) {
    if (counts.total === 0) continue
    const v = vehicleMap.get(vehicleId) as any
    rankCounter++
    rows.push({
      vehicleId,
      registrationNumber: v?.registrationNumber ?? '—',
      brand: v?.brand ?? '',
      model: v?.model ?? '',
      weekCoveragePct: Math.round(counts.visited / counts.total * 100),
      monthCoveragePct: 0,
      streak: 0,
      weekVisited: counts.visited,
      weekTotal: counts.total,
      rank: rankCounter,
    })
  }

  rows.sort((a, b) => b.weekCoveragePct - a.weekCoveragePct)
  rows.forEach((r, i) => { r.rank = i + 1 })

  const avg = rows.length > 0
    ? Math.round(rows.reduce((s, r) => s + r.weekCoveragePct, 0) / rows.length)
    : 0

  return {
    avgCoveragePct: avg,
    topDrivers: rows.slice(0, 3),
    bottomDrivers: rows.filter(r => r.weekCoveragePct < 70).slice(-3).reverse(),
    totalVehicles: rows.length,
  }
}
