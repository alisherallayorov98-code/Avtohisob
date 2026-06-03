import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { successResponse } from '../../../types'
import { AppError } from '../../../middleware/errorHandler'
import { backfillWorkSessions } from '../services/thWorkSession'
import ExcelJS from 'exceljs'

function getOrgId(req: Request): string {
  const user = (req as any).user
  return user?.organizationId ?? user?.branchId ?? ''
}

function fmtTime(d: Date | null): string | null {
  if (!d) return null
  return d.toLocaleTimeString('uz-UZ', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' })
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric' })
}

const STATUS_LABEL: Record<string, string> = {
  early: 'Erta keldi', on_time: "O'z vaqtida", late: 'Kech keldi', absent: 'Kelmadi',
}
const END_STATUS_LABEL: Record<string, string> = {
  early: 'Erta ketdi', on_time: "O'z vaqtida ketdi", late: 'Kech ketdi',
}

// vehicleId lardan vehicle ma'lumotlarini bir queryda oladi
async function getVehicleMap(vehicleIds: string[]): Promise<Map<string, { registrationNumber: string; brand: string; model: string }>> {
  if (vehicleIds.length === 0) return new Map()
  const vehicles = await prisma.vehicle.findMany({
    where: { id: { in: vehicleIds } },
    select: { id: true, registrationNumber: true, brand: true, model: true },
  })
  return new Map(vehicles.map(v => [v.id, { registrationNumber: v.registrationNumber, brand: v.brand, model: v.model }]))
}

/**
 * GET /th/work-sessions — Kundalik ro'yxat
 */
export async function getWorkSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = getOrgId(req)
    const { from, to, vehicleId } = req.query as Record<string, string>
    if (!from || !to) throw new AppError('from va to sana talab qilinadi', 400)

    const fromDate = new Date(from + 'T00:00:00.000Z')
    const toDate   = new Date(to   + 'T00:00:00.000Z')
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) throw new AppError('Sana formati noto\'g\'ri', 400)
    if ((toDate.getTime() - fromDate.getTime()) / 86400000 > 180) throw new AppError('Maksimal davr 180 kun', 400)

    const where: any = { organizationId: orgId, date: { gte: fromDate, lte: toDate } }
    if (vehicleId) where.vehicleId = vehicleId

    const sessions = await (prisma as any).thWorkSession.findMany({
      where,
      orderBy: [{ date: 'desc' }, { vehicleId: 'asc' }],
    })

    const vehicleMap = await getVehicleMap([...new Set<string>(sessions.map((s: any) => s.vehicleId as string))])

    const rows = sessions.map((s: any) => ({
      id: s.id,
      date: s.date,
      dateLabel: fmtDate(s.date),
      vehicle: vehicleMap.get(s.vehicleId) ?? { registrationNumber: '—', brand: '', model: '' },
      vehicleId: s.vehicleId,
      firstGpsAt: s.firstGpsAt,
      lastGpsAt: s.lastGpsAt,
      firstGpsLabel: fmtTime(s.firstGpsAt),
      lastGpsLabel: fmtTime(s.lastGpsAt),
      durationMin: s.durationMin,
      startStatus: s.startStatus,
      startStatusLabel: STATUS_LABEL[s.startStatus] ?? s.startStatus,
      endStatus: s.endStatus,
      endStatusLabel: s.endStatus ? (END_STATUS_LABEL[s.endStatus] ?? s.endStatus) : null,
      lateStartMin: s.lateStartMin,
      earlyEndMin: s.earlyEndMin,
    }))

    res.json(successResponse(rows))
  } catch (err) { next(err) }
}

/**
 * GET /th/work-sessions/report — Mashina bo'yicha yig'ma
 */
export async function getWorkSessionReport(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = getOrgId(req)
    const { from, to, vehicleId } = req.query as Record<string, string>
    if (!from || !to) throw new AppError('from va to sana talab qilinadi', 400)

    const fromDate = new Date(from + 'T00:00:00.000Z')
    const toDate   = new Date(to   + 'T00:00:00.000Z')

    const where: any = { organizationId: orgId, date: { gte: fromDate, lte: toDate } }
    if (vehicleId) where.vehicleId = vehicleId

    const sessions = await (prisma as any).thWorkSession.findMany({ where })

    const vehicleMap = await getVehicleMap([...new Set<string>(sessions.map((s: any) => s.vehicleId as string))])

    const byVehicle = new Map<string, {
      total: number; present: number; absent: number; lateStart: number; earlyEnd: number; onTime: number
      totalDurationMin: number; totalLateStartMin: number; totalEarlyEndMin: number
      firstGpsTimes: number[]; lastGpsTimes: number[]
    }>()

    for (const s of sessions) {
      if (!byVehicle.has(s.vehicleId)) {
        byVehicle.set(s.vehicleId, {
          total: 0, present: 0, absent: 0, lateStart: 0, earlyEnd: 0, onTime: 0,
          totalDurationMin: 0, totalLateStartMin: 0, totalEarlyEndMin: 0,
          firstGpsTimes: [], lastGpsTimes: [],
        })
      }
      const e = byVehicle.get(s.vehicleId)!
      e.total++
      if (s.startStatus === 'absent') {
        e.absent++
      } else {
        e.present++
        e.totalDurationMin += s.durationMin
        if (s.firstGpsAt) e.firstGpsTimes.push(new Date(s.firstGpsAt).getTime())
        if (s.lastGpsAt)  e.lastGpsTimes.push(new Date(s.lastGpsAt).getTime())
        if (s.startStatus === 'late') { e.lateStart++; e.totalLateStartMin += s.lateStartMin }
        if (s.endStatus === 'early')  { e.earlyEnd++;  e.totalEarlyEndMin  += s.earlyEndMin }
        if (s.startStatus === 'on_time' || s.startStatus === 'early') e.onTime++
      }
    }

    const report = Array.from(byVehicle.entries()).map(([vid, e]) => {
      const avgStart = e.firstGpsTimes.length > 0 ? new Date(e.firstGpsTimes.reduce((a, b) => a + b, 0) / e.firstGpsTimes.length) : null
      const avgEnd   = e.lastGpsTimes.length  > 0 ? new Date(e.lastGpsTimes.reduce((a, b)  => a + b, 0) / e.lastGpsTimes.length)  : null
      return {
        vehicleId: vid,
        vehicle: vehicleMap.get(vid) ?? { registrationNumber: '—', brand: '', model: '' },
        totalDays: e.total, presentDays: e.present, absentDays: e.absent,
        lateStartDays: e.lateStart, earlyEndDays: e.earlyEnd, onTimeDays: e.onTime,
        attendancePct: e.total > 0 ? Math.round(e.present * 100 / e.total) : 0,
        avgDurationMin: e.present > 0 ? Math.round(e.totalDurationMin / e.present) : 0,
        avgLateStartMin: e.lateStart > 0 ? Math.round(e.totalLateStartMin / e.lateStart) : 0,
        avgEarlyEndMin:  e.earlyEnd  > 0 ? Math.round(e.totalEarlyEndMin  / e.earlyEnd)  : 0,
        avgStartLabel: fmtTime(avgStart),
        avgEndLabel:   fmtTime(avgEnd),
      }
    }).sort((a, b) => b.attendancePct - a.attendancePct)

    res.json(successResponse({ report, from, to, totalVehicles: report.length }))
  } catch (err) { next(err) }
}

/**
 * POST /th/work-sessions/backfill
 */
export async function backfillWorkSessionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = getOrgId(req)
    const { from, to, vehicleIds } = req.body
    if (!from || !to) throw new AppError('from va to sana talab qilinadi', 400)
    if ((new Date(to).getTime() - new Date(from).getTime()) / 86400000 > 90)
      throw new AppError('Backfill uchun maksimal davr 90 kun', 400)

    res.json(successResponse({ started: true, from, to }, 'Backfill ishga tushdi. Bu bir necha daqiqa olishi mumkin.'))

    backfillWorkSessions(orgId, from, to, vehicleIds).then(result => {
      console.log(`[ThWorkSession] backfill tugadi: ${result.processed} sessiya, ${result.errors} xato`)
    }).catch(err => {
      console.error('[ThWorkSession] backfill xatosi:', err?.message)
    })
  } catch (err) { next(err) }
}

/**
 * GET /th/work-sessions/excel
 */
export async function exportWorkSessionsExcel(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = getOrgId(req)
    const { from, to, vehicleId } = req.query as Record<string, string>
    if (!from || !to) throw new AppError('from va to sana talab qilinadi', 400)

    const where: any = {
      organizationId: orgId,
      date: { gte: new Date(from + 'T00:00:00.000Z'), lte: new Date(to + 'T00:00:00.000Z') },
    }
    if (vehicleId) where.vehicleId = vehicleId

    const sessions = await (prisma as any).thWorkSession.findMany({
      where,
      orderBy: [{ date: 'asc' }, { vehicleId: 'asc' }],
    })

    const vehicleMap = await getVehicleMap([...new Set<string>(sessions.map((s: any) => s.vehicleId as string))])

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Ish Vaqti')
    ws.columns = [
      { header: 'Sana',               key: 'date',    width: 14 },
      { header: 'Mashina',            key: 'vehicle', width: 16 },
      { header: 'Ish boshlash (UZT)', key: 'start',   width: 18 },
      { header: 'Ish tugatish (UZT)', key: 'end',     width: 18 },
      { header: 'Davomiylik (min)',    key: 'dur',     width: 16 },
      { header: 'Kelish holati',      key: 'sStatus', width: 18 },
      { header: 'Kechikish (min)',     key: 'late',    width: 16 },
      { header: 'Ketish holati',      key: 'eStatus', width: 18 },
      { header: 'Erta ketish (min)',   key: 'early',   width: 16 },
    ]
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
      cell.border = { bottom: { style: 'thin' } }
    })

    const STATUS_COLOR: Record<string, string> = {
      early: 'FF70AD47', on_time: 'FF70AD47', late: 'FFED7D31', absent: 'FFFF0000',
    }

    sessions.forEach((s: any) => {
      const v = vehicleMap.get(s.vehicleId)
      const row = ws.addRow({
        date:    fmtDate(s.date),
        vehicle: v?.registrationNumber ?? '—',
        start:   fmtTime(s.firstGpsAt) ?? '—',
        end:     fmtTime(s.lastGpsAt)  ?? '—',
        dur:     s.durationMin || 0,
        sStatus: STATUS_LABEL[s.startStatus] ?? s.startStatus,
        late:    s.lateStartMin || 0,
        eStatus: s.endStatus ? (END_STATUS_LABEL[s.endStatus] ?? s.endStatus) : '—',
        early:   s.earlyEndMin || 0,
      })
      const color = STATUS_COLOR[s.startStatus] ?? 'FF000000'
      row.getCell('sStatus').font = { color: { argb: color } }
    })

    ws.autoFilter = { from: 'A1', to: 'I1' }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="ish-vaqti-${from}-${to}.xlsx"`)
    await wb.xlsx.write(res)
  } catch (err) { next(err) }
}
