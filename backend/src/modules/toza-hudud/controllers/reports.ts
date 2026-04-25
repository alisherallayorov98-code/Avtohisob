import { Request, Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'

// ─── Dashboard: bugungi va oylik umumiy statistika ────────────────────────────
export async function getDashboardStats(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date()
    const todayDate = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z')
    const monthStart = new Date(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`)
    const monthEnd = new Date(monthStart)
    monthEnd.setMonth(monthEnd.getMonth() + 1)

    const [
      todayVisited, todayNotVisited, todayNoGps, todaySuspicious,
      monthVisited, monthNotVisited,
      todayLandfill, monthLandfill,
      totalMfys, totalVehicles, totalSchedules,
    ] = await Promise.all([
      (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'visited' } }),
      (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'not_visited' } }),
      (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'no_gps' } }),
      (prisma as any).thServiceTrip.count({ where: { date: todayDate, suspicious: true } }),
      (prisma as any).thServiceTrip.count({ where: { date: { gte: monthStart, lt: monthEnd }, status: 'visited' } }),
      (prisma as any).thServiceTrip.count({ where: { date: { gte: monthStart, lt: monthEnd }, status: 'not_visited' } }),
      (prisma as any).thLandfillTrip.count({ where: { date: todayDate } }),
      (prisma as any).thLandfillTrip.count({ where: { date: { gte: monthStart, lt: monthEnd } } }),
      (prisma as any).thMfy.count(),
      prisma.vehicle.count({ where: { status: 'active' } }),
      (prisma as any).thSchedule.count(),
    ])

    const todayTotal = todayVisited + todayNotVisited + todayNoGps
    const monthTotal = monthVisited + monthNotVisited

    // Eng kam borilgan MFYlar (oy uchun)
    const underservedMfys = await (prisma as any).thServiceTrip.groupBy({
      by: ['mfyId'],
      where: { date: { gte: monthStart, lt: monthEnd }, status: 'not_visited' },
      _count: { mfyId: true },
      orderBy: { _count: { mfyId: 'desc' } },
      take: 5,
    })

    const underservedIds = underservedMfys.map((m: any) => m.mfyId)
    const underservedNames = underservedIds.length
      ? await (prisma as any).thMfy.findMany({
          where: { id: { in: underservedIds } },
          select: { id: true, name: true, district: { select: { name: true } } },
        })
      : []
    const nameMap = new Map(underservedNames.map((m: any) => [m.id, m]))

    const underserved = underservedMfys.map((m: any) => ({
      ...(nameMap.get(m.mfyId) as any),
      missedCount: m._count.mfyId,
    }))

    res.json({
      success: true,
      data: {
        today: {
          date: todayDate,
          total: todayTotal,
          visited: todayVisited,
          notVisited: todayNotVisited,
          noGps: todayNoGps,
          suspicious: todaySuspicious,
          coveragePct: todayTotal > 0 ? Math.round(todayVisited / todayTotal * 100) : null,
          landfillTrips: todayLandfill,
        },
        month: {
          visited: monthVisited,
          notVisited: monthNotVisited,
          coveragePct: monthTotal > 0 ? Math.round(monthVisited / monthTotal * 100) : null,
          landfillTrips: monthLandfill,
        },
        totals: { mfys: totalMfys, vehicles: totalVehicles, schedules: totalSchedules },
        underserved,
      },
    })
  } catch (err) { next(err) }
}

// ─── Kunlik xizmat hisoboti ────────────────────────────────────────────────────
export async function getDailyReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, branchId } = req.query as any
    const targetDate = date ? new Date(date) : new Date()
    const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')

    const where: any = { date: dateOnly }
    if (branchId) {
      const vIds = await prisma.vehicle.findMany({ where: { branchId }, select: { id: true } }).then(vs => vs.map(v => v.id))
      if (vIds.length === 0) return res.json({ success: true, data: [], date: dateOnly })
      where.vehicleId = { in: vIds }
    }

    const trips = await (prisma as any).thServiceTrip.findMany({
      where,
      include: {
        mfy: { select: { id: true, name: true, district: { select: { name: true } } } },
      },
    })

    const vehicleIds: string[] = [...new Set<string>(trips.map((t: any) => t.vehicleId as string))]
    const vehicles = vehicleIds.length
      ? await prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true },
        })
      : []
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))

    // Vehicle bo'yicha guruhlash
    const grouped: Record<string, any> = {}
    for (const trip of trips) {
      if (!grouped[trip.vehicleId]) {
        grouped[trip.vehicleId] = {
          vehicle: vehicleMap.get(trip.vehicleId) || { registrationNumber: trip.vehicleId },
          visited: 0,
          notVisited: 0,
          noGps: 0,
          noPolygon: 0,
          suspicious: 0,
          trips: [],
        }
      }
      const g = grouped[trip.vehicleId]
      if (trip.status === 'visited') g.visited++
      else if (trip.status === 'not_visited') g.notVisited++
      else if (trip.status === 'no_gps') g.noGps++
      else if (trip.status === 'no_polygon') g.noPolygon++
      if (trip.suspicious) g.suspicious++
      g.trips.push(trip)
    }

    const data = Object.values(grouped).map((g: any) => ({
      ...g,
      total: g.visited + g.notVisited + g.noGps + g.noPolygon,
      coveragePct: g.visited + g.notVisited > 0
        ? Math.round((g.visited / (g.visited + g.notVisited)) * 100)
        : null,
    }))

    res.json({ success: true, data, date: dateOnly })
  } catch (err) { next(err) }
}

// ─── Oylik MFY hisoboti ────────────────────────────────────────────────────────
export async function getMonthlyMfyReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { year, month, districtId } = req.query as any
    const y = parseInt(year) || new Date().getFullYear()
    const m = parseInt(month) || new Date().getMonth() + 1

    const fromDate = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`)
    const toDate = new Date(fromDate)
    toDate.setMonth(toDate.getMonth() + 1)

    const mfyWhere: any = {}
    if (districtId) mfyWhere.districtId = districtId

    const mfys = await (prisma as any).thMfy.findMany({
      where: mfyWhere,
      select: { id: true, name: true, district: { select: { id: true, name: true } } },
    })

    const mfyIds = mfys.map((m: any) => m.id)

    const trips = mfyIds.length ? await (prisma as any).thServiceTrip.findMany({
      where: {
        mfyId: { in: mfyIds },
        date: { gte: fromDate, lt: toDate },
      },
      select: { mfyId: true, status: true, suspicious: true },
    }) : []

    const mfyMap = new Map(mfys.map((m: any) => [m.id, m]))

    // MFY bo'yicha guruhlash
    const grouped: Record<string, any> = {}
    for (const trip of trips) {
      if (!grouped[trip.mfyId]) {
        grouped[trip.mfyId] = { visited: 0, notVisited: 0, noGps: 0, suspicious: 0 }
      }
      if (trip.status === 'visited') grouped[trip.mfyId].visited++
      else if (trip.status === 'not_visited') grouped[trip.mfyId].notVisited++
      else if (trip.status === 'no_gps') grouped[trip.mfyId].noGps++
      if (trip.suspicious) grouped[trip.mfyId].suspicious++
    }

    const data = mfys.map((mfy: any) => {
      const g = grouped[mfy.id] || { visited: 0, notVisited: 0, noGps: 0, suspicious: 0 }
      const total = g.visited + g.notVisited
      return {
        mfy,
        ...g,
        total: total + g.noGps,
        coveragePct: total > 0 ? Math.round((g.visited / total) * 100) : null,
      }
    }).sort((a: any, b: any) => (a.coveragePct ?? 101) - (b.coveragePct ?? 101))

    res.json({ success: true, data, year: y, month: m })
  } catch (err) { next(err) }
}

// ─── Oylik mashina hisoboti ────────────────────────────────────────────────────
export async function getMonthlyVehicleReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { year, month, branchId } = req.query as any
    const y = parseInt(year) || new Date().getFullYear()
    const m = parseInt(month) || new Date().getMonth() + 1

    const fromDate = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`)
    const toDate = new Date(fromDate)
    toDate.setMonth(toDate.getMonth() + 1)

    const vehicleWhere: any = { status: 'active' }
    if (branchId) vehicleWhere.branchId = branchId

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true },
    })
    const vehicleIds = vehicles.map(v => v.id)

    const [serviceTrips, landfillTrips] = vehicleIds.length
      ? await Promise.all([
          (prisma as any).thServiceTrip.findMany({
            where: { vehicleId: { in: vehicleIds }, date: { gte: fromDate, lt: toDate } },
            select: { vehicleId: true, status: true, suspicious: true },
          }),
          (prisma as any).thLandfillTrip.findMany({
            where: { vehicleId: { in: vehicleIds }, date: { gte: fromDate, lt: toDate } },
            select: { vehicleId: true, durationMin: true },
          }),
        ])
      : [[], []]

    const stMap: Record<string, any> = {}
    for (const t of serviceTrips) {
      if (!stMap[t.vehicleId]) stMap[t.vehicleId] = { visited: 0, notVisited: 0, noGps: 0, suspicious: 0 }
      if (t.status === 'visited') stMap[t.vehicleId].visited++
      else if (t.status === 'not_visited') stMap[t.vehicleId].notVisited++
      else if (t.status === 'no_gps') stMap[t.vehicleId].noGps++
      if (t.suspicious) stMap[t.vehicleId].suspicious++
    }
    const lfMap: Record<string, number> = {}
    for (const t of landfillTrips) {
      lfMap[t.vehicleId] = (lfMap[t.vehicleId] || 0) + 1
    }

    const data = vehicles.map(v => {
      const s = stMap[v.id] || { visited: 0, notVisited: 0, noGps: 0, suspicious: 0 }
      const total = s.visited + s.notVisited
      return {
        vehicle: v,
        ...s,
        landfillTrips: lfMap[v.id] || 0,
        coveragePct: total > 0 ? Math.round((s.visited / total) * 100) : null,
      }
    }).sort((a, b) => (b.visited + b.landfillTrips) - (a.visited + a.landfillTrips))

    res.json({ success: true, data, year: y, month: m })
  } catch (err) { next(err) }
}

// ─── Excel: kunlik hisobot ─────────────────────────────────────────────────────
export async function exportDailyExcel(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, branchId } = req.query as any
    const targetDate = date ? new Date(date) : new Date()
    const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')
    const dateStr = dateOnly.toISOString().split('T')[0]

    const where: any = { date: dateOnly }
    if (branchId) {
      const vIds = await prisma.vehicle.findMany({ where: { branchId }, select: { id: true } }).then(vs => vs.map(v => v.id))
      where.vehicleId = { in: vIds }
    }

    const trips = await (prisma as any).thServiceTrip.findMany({
      where,
      include: {
        mfy: { select: { name: true, district: { select: { name: true } } } },
      },
      orderBy: [{ vehicleId: 'asc' }, { status: 'asc' }],
    })

    const vehicleIds: string[] = [...new Set<string>(trips.map((t: any) => t.vehicleId as string))]
    const vehicles = vehicleIds.length
      ? await prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: { id: true, registrationNumber: true, brand: true, model: true },
        })
      : []
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Kunlik hisobot')

    ws.columns = [
      { header: '№', key: 'no', width: 5 },
      { header: 'Mashina', key: 'reg', width: 16 },
      { header: 'Marka/Model', key: 'model', width: 18 },
      { header: 'MFY', key: 'mfy', width: 28 },
      { header: 'Tuman', key: 'district', width: 20 },
      { header: 'Holat', key: 'status', width: 14 },
      { header: 'Kirdi', key: 'enteredAt', width: 10 },
      { header: 'Chiqdi', key: 'exitedAt', width: 10 },
      { header: 'Tezlik (km/h)', key: 'speed', width: 14 },
      { header: 'Shubhali', key: 'suspicious', width: 10 },
    ]

    // Header style
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } }

    const statusLabel: Record<string, string> = {
      visited: 'Borildi',
      not_visited: 'Borilmadi',
      no_gps: "GPS yo'q",
      no_polygon: "Polygon yo'q",
    }
    const statusColor: Record<string, string> = {
      visited: 'FFD1FAE5',
      not_visited: 'FFFEE2E2',
      no_gps: 'FFF3F4F6',
      no_polygon: 'FFFEF9C3',
    }

    let rowNum = 0
    for (const trip of trips) {
      rowNum++
      const v = vehicleMap.get(trip.vehicleId)
      const row = ws.addRow({
        no: rowNum,
        reg: v?.registrationNumber || trip.vehicleId.slice(0, 8),
        model: v ? `${v.brand} ${v.model}` : '',
        mfy: trip.mfy?.name || '',
        district: trip.mfy?.district?.name || '',
        status: statusLabel[trip.status] || trip.status,
        enteredAt: trip.enteredAt ? new Date(trip.enteredAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '',
        exitedAt: trip.exitedAt ? new Date(trip.exitedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '',
        speed: trip.maxSpeedKmh ? Math.round(trip.maxSpeedKmh) : '',
        suspicious: trip.suspicious ? 'Ha' : '',
      })
      const fillColor = statusColor[trip.status] || 'FFFFFFFF'
      row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } }
      if (trip.suspicious) {
        row.getCell('suspicious').font = { color: { argb: 'FFEA580C' }, bold: true }
      }
    }

    ws.getRow(1).height = 22
    ws.autoFilter = { from: 'A1', to: 'J1' }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="toza-hudud-kunlik-${dateStr}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

// ─── Excel: oylik MFY hisoboti ─────────────────────────────────────────────────
export async function exportMonthlyMfyExcel(req: Request, res: Response, next: NextFunction) {
  try {
    const { year, month, districtId } = req.query as any
    const y = parseInt(year) || new Date().getFullYear()
    const m = parseInt(month) || new Date().getMonth() + 1

    const fromDate = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`)
    const toDate = new Date(fromDate)
    toDate.setMonth(toDate.getMonth() + 1)

    const mfyWhere: any = {}
    if (districtId) mfyWhere.districtId = districtId

    const mfys = await (prisma as any).thMfy.findMany({
      where: mfyWhere,
      select: { id: true, name: true, district: { select: { name: true } } },
      orderBy: [{ district: { name: 'asc' } }, { name: 'asc' }],
    })

    const mfyIds = mfys.map((m: any) => m.id)
    const trips = mfyIds.length ? await (prisma as any).thServiceTrip.findMany({
      where: { mfyId: { in: mfyIds }, date: { gte: fromDate, lt: toDate } },
      select: { mfyId: true, status: true },
    }) : []

    const grouped: Record<string, any> = {}
    for (const t of trips) {
      if (!grouped[t.mfyId]) grouped[t.mfyId] = { visited: 0, notVisited: 0, noGps: 0 }
      if (t.status === 'visited') grouped[t.mfyId].visited++
      else if (t.status === 'not_visited') grouped[t.mfyId].notVisited++
      else grouped[t.mfyId].noGps++
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Oylik MFY hisobot')
    const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

    ws.columns = [
      { header: '№', key: 'no', width: 5 },
      { header: 'MFY', key: 'mfy', width: 28 },
      { header: 'Tuman', key: 'district', width: 20 },
      { header: 'Borildi (kun)', key: 'visited', width: 14 },
      { header: "Borilmadi (kun)", key: 'notVisited', width: 16 },
      { header: "GPS yo'q", key: 'noGps', width: 10 },
      { header: 'Qamrov %', key: 'pct', width: 12 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } }

    mfys.forEach((mfy: any, i: number) => {
      const g = grouped[mfy.id] || { visited: 0, notVisited: 0, noGps: 0 }
      const total = g.visited + g.notVisited
      const pct = total > 0 ? Math.round((g.visited / total) * 100) : null
      const row = ws.addRow({
        no: i + 1,
        mfy: mfy.name,
        district: mfy.district?.name || '',
        visited: g.visited,
        notVisited: g.notVisited,
        noGps: g.noGps,
        pct: pct !== null ? `${pct}%` : '—',
      })
      if (pct !== null) {
        const color = pct >= 80 ? 'FFD1FAE5' : pct >= 50 ? 'FFFEF9C3' : 'FFFEE2E2'
        row.getCell('pct').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
      }
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="toza-hudud-mfy-${monthNames[m - 1]}-${y}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

// ─── Excel: oylik mashina hisoboti ─────────────────────────────────────────────
export async function exportMonthlyVehicleExcel(req: Request, res: Response, next: NextFunction) {
  try {
    const { year, month, branchId } = req.query as any
    const y = parseInt(year) || new Date().getFullYear()
    const m = parseInt(month) || new Date().getMonth() + 1
    const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

    const fromDate = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`)
    const toDate = new Date(fromDate)
    toDate.setMonth(toDate.getMonth() + 1)

    const vehicleWhere: any = { status: 'active' }
    if (branchId) vehicleWhere.branchId = branchId

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    const vehicleIds = vehicles.map(v => v.id)

    const [serviceTrips, landfillTrips] = vehicleIds.length
      ? await Promise.all([
          (prisma as any).thServiceTrip.findMany({
            where: { vehicleId: { in: vehicleIds }, date: { gte: fromDate, lt: toDate } },
            select: { vehicleId: true, status: true, suspicious: true },
          }),
          (prisma as any).thLandfillTrip.findMany({
            where: { vehicleId: { in: vehicleIds }, date: { gte: fromDate, lt: toDate } },
            select: { vehicleId: true },
          }),
        ])
      : [[], []]

    const stMap: Record<string, any> = {}
    for (const t of serviceTrips) {
      if (!stMap[t.vehicleId]) stMap[t.vehicleId] = { visited: 0, notVisited: 0, noGps: 0, suspicious: 0 }
      if (t.status === 'visited') stMap[t.vehicleId].visited++
      else if (t.status === 'not_visited') stMap[t.vehicleId].notVisited++
      else stMap[t.vehicleId].noGps++
      if (t.suspicious) stMap[t.vehicleId].suspicious++
    }
    const lfMap: Record<string, number> = {}
    for (const t of landfillTrips) lfMap[t.vehicleId] = (lfMap[t.vehicleId] || 0) + 1

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Oylik mashina hisobot')

    ws.columns = [
      { header: '№', key: 'no', width: 5 },
      { header: 'Mashina', key: 'reg', width: 16 },
      { header: 'Marka/Model', key: 'model', width: 18 },
      { header: 'Borildi (kun×MFY)', key: 'visited', width: 18 },
      { header: 'Borilmadi', key: 'notVisited', width: 12 },
      { header: "GPS yo'q", key: 'noGps', width: 10 },
      { header: 'Shubhali', key: 'suspicious', width: 10 },
      { header: 'Poligon tashrifi', key: 'landfill', width: 16 },
      { header: 'Qamrov %', key: 'pct', width: 12 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } }

    vehicles.forEach((v, i) => {
      const s = stMap[v.id] || { visited: 0, notVisited: 0, noGps: 0, suspicious: 0 }
      const total = s.visited + s.notVisited
      const pct = total > 0 ? Math.round((s.visited / total) * 100) : null
      const row = ws.addRow({
        no: i + 1,
        reg: v.registrationNumber,
        model: `${v.brand} ${v.model}`,
        visited: s.visited,
        notVisited: s.notVisited,
        noGps: s.noGps,
        suspicious: s.suspicious,
        landfill: lfMap[v.id] || 0,
        pct: pct !== null ? `${pct}%` : '—',
      })
      if (pct !== null) {
        const color = pct >= 80 ? 'FFD1FAE5' : pct >= 50 ? 'FFFEF9C3' : 'FFFEE2E2'
        row.getCell('pct').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
      }
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="toza-hudud-mashinalar-${monthNames[m - 1]}-${y}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
