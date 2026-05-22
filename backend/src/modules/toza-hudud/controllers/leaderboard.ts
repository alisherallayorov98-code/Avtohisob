/**
 * Toza-Hudud: Haydovchi reyting tizimi
 * GET /th/driver/leaderboard?month=2026-05  — oylik ball + davomat
 * GET /th/driver/leaderboard/excel?month=   — Excel eksport
 */

import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

// ── Ichki hisob-kitob ─────────────────────────────────────────────────────────

async function buildLeaderboard(orgId: string, targetMonth: string) {
  const [year, mon] = targetMonth.split('-').map(Number)
  const startDate = new Date(Date.UTC(year, mon - 1, 1))
  const endDate = new Date(Date.UTC(year, mon, 1))

  const branches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  const branchIds = [orgId, ...branches.map((b: any) => b.id)]

  const vehicles = await prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true, registrationNumber: true, brand: true, model: true },
  })
  const vIds = vehicles.map(v => v.id)
  if (vIds.length === 0) return { month: targetMonth, drivers: [] }

  const trips = await (prisma as any).thServiceTrip.findMany({
    where: { vehicleId: { in: vIds }, date: { gte: startDate, lt: endDate } },
    select: { vehicleId: true, date: true, status: true, coveragePct: true },
  })

  const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
  const grouped = new Map<string, any[]>()
  for (const t of trips) {
    if (!grouped.has(t.vehicleId)) grouped.set(t.vehicleId, [])
    grouped.get(t.vehicleId)!.push(t)
  }

  const today = new Date()

  const drivers = vehicles.map(v => {
    const vTrips = grouped.get(v.id) || []

    // Kunlar bo'yicha guruhlash
    const byDate = new Map<string, { visited: number; notVisited: number }>()
    for (const t of vTrips) {
      const d = new Date(t.date).toISOString().slice(0, 10)
      if (!byDate.has(d)) byDate.set(d, { visited: 0, notVisited: 0 })
      const day = byDate.get(d)!
      if (t.status === 'visited') day.visited++
      else if (t.status === 'not_visited') day.notVisited++
    }

    const workingDays = byDate.size
    const visitedDays = [...byDate.values()].filter(d => d.visited > 0).length
    const attendancePct = workingDays > 0 ? Math.round(visitedDays / workingDays * 100) : 0

    // Kunlik qamrov foizlari
    const dailyCoverages = [...byDate.values()].map(d => {
      const total = d.visited + d.notVisited
      return total > 0 ? d.visited / total * 100 : null
    }).filter(x => x !== null) as number[]

    const coveragePct = dailyCoverages.length > 0
      ? Math.round(dailyCoverages.reduce((a, b) => a + b, 0) / dailyCoverages.length)
      : 0

    // Streak: bugundan orqaga ketma-ket tashrif kunlari
    let streak = 0
    const checkDate = new Date(today)
    for (let i = 0; i < 60; i++) {
      const d = checkDate.toISOString().slice(0, 10)
      if (d < startDate.toISOString().slice(0, 10)) break
      const dayData = byDate.get(d)
      if (dayData && dayData.visited > 0) streak++
      else if (dayData && dayData.visited === 0) break
      checkDate.setUTCDate(checkDate.getUTCDate() - 1)
    }

    const score = Math.round(
      coveragePct * 0.5 +
      attendancePct * 0.3 +
      Math.min(streak, 14) / 14 * 100 * 0.2
    )

    return {
      vehicleId: v.id,
      registrationNumber: v.registrationNumber,
      brand: (v as any).brand || '',
      model: (v as any).model || '',
      score,
      coveragePct,
      visitedDays,
      workingDays,
      attendancePct,
      streak,
      avgCoveragePerVisit: coveragePct,
      badge: null as string | null,
    }
  }).sort((a, b) => b.score - a.score || b.coveragePct - a.coveragePct)

  // Badge belgilash
  const total = drivers.length
  const ranked = drivers.map((d, i) => {
    const rank = i + 1
    let badge: string | null = null
    if (rank === 1) badge = 'gold'
    else if (rank === 2) badge = 'silver'
    else if (rank === 3) badge = 'bronze'
    return { ...d, rank, badge }
  })

  return { month: targetMonth, drivers: ranked }
}

// ── GET /th/driver/leaderboard ────────────────────────────────────────────────

export async function getDriverLeaderboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
    const data = await buildLeaderboard(orgId, month)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

// ── GET /th/driver/leaderboard/excel ─────────────────────────────────────────

export async function exportLeaderboardExcel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
    const { drivers } = await buildLeaderboard(orgId, month)

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(`Reyting ${month}`)

    ws.columns = [
      { header: '#', key: 'rank', width: 5 },
      { header: 'Mashina', key: 'reg', width: 18 },
      { header: 'Marka/Model', key: 'model', width: 18 },
      { header: 'Ball', key: 'score', width: 8 },
      { header: 'Qamrov %', key: 'coverage', width: 12 },
      { header: 'Davomat %', key: 'attendance', width: 12 },
      { header: 'Tashrif kunlari', key: 'visitedDays', width: 16 },
      { header: 'Ish kunlari', key: 'workingDays', width: 12 },
      { header: 'Streak', key: 'streak', width: 10 },
      { header: 'Unvon', key: 'badge', width: 10 },
    ]

    // Header style
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } }
    ws.getRow(1).height = 22

    const badgeLabel: Record<string, string> = { gold: '🥇 Oltin', silver: '🥈 Kumush', bronze: '🥉 Bronza' }
    const badgeColor: Record<string, string> = { gold: 'FFFEF9C3', silver: 'FFF1F5F9', bronze: 'FFFFF7ED' }

    for (const d of drivers) {
      const row = ws.addRow({
        rank: d.rank,
        reg: d.registrationNumber,
        model: `${d.brand} ${d.model}`.trim(),
        score: d.score,
        coverage: `${d.coveragePct}%`,
        attendance: `${d.attendancePct}%`,
        visitedDays: d.visitedDays,
        workingDays: d.workingDays,
        streak: d.streak,
        badge: d.badge ? badgeLabel[d.badge] || '' : '',
      })

      // Score rangi
      const scoreColor = d.score >= 80 ? 'FFD1FAE5' : d.score >= 50 ? 'FFFEF3C7' : 'FFFEE2E2'
      row.getCell('score').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: scoreColor } }
      if (d.badge) {
        row.getCell('badge').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: badgeColor[d.badge] || 'FFFFFFFF' } }
      }
    }

    ws.autoFilter = { from: 'A1', to: 'J1' }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="leaderboard-${month}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
