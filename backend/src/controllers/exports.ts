import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'

function applyBranchFilter(req: AuthRequest) {
  if (req.user!.role === 'branch_manager' || req.user!.role === 'operator') {
    return req.user!.branchId || undefined
  }
  return (req.query.branchId as string) || undefined
}

export async function exportVehicles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = applyBranchFilter(req)
    const vehicles = await prisma.vehicle.findMany({
      where: branchId ? { branchId } : {},
      include: { branch: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Avtomobillar')
    ws.columns = [
      { header: 'Raqam', key: 'reg', width: 15 },
      { header: 'Marka', key: 'brand', width: 15 },
      { header: 'Model', key: 'model', width: 15 },
      { header: 'Yil', key: 'year', width: 8 },
      { header: 'Yoqilgi', key: 'fuel', width: 12 },
      { header: 'Holat', key: 'status', width: 12 },
      { header: 'Filial', key: 'branch', width: 20 },
      { header: 'Yurish (km)', key: 'mileage', width: 14 },
    ]
    vehicles.forEach(v => ws.addRow({ reg: v.registrationNumber, brand: v.brand, model: v.model, year: v.year, fuel: v.fuelType, status: v.status, branch: v.branch.name, mileage: Number(v.mileage) }))

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="vehicles.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function exportFuelRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchId = applyBranchFilter(req)
    const records = await prisma.fuelRecord.findMany({
      where: {
        ...(from || to ? { refuelDate: { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } } : {}),
        ...(branchId ? { vehicle: { branchId } } : {}),
      },
      include: { vehicle: { select: { registrationNumber: true, brand: true } } },
      orderBy: { refuelDate: 'desc' },
    })

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Yoqilgi')
    ws.columns = [
      { header: 'Avtomobil', key: 'vehicle', width: 18 },
      { header: 'Sana', key: 'date', width: 16 },
      { header: 'Yoqilgi turi', key: 'type', width: 12 },
      { header: 'Litr', key: 'liters', width: 10 },
      { header: 'Narxi (UZS)', key: 'cost', width: 16 },
      { header: 'Odometr', key: 'odometer', width: 12 },
    ]
    records.forEach(r => ws.addRow({ vehicle: r.vehicle.registrationNumber, date: r.refuelDate.toISOString().split('T')[0], type: r.fuelType, liters: Number(r.amountLiters), cost: Number(r.cost), odometer: Number(r.odometerReading) }))

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="fuel-records.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function exportMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchId = applyBranchFilter(req)
    const records = await prisma.maintenanceRecord.findMany({
      where: {
        ...(from || to ? { installationDate: { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } } : {}),
        ...(branchId ? { vehicle: { branchId } } : {}),
      },
      include: {
        vehicle: { select: { registrationNumber: true } },
        sparePart: { select: { name: true, partCode: true } },
      },
      orderBy: { installationDate: 'desc' },
    })

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Texnik xizmat')
    ws.columns = [
      { header: 'Avtomobil', key: 'vehicle', width: 18 },
      { header: 'Sana', key: 'date', width: 16 },
      { header: 'Ehtiyot qism', key: 'part', width: 25 },
      { header: 'Kod', key: 'code', width: 12 },
      { header: 'Miqdor', key: 'qty', width: 8 },
      { header: 'Narxi (UZS)', key: 'cost', width: 16 },
    ]
    records.forEach(r => ws.addRow({ vehicle: r.vehicle.registrationNumber, date: r.installationDate.toISOString().split('T')[0], part: r.sparePart.name, code: r.sparePart.partCode, qty: r.quantityUsed, cost: Number(r.cost) }))

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="maintenance.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function exportInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = applyBranchFilter(req)
    const items = await prisma.inventory.findMany({
      where: branchId ? { branchId } : {},
      include: {
        sparePart: { select: { name: true, partCode: true, category: true, unitPrice: true } },
        branch: { select: { name: true } },
      },
    })

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Ombor')
    ws.columns = [
      { header: 'Filial', key: 'branch', width: 20 },
      { header: 'Ehtiyot qism', key: 'part', width: 25 },
      { header: 'Kod', key: 'code', width: 12 },
      { header: 'Kategoriya', key: 'cat', width: 15 },
      { header: 'Omborda', key: 'qty', width: 10 },
      { header: 'Min daraja', key: 'reorder', width: 12 },
      { header: 'Birlik narxi', key: 'price', width: 14 },
      { header: 'Jami qiymati', key: 'total', width: 16 },
    ]
    items.forEach(i => ws.addRow({ branch: i.branch.name, part: i.sparePart.name, code: i.sparePart.partCode, cat: i.sparePart.category, qty: i.quantityOnHand, reorder: i.reorderLevel, price: Number(i.sparePart.unitPrice), total: i.quantityOnHand * Number(i.sparePart.unitPrice) }))

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="inventory.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function exportExpenses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchId = applyBranchFilter(req)
    const records = await prisma.expense.findMany({
      where: {
        ...(from || to ? { expenseDate: { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } } : {}),
        ...(branchId ? { vehicle: { branchId } } : {}),
      },
      include: {
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
        category: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: { expenseDate: 'desc' },
    })
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Xarajatlar')
    ws.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Avtomobil', key: 'vehicle', width: 20 },
      { header: 'Kategoriya', key: 'cat', width: 18 },
      { header: 'Tavsif', key: 'desc', width: 30 },
      { header: 'Summa (UZS)', key: 'amount', width: 16 },
      { header: 'Kiritdi', key: 'user', width: 18 },
    ]
    records.forEach(r => ws.addRow({ date: new Date(r.expenseDate).toLocaleDateString('uz-UZ'), vehicle: `${r.vehicle?.registrationNumber} ${r.vehicle?.brand} ${r.vehicle?.model}`, cat: r.category?.name || '', desc: r.description || '', amount: Number(r.amount), user: r.createdBy?.fullName || '' }))
    ws.getColumn('amount').numFmt = '#,##0'
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="expenses.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function exportBranches(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branches = await prisma.branch.findMany({
      include: {
        manager: { select: { fullName: true } },
        _count: { select: { vehicles: true, users: true } },
      },
    })
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Filiallar')
    ws.columns = [
      { header: 'Filial nomi', key: 'name', width: 25 },
      { header: 'Joylashuv', key: 'location', width: 20 },
      { header: 'Telefon', key: 'phone', width: 16 },
      { header: 'Menejer', key: 'manager', width: 20 },
      { header: 'Avtomobillar', key: 'vehicles', width: 14 },
      { header: 'Xodimlar', key: 'users', width: 12 },
      { header: 'Holat', key: 'status', width: 10 },
    ]
    branches.forEach(b => ws.addRow({ name: b.name, location: b.location, phone: b.contactPhone || '', manager: b.manager?.fullName || '', vehicles: b._count.vehicles, users: b._count.users, status: b.isActive ? 'Faol' : 'Nofaol' }))
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="branches.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function exportVehicleReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { from, to } = req.query
    const dateRange = from || to
      ? { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined }
      : undefined

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: { branch: { select: { name: true, location: true } } },
    })
    if (!vehicle) throw new Error('Avtomobil topilmadi')

    const [maintenance, fuelRecords, expenses] = await Promise.all([
      prisma.maintenanceRecord.findMany({
        where: { vehicleId: id, ...(dateRange ? { installationDate: dateRange } : {}) },
        include: {
          sparePart: { select: { name: true, category: true, partCode: true, articleCode: { select: { code: true } } } },
          performedBy: { select: { fullName: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { installationDate: 'desc' },
      }),
      prisma.fuelRecord.findMany({
        where: { vehicleId: id, ...(dateRange ? { refuelDate: dateRange } : {}) },
        include: {
          supplier: { select: { name: true } },
          createdBy: { select: { fullName: true } },
        },
        orderBy: { refuelDate: 'desc' },
      }),
      prisma.expense.findMany({
        where: { vehicleId: id, ...(dateRange ? { expenseDate: dateRange } : {}) },
        include: {
          category: { select: { name: true } },
          createdBy: { select: { fullName: true } },
        },
        orderBy: { expenseDate: 'desc' },
      }),
    ])

    const totalMaint = maintenance.reduce((s, m) => s + Number(m.cost), 0)
    const totalFuel = fuelRecords.reduce((s, f) => s + Number(f.cost), 0)
    const totalExp = expenses.reduce((s, e) => s + Number(e.amount), 0)

    // Ustalar bo'yicha xarajat
    const workerMap: Record<string, { name: string; count: number; total: number }> = {}
    maintenance.forEach(m => {
      const n = m.performedBy.fullName
      if (!workerMap[n]) workerMap[n] = { name: n, count: 0, total: 0 }
      workerMap[n].count++
      workerMap[n].total += Number(m.cost)
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    wb.created = new Date()

    // ── Varaq 1: Umumiy ma'lumotnoma ─────────────────────────────────
    const ws1 = wb.addWorksheet('Umumiy')
    ws1.columns = [{ width: 35 }, { width: 30 }]
    const period = from || to
      ? `${from || '...'} — ${to || '...'}`
      : 'Barcha davr'
    const info = [
      ['AVTOMOBIL HISOBOTI', ''],
      ['Davlat raqami', vehicle.registrationNumber],
      ['Marka / Model', `${vehicle.brand} ${vehicle.model}`],
      ['Yil', vehicle.year],
      ['Filial', vehicle.branch.name],
      ['Holat', vehicle.status],
      ['Yurish (km)', Number(vehicle.mileage)],
      ['Hisobot davri', period],
      ['Hisobot sanasi', new Date().toLocaleDateString('uz-UZ')],
      ['', ''],
      ['XARAJATLAR JAMI', ''],
      ["Ta'mirlash xarajati (UZS)", totalMaint],
      ["Yoqilg'i xarajati (UZS)", totalFuel],
      ['Boshqa xarajatlar (UZS)', totalExp],
      ['UMUMIY JAMI (UZS)', totalMaint + totalFuel + totalExp],
    ]
    info.forEach((row, i) => {
      const wsRow = ws1.addRow(row)
      if (i === 0 || i === 10) {
        wsRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 0 ? 'FF2563EB' : 'FF1E40AF' } }
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: i === 0 ? 14 : 11 }
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
        })
        if (i === 0) ws1.mergeCells(`A1:B1`)
        if (i === 10) ws1.mergeCells(`A11:B11`)
        wsRow.height = i === 0 ? 28 : 22
      } else if (i === 14) {
        wsRow.eachCell(cell => {
          cell.font = { bold: true, size: 12 }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
        })
        wsRow.getCell(2).numFmt = '#,##0'
        wsRow.height = 22
      } else {
        wsRow.getCell(1).font = { bold: true, color: { argb: 'FF374151' } }
        if (typeof row[1] === 'number' && (row[1] as number) > 1000) wsRow.getCell(2).numFmt = '#,##0'
        if (i % 2 === 0) wsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
        wsRow.height = 20
      }
    })

    // ── Varaq 2: Ehtiyot qismlar va xizmatlar ────────────────────────
    const ws2 = wb.addWorksheet("Ehtiyot qismlar va xizmatlar")
    ws2.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Ehtiyot qism', key: 'part', width: 28 },
      { header: 'Artikul', key: 'article', width: 20 },
      { header: 'Kategoriya', key: 'cat', width: 15 },
      { header: 'Miqdor', key: 'qty', width: 8 },
      { header: 'Narxi (UZS)', key: 'cost', width: 16 },
      { header: 'Usta', key: 'worker', width: 22 },
      { header: "Ta'minotchi", key: 'supplier', width: 20 },
    ]
    maintenance.forEach(m => ws2.addRow({
      date: m.installationDate.toISOString().split('T')[0],
      part: m.sparePart.name,
      article: m.sparePart.articleCode?.code || '—',
      cat: m.sparePart.category,
      qty: m.quantityUsed,
      cost: Number(m.cost),
      worker: m.performedBy.fullName,
      supplier: m.supplier?.name || '—',
    }))
    // Jami qator
    const mTotalRow = ws2.addRow({ part: 'JAMI', cost: totalMaint })
    mTotalRow.eachCell(cell => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } } })
    ws2.getColumn('cost').numFmt = '#,##0'

    // ── Varaq 3: Ustalar bo'yicha ─────────────────────────────────────
    const ws3 = wb.addWorksheet("Ustalar bo'yicha")
    ws3.columns = [
      { header: 'Usta ismi', key: 'name', width: 25 },
      { header: 'Xizmatlar soni', key: 'count', width: 16 },
      { header: "Jami to'lov (UZS)", key: 'total', width: 20 },
    ]
    Object.values(workerMap)
      .sort((a, b) => b.total - a.total)
      .forEach(w => ws3.addRow({ name: w.name, count: w.count, total: w.total }))
    const wTotalRow = ws3.addRow({ name: 'JAMI', count: maintenance.length, total: totalMaint })
    wTotalRow.eachCell(cell => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } } })
    ws3.getColumn('total').numFmt = '#,##0'

    // ── Varaq 4: Yoqilg'i ────────────────────────────────────────────
    const ws4 = wb.addWorksheet("Yoqilg'i")
    ws4.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Yoqilgi turi', key: 'type', width: 14 },
      { header: 'Litr', key: 'liters', width: 10 },
      { header: 'Narxi (UZS)', key: 'cost', width: 16 },
      { header: 'Odometr (km)', key: 'odometer', width: 14 },
      { header: "Ta'minotchi", key: 'supplier', width: 20 },
      { header: 'Kiritgan', key: 'createdBy', width: 20 },
    ]
    fuelRecords.forEach(f => ws4.addRow({
      date: f.refuelDate.toISOString().split('T')[0],
      type: f.fuelType,
      liters: Number(f.amountLiters),
      cost: Number(f.cost),
      odometer: Number(f.odometerReading),
      supplier: f.supplier?.name || '—',
      createdBy: f.createdBy.fullName,
    }))
    const fTotalRow = ws4.addRow({ type: 'JAMI', liters: fuelRecords.reduce((s, f) => s + Number(f.amountLiters), 0), cost: totalFuel })
    fTotalRow.eachCell(cell => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } } })
    ws4.getColumn('cost').numFmt = '#,##0'

    // Barcha varaqlarga stil
    ;[ws2, ws3, ws4].forEach(ws => {
      const hr = ws.getRow(1)
      hr.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
      })
      hr.height = 22
      ws.views = [{ state: 'frozen', ySplit: 1 }]
      for (let i = 2; i <= ws.rowCount - 1; i++) {
        const row = ws.getRow(i)
        if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        row.height = 18
      }
    })

    const filename = `${vehicle.registrationNumber}-hisobot-${new Date().toISOString().split('T')[0]}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function export1CReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = applyBranchFilter(req)
    const { from, to } = req.query
    const dateFilter = from || to
      ? { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined }
      : undefined

    const [fuelRecords, maintenance] = await Promise.all([
      prisma.fuelRecord.findMany({
        where: {
          ...(dateFilter ? { refuelDate: dateFilter } : {}),
          ...(branchId ? { vehicle: { branchId } } : {}),
        },
        include: {
          vehicle: { select: { registrationNumber: true, brand: true, model: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { refuelDate: 'asc' },
        take: 5000,
      }),
      prisma.maintenanceRecord.findMany({
        where: {
          ...(dateFilter ? { installationDate: dateFilter } : {}),
          ...(branchId ? { vehicle: { branchId } } : {}),
        },
        include: {
          vehicle: { select: { registrationNumber: true, brand: true, model: true } },
          sparePart: { select: { name: true, partCode: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { installationDate: 'asc' },
        take: 5000,
      }),
    ])

    // 1C-compatible CSV format (semicolon-separated, BOM for Cyrillic)
    const BOM = '\uFEFF'
    const lines: string[] = []

    // Header
    lines.push('ТипОперации;Дата;Автомобиль;Номер;НоменклатураТМЦ;Количество;СтоимостьВсего;ПоставщикОрганизация;Примечание')

    // Fuel records as "Поступление ТМЦ" (inventory receipt)
    for (const r of fuelRecords) {
      const date = r.refuelDate.toISOString().split('T')[0].replace(/-/g, '.')
      const vehicle = `${r.vehicle.brand} ${r.vehicle.model}`
      const reg = r.vehicle.registrationNumber
      const nomName = `Топливо (${r.fuelType})`
      const qty = Number(r.amountLiters).toFixed(2)
      const cost = Number(r.cost).toFixed(2)
      const supplier = r.supplier?.name || ''
      const note = `Одометр: ${Number(r.odometerReading)} км`
      lines.push(`Заправка;${date};${vehicle};${reg};${nomName};${qty};${cost};${supplier};${note}`)
    }

    // Maintenance records as "Затраты на ремонт"
    for (const m of maintenance) {
      const date = m.installationDate.toISOString().split('T')[0].replace(/-/g, '.')
      const vehicle = `${m.vehicle.brand} ${m.vehicle.model}`
      const reg = m.vehicle.registrationNumber
      const nomName = `${m.sparePart.name} (${m.sparePart.partCode})`
      const qty = m.quantityUsed.toString()
      const cost = Number(m.cost).toFixed(2)
      const supplier = m.supplier?.name || ''
      lines.push(`Ремонт;${date};${vehicle};${reg};${nomName};${qty};${cost};${supplier};`)
    }

    const csv = BOM + lines.join('\r\n')
    const filename = `1C-export-${new Date().toISOString().split('T')[0]}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csv)
  } catch (err) { next(err) }
}

function styleHeaderRow(ws: ExcelJS.Worksheet) {
  const headerRow = ws.getRow(1)
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1D4ED8' } } }
  })
  headerRow.height = 22
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

function styleDataRows(ws: ExcelJS.Worksheet, rowCount: number) {
  for (let i = 2; i <= rowCount + 1; i++) {
    const row = ws.getRow(i)
    const fill = i % 2 === 0
      ? { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF1F5F9' } }
      : { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFFFFF' } }
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = fill
      cell.alignment = { vertical: 'middle' }
    })
    row.height = 18
  }
}

export async function exportFullReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = applyBranchFilter(req)
    const { from, to } = req.query
    const dateFilter = from || to ? { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } : undefined

    const [vehicles, fuelRecords, maintenance, inventory, sparePartStats, branches]: any[] = await Promise.all([
      prisma.vehicle.findMany({
        where: branchId ? { branchId } : {},
        include: { branch: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.fuelRecord.findMany({
        where: {
          ...(dateFilter ? { refuelDate: dateFilter } : {}),
          ...(branchId ? { vehicle: { branchId } } : {}),
        },
        include: { vehicle: { select: { registrationNumber: true, brand: true } } },
        orderBy: { refuelDate: 'desc' },
        take: 1000,
      }),
      prisma.maintenanceRecord.findMany({
        where: {
          ...(dateFilter ? { installationDate: dateFilter } : {}),
          ...(branchId ? { vehicle: { branchId } } : {}),
        },
        include: {
          vehicle: { select: { registrationNumber: true } },
          sparePart: { select: { name: true, partCode: true } },
        },
        orderBy: { installationDate: 'desc' },
        take: 1000,
      }),
      prisma.inventory.findMany({
        where: branchId ? { branchId } : {},
        include: {
          sparePart: { select: { name: true, partCode: true, category: true, unitPrice: true } },
          branch: { select: { name: true } },
        },
      }),
      (prisma as any).sparePartStatistic.findMany({
        include: { sparePart: { select: { name: true, partCode: true, category: true } } },
        orderBy: { totalCost: 'desc' },
        take: 100,
      }),
      prisma.branch.findMany({ select: { name: true, location: true, _count: { select: { vehicles: true } } } }),
    ])

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    wb.created = new Date()

    // ── Sheet 1: Summary ─────────────────────────────────────────────
    const wsSummary = wb.addWorksheet('Umumiy ma\'lumotnoma')
    wsSummary.columns = [{ width: 35 }, { width: 25 }]
    const totalFuelCost = fuelRecords.reduce((s: number, r: any) => s + Number(r.cost), 0)
    const totalMaintCost = maintenance.reduce((s: number, r: any) => s + Number(r.cost), 0)
    const totalInventoryVal = inventory.reduce((s: number, i: any) => s + i.quantityOnHand * Number(i.sparePart.unitPrice), 0)
    const summaryData = [
      ['Ko\'rsatkich', 'Qiymat'],
      ['Hisobot sanasi', new Date().toLocaleDateString('uz-UZ')],
      ['Jami avtomobillar', vehicles.length],
      ['Faol avtomobillar', vehicles.filter((v: any) => v.status === 'active').length],
      ['Jami filiallar', branches.length],
      ['Yoqilgi xarajati (UZS)', totalFuelCost],
      ["Ta'mirlash xarajati (UZS)", totalMaintCost],
      ['Jami xarajat (UZS)', totalFuelCost + totalMaintCost],
      ['Ombor qiymati (UZS)', totalInventoryVal],
      ['Yoqilgi yozuvlari', fuelRecords.length],
      ["Ta'mirlash yozuvlari", maintenance.length],
    ]
    summaryData.forEach((row, idx) => {
      const wsRow = wsSummary.addRow(row)
      if (idx === 0) {
        wsRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 }
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
        })
        wsRow.height = 24
      } else {
        wsRow.getCell(1).font = { bold: true }
        if (typeof row[1] === 'number' && row[1] > 1000) wsRow.getCell(2).numFmt = '#,##0'
        if (idx % 2 === 0) wsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        wsRow.height = 20
      }
    })
    wsSummary.views = [{ state: 'frozen', ySplit: 1 }]

    // ── Sheet 2: Vehicles ─────────────────────────────────────────────
    const wsVehicles = wb.addWorksheet('Avtomobillar')
    wsVehicles.columns = [
      { header: 'Raqam', key: 'reg', width: 15 },
      { header: 'Marka', key: 'brand', width: 14 },
      { header: 'Model', key: 'model', width: 14 },
      { header: 'Yil', key: 'year', width: 8 },
      { header: 'Yoqilgi', key: 'fuel', width: 12 },
      { header: 'Holat', key: 'status', width: 12 },
      { header: 'Filial', key: 'branch', width: 20 },
      { header: 'Yurish (km)', key: 'mileage', width: 14 },
    ]
    vehicles.forEach((v: any) => wsVehicles.addRow({ reg: v.registrationNumber, brand: v.brand, model: v.model, year: v.year, fuel: v.fuelType, status: v.status, branch: v.branch.name, mileage: Number(v.mileage) }))
    styleHeaderRow(wsVehicles)
    styleDataRows(wsVehicles, vehicles.length)

    // ── Sheet 3: Fuel Records ─────────────────────────────────────────
    const wsFuel = wb.addWorksheet("Yoqilg'i")
    wsFuel.columns = [
      { header: 'Avtomobil', key: 'vehicle', width: 18 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Yoqilgi turi', key: 'type', width: 12 },
      { header: 'Litr', key: 'liters', width: 10 },
      { header: 'Narxi (UZS)', key: 'cost', width: 16 },
      { header: 'Odometr (km)', key: 'odometer', width: 14 },
    ]
    fuelRecords.forEach((r: any) => wsFuel.addRow({ vehicle: r.vehicle.registrationNumber, date: r.refuelDate.toISOString().split('T')[0], type: r.fuelType, liters: Number(r.amountLiters), cost: Number(r.cost), odometer: Number(r.odometerReading) }))
    styleHeaderRow(wsFuel)
    styleDataRows(wsFuel, fuelRecords.length)
    wsFuel.getColumn('cost').numFmt = '#,##0'

    // ── Sheet 4: Maintenance ──────────────────────────────────────────
    const wsMaint = wb.addWorksheet("Ta'mirlash")
    wsMaint.columns = [
      { header: 'Avtomobil', key: 'vehicle', width: 18 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Ehtiyot qism', key: 'part', width: 25 },
      { header: 'Kod', key: 'code', width: 12 },
      { header: 'Miqdor', key: 'qty', width: 8 },
      { header: 'Narxi (UZS)', key: 'cost', width: 16 },
    ]
    maintenance.forEach((r: any) => wsMaint.addRow({ vehicle: r.vehicle.registrationNumber, date: r.installationDate.toISOString().split('T')[0], part: r.sparePart.name, code: r.sparePart.partCode, qty: r.quantityUsed, cost: Number(r.cost) }))
    styleHeaderRow(wsMaint)
    styleDataRows(wsMaint, maintenance.length)
    wsMaint.getColumn('cost').numFmt = '#,##0'

    // ── Sheet 5: Inventory ────────────────────────────────────────────
    const wsInv = wb.addWorksheet('Ombor')
    wsInv.columns = [
      { header: 'Filial', key: 'branch', width: 20 },
      { header: 'Ehtiyot qism', key: 'part', width: 25 },
      { header: 'Kod', key: 'code', width: 12 },
      { header: 'Kategoriya', key: 'cat', width: 15 },
      { header: 'Omborda', key: 'qty', width: 10 },
      { header: 'Min daraja', key: 'reorder', width: 12 },
      { header: 'Birlik narxi', key: 'price', width: 14 },
      { header: 'Jami qiymati', key: 'total', width: 16 },
    ]
    inventory.forEach((i: any) => wsInv.addRow({ branch: i.branch.name, part: i.sparePart.name, code: i.sparePart.partCode, cat: i.sparePart.category, qty: i.quantityOnHand, reorder: i.reorderLevel, price: Number(i.sparePart.unitPrice), total: i.quantityOnHand * Number(i.sparePart.unitPrice) }))
    styleHeaderRow(wsInv)
    styleDataRows(wsInv, inventory.length)
    wsInv.getColumn('price').numFmt = '#,##0'
    wsInv.getColumn('total').numFmt = '#,##0'

    // ── Sheet 6: Spare Part Stats ─────────────────────────────────────
    const wsStats = wb.addWorksheet('Ehtiyot qism statistikasi')
    wsStats.columns = [
      { header: 'Nomi', key: 'name', width: 25 },
      { header: 'Kod', key: 'code', width: 12 },
      { header: 'Kategoriya', key: 'cat', width: 15 },
      { header: 'Ishlatilgan (dona)', key: 'used', width: 18 },
      { header: 'Ishlatish soni', key: 'count', width: 14 },
      { header: 'Jami xarajat (UZS)', key: 'cost', width: 20 },
    ]
    sparePartStats.forEach((s: any) => wsStats.addRow({ name: s.sparePart.name, code: s.sparePart.partCode, cat: s.sparePart.category, used: s.totalUsed, count: s.usageCount, cost: Number(s.totalCost) }))
    styleHeaderRow(wsStats)
    styleDataRows(wsStats, sparePartStats.length)
    wsStats.getColumn('cost').numFmt = '#,##0'

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="full-report-${new Date().toISOString().split('T')[0]}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
