import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getSearchVariants } from '../lib/transliterate'

function applyBranchFilter(req: AuthRequest) {
  if (['branch_manager', 'operator'].includes(req.user!.role)) {
    return req.user!.branchId || undefined
  }
  return (req.query.branchId as string) || undefined
}

// ── Chiroyli Excel styling helper ──────────────────────────────────────────
function styleWorksheet(ws: ExcelJS.Worksheet, title: string) {
  const headerRow = ws.getRow(1)
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF388E3C' } },
      bottom: { style: 'thin', color: { argb: 'FF388E3C' } },
      left: { style: 'thin', color: { argb: 'FF388E3C' } },
      right: { style: 'thin', color: { argb: 'FF388E3C' } },
    }
  })
  headerRow.height = 32

  // data rows
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFB0BEC5' } },
        bottom: { style: 'hair', color: { argb: 'FFB0BEC5' } },
        left: { style: 'hair', color: { argb: 'FFB0BEC5' } },
        right: { style: 'hair', color: { argb: 'FFB0BEC5' } },
      }
      if (rowNum % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } }
      }
    })
    row.height = 20
  })

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  // footer
  const lastRow = ws.lastRow ? ws.lastRow.number + 2 : 3
  const footerRow = ws.getRow(lastRow)
  footerRow.getCell(1).value = `AutoHisob — ${title} — ${new Date().toLocaleDateString('uz-UZ')}`
  footerRow.getCell(1).font = { italic: true, color: { argb: 'FF757575' }, size: 9 }
}

function send(wb: ExcelJS.Workbook, filename: string, res: Response) {
  const encoded = encodeURIComponent(filename)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  // RFC 5987: supports non-ASCII filenames in all modern browsers
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`)
  return wb.xlsx.write(res).then(() => res.end())
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
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Avtomobillar')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Raqam', key: 'reg', width: 15 },
      { header: 'Marka', key: 'brand', width: 15 },
      { header: 'Model', key: 'model', width: 15 },
      { header: 'Yil', key: 'year', width: 8 },
      { header: 'Yoqilg\'i turi', key: 'fuel', width: 14 },
      { header: 'Holat', key: 'status', width: 12 },
      { header: 'Filial', key: 'branch', width: 22 },
      { header: 'Yurish (km)', key: 'mileage', width: 14 },
    ]
    vehicles.forEach((v, i) => ws.addRow({ no: i + 1, reg: v.registrationNumber, brand: v.brand, model: v.model, year: v.year, fuel: v.fuelType, status: v.status === 'active' ? 'Faol' : v.status === 'maintenance' ? 'Ta\'mirda' : 'Nofaol', branch: v.branch?.name ?? '—', mileage: Number(v.mileage) }))
    styleWorksheet(ws, 'Avtomobillar ro\'yhati')
    await send(wb, 'avtomobillar.xlsx', res)
  } catch (err) {
    console.error('[exportVehicles]', err)
    next(err)
  }
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
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Yoqilgi')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Avtomobil', key: 'vehicle', width: 18 },
      { header: 'Sana', key: 'date', width: 16 },
      { header: 'Yoqilg\'i turi', key: 'type', width: 14 },
      { header: 'Litr', key: 'liters', width: 10 },
      { header: 'Narxi (UZS)', key: 'cost', width: 18 },
      { header: 'Odometr (km)', key: 'odometer', width: 14 },
    ]
    records.forEach((r, i) => ws.addRow({ no: i + 1, vehicle: r.vehicle.registrationNumber, date: r.refuelDate.toISOString().split('T')[0], type: r.fuelType, liters: Number(r.amountLiters), cost: Number(r.cost), odometer: Number(r.odometerReading) }))
    ws.getColumn('cost').numFmt = '#,##0'
    ws.getColumn('liters').numFmt = '#,##0.00'
    // Summary
    const totalLiters = records.reduce((s, r) => s + Number(r.amountLiters), 0)
    const totalCost = records.reduce((s, r) => s + Number(r.cost), 0)
    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', vehicle: '', date: '', type: '', liters: totalLiters, cost: totalCost, odometer: '' })
    sumRow.font = { bold: true }
    sumRow.getCell('no').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    styleWorksheet(ws, 'Yoqilg\'i sarfi')
    await send(wb, 'yoqilgi-hisobot.xlsx', res)
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
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Texnik xizmat')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Avtomobil', key: 'vehicle', width: 18 },
      { header: 'Sana', key: 'date', width: 16 },
      { header: 'Ehtiyot qism', key: 'part', width: 28 },
      { header: 'Artikul', key: 'code', width: 14 },
      { header: 'Miqdor', key: 'qty', width: 10 },
      { header: 'Narxi (UZS)', key: 'cost', width: 18 },
    ]
    records.forEach((r, i) => ws.addRow({ no: i + 1, vehicle: r.vehicle.registrationNumber, date: r.installationDate.toISOString().split('T')[0], part: r.sparePart?.name || '—', code: r.sparePart?.partCode || '—', qty: r.quantityUsed, cost: Number(r.cost) }))
    ws.getColumn('cost').numFmt = '#,##0'
    // Summary
    const total = records.reduce((s, r) => s + Number(r.cost), 0)
    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', vehicle: '', date: '', part: '', code: '', qty: records.reduce((s, r) => s + r.quantityUsed, 0), cost: total })
    sumRow.font = { bold: true }
    styleWorksheet(ws, 'Texnik xizmat')
    await send(wb, 'texnik-xizmat.xlsx', res)
  } catch (err) { next(err) }
}

export async function exportInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Resolve warehouseId: branch_manager → their branch's warehouseId; admin → query param
    let warehouseId: string | undefined
    if (['branch_manager', 'operator'].includes(req.user!.role) && req.user!.branchId) {
      const b = await prisma.branch.findUnique({ where: { id: req.user!.branchId }, select: { warehouseId: true } })
      warehouseId = b?.warehouseId || undefined
    } else {
      warehouseId = (req.query.warehouseId as string) || undefined
    }
    const items = await prisma.inventory.findMany({
      where: warehouseId ? { warehouseId } : {},
      include: {
        sparePart: { select: { name: true, partCode: true, category: true, unitPrice: true } },
        warehouse: { select: { name: true } },
      },
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Ombor')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Filial', key: 'branch', width: 22 },
      { header: 'Ehtiyot qism nomi', key: 'part', width: 30 },
      { header: 'Artikul', key: 'code', width: 14 },
      { header: 'Kategoriya', key: 'cat', width: 18 },
      { header: 'Omborda (dona)', key: 'qty', width: 14 },
      { header: 'Min. daraja', key: 'reorder', width: 12 },
      { header: 'Birlik narxi', key: 'price', width: 16 },
      { header: 'Jami qiymati', key: 'total', width: 18 },
    ]
    items.forEach((i: any, idx: number) => ws.addRow({ no: idx + 1, branch: i.warehouse?.name ?? '—', part: i.sparePart.name, code: i.sparePart.partCode, cat: i.sparePart.category, qty: i.quantityOnHand, reorder: i.reorderLevel, price: Number(i.sparePart.unitPrice), total: i.quantityOnHand * Number(i.sparePart.unitPrice) }))
    ws.getColumn('price').numFmt = '#,##0'
    ws.getColumn('total').numFmt = '#,##0'
    // Summary
    const grandTotal = items.reduce((s, i) => s + i.quantityOnHand * Number(i.sparePart.unitPrice), 0)
    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', branch: '', part: '', code: '', cat: '', qty: items.reduce((s, i) => s + i.quantityOnHand, 0), reorder: '', price: '', total: grandTotal })
    sumRow.font = { bold: true }
    styleWorksheet(ws, 'Ombor hisoboti')
    await send(wb, 'ombor-hisoboti.xlsx', res)
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
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Xarajatlar')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Avtomobil', key: 'vehicle', width: 22 },
      { header: 'Kategoriya', key: 'cat', width: 20 },
      { header: 'Tavsif', key: 'desc', width: 32 },
      { header: 'Summa (UZS)', key: 'amount', width: 18 },
      { header: 'Kiritdi', key: 'user', width: 20 },
    ]
    records.forEach((r, i) => ws.addRow({ no: i + 1, date: new Date(r.expenseDate).toLocaleDateString('uz-UZ'), vehicle: `${r.vehicle?.registrationNumber || ''} ${r.vehicle?.brand || ''} ${r.vehicle?.model || ''}`.trim(), cat: r.category?.name || '', desc: r.description || '', amount: Number(r.amount), user: r.createdBy?.fullName || '' }))
    ws.getColumn('amount').numFmt = '#,##0'
    const totalAmt = records.reduce((s, r) => s + Number(r.amount), 0)
    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', date: '', vehicle: '', cat: '', desc: `${records.length} ta xarajat`, amount: totalAmt, user: '' })
    sumRow.font = { bold: true }
    styleWorksheet(ws, 'Xarajatlar hisoboti')
    await send(wb, 'xarajatlar.xlsx', res)
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
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Filiallar')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Filial nomi', key: 'name', width: 25 },
      { header: 'Joylashuv', key: 'location', width: 20 },
      { header: 'Telefon', key: 'phone', width: 16 },
      { header: 'Menejer', key: 'manager', width: 22 },
      { header: 'Avtomobillar', key: 'vehicles', width: 14 },
      { header: 'Xodimlar', key: 'users', width: 12 },
      { header: 'Holat', key: 'status', width: 10 },
    ]
    branches.forEach((b, i) => ws.addRow({ no: i + 1, name: b.name, location: b.location, phone: b.contactPhone || '', manager: b.manager?.fullName || '', vehicles: b._count.vehicles, users: b._count.users, status: b.isActive ? 'Faol' : 'Nofaol' }))
    styleWorksheet(ws, 'Filiallar')
    await send(wb, 'filiallar.xlsx', res)
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

    // Admins, branch managers and operators can only export their own branch's vehicles
    const userBranchId = req.user!.branchId
    if (['branch_manager', 'operator'].includes(req.user!.role) && userBranchId && vehicle.branchId !== userBranchId) {
      throw new Error('Boshqa filial avtomobiliga kirish taqiqlangan')
    }

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
      ['Filial', vehicle.branch?.name ?? '—'],
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
      part: m.sparePart?.name || '—',
      article: m.sparePart?.articleCode?.code || '—',
      cat: m.sparePart?.category || '—',
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
      const nomName = `${m.sparePart?.name || '—'} (${m.sparePart?.partCode || '—'})`
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
        where: {},
        include: {
          sparePart: { select: { name: true, partCode: true, category: true, unitPrice: true } },
          warehouse: { select: { name: true } },
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
    vehicles.forEach((v: any) => wsVehicles.addRow({ reg: v.registrationNumber, brand: v.brand, model: v.model, year: v.year, fuel: v.fuelType, status: v.status, branch: v.branch?.name ?? '—', mileage: Number(v.mileage) }))
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
    inventory.forEach((i: any) => wsInv.addRow({ branch: i.branch?.name ?? '—', part: i.sparePart.name, code: i.sparePart.partCode, cat: i.sparePart.category, qty: i.quantityOnHand, reorder: i.reorderLevel, price: Number(i.sparePart.unitPrice), total: i.quantityOnHand * Number(i.sparePart.unitPrice) }))
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

// ── Ehtiyot qismlar ro'yhati ─────────────────────────────────────────────
export async function exportSpareParts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { category, supplierId } = req.query
    const parts = await prisma.sparePart.findMany({
      where: {
        ...(category ? { category: category as string } : {}),
        ...(supplierId ? { supplierId: supplierId as string } : {}),
        isActive: true,
      },
      include: {
        supplier: { select: { name: true } },
        articleCode: { select: { code: true } },
        inventories: { select: { quantityOnHand: true } },
      },
      orderBy: { name: 'asc' },
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    wb.created = new Date()
    const ws = wb.addWorksheet('Ehtiyot qismlar')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Nomi', key: 'name', width: 32 },
      { header: 'Artikul', key: 'code', width: 16 },
      { header: 'Shtrix-kod', key: 'barcode', width: 22 },
      { header: 'Kategoriya', key: 'category', width: 18 },
      { header: 'Yetkazuvchi', key: 'supplier', width: 22 },
      { header: 'Ombordagi miqdor', key: 'qty', width: 18 },
      { header: 'Birlik narxi (UZS)', key: 'price', width: 20 },
      { header: 'Jami qiymat (UZS)', key: 'total', width: 20 },
    ]

    let grandQty = 0
    let grandTotal = 0

    parts.forEach((p, i) => {
      const qty = p.inventories.reduce((s: number, inv: { quantityOnHand: number }) => s + inv.quantityOnHand, 0)
      const price = Number(p.unitPrice)
      const total = qty * price
      grandQty += qty
      grandTotal += total
      ws.addRow({
        no: i + 1,
        name: p.name,
        code: p.partCode,
        barcode: (p as any).articleCode?.code || '',
        category: p.category,
        supplier: p.supplier.name,
        qty,
        price,
        total,
      })
    })

    ws.getColumn('price').numFmt = '#,##0'
    ws.getColumn('total').numFmt = '#,##0'

    // Summary footer
    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', name: `${parts.length} ta mahsulot`, code: '', barcode: '', category: '', supplier: '', qty: grandQty, price: '', total: grandTotal })
    sumRow.font = { bold: true }
    sumRow.getCell('qty').numFmt = '#,##0'
    sumRow.getCell('total').numFmt = '#,##0'

    styleWorksheet(ws, 'Ehtiyot qismlar ro\'yhati')
    await send(wb, `ehtiyot-qismlar-${new Date().toISOString().split('T')[0]}.xlsx`, res)
  } catch (err) { next(err) }
}

// ── O'tkazmalar (transferlar) ────────────────────────────────────────────
export async function exportTransfers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchId = applyBranchFilter(req)
    const transfers = await prisma.inventoryTransfer.findMany({
      where: {
        ...(from || to ? { transferDate: { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } } : {}),
        ...(branchId ? { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] } : {}),
      },
      include: {
        sparePart: { select: { name: true, partCode: true } },
        fromBranch: { select: { name: true } },
        toBranch: { select: { name: true } },
        approvedBy: { select: { fullName: true } },
      },
      orderBy: { transferDate: 'desc' },
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet("O'tkazmalar")
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Ehtiyot qism', key: 'part', width: 30 },
      { header: 'Artikul', key: 'code', width: 14 },
      { header: 'Qayerdan', key: 'from', width: 20 },
      { header: 'Qayerga', key: 'to', width: 20 },
      { header: 'Miqdor', key: 'qty', width: 10 },
      { header: 'Holat', key: 'status', width: 14 },
      { header: 'Tasdiqlagan', key: 'approver', width: 22 },
    ]

    const statusMap: Record<string, string> = { pending: 'Kutilmoqda', approved: 'Tasdiqlangan', rejected: 'Rad etilgan', completed: 'Bajarildi' }
    transfers.forEach((t, i) => ws.addRow({
      no: i + 1,
      date: new Date(t.transferDate).toLocaleDateString('uz-UZ'),
      part: t.sparePart.name,
      code: t.sparePart.partCode,
      from: t.fromBranch.name,
      to: t.toBranch.name,
      qty: t.quantity,
      status: statusMap[t.status] || t.status,
      approver: t.approvedBy?.fullName || '—',
    }))

    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', date: '', part: `${transfers.length} ta o'tkazma`, code: '', from: '', to: '', qty: transfers.reduce((s, t) => s + t.quantity, 0), status: '', approver: '' })
    sumRow.font = { bold: true }

    styleWorksheet(ws, "O'tkazmalar hisoboti")
    await send(wb, `otkazmalar-${new Date().toISOString().split('T')[0]}.xlsx`, res)
  } catch (err) { next(err) }
}

// ── Shinalar ─────────────────────────────────────────────────────────────
export async function exportTires(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = applyBranchFilter(req)
    const tires = await prisma.tire.findMany({
      where: branchId ? { branchId } : {},
      include: {
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Shinalar')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'ID', key: 'uid', width: 16 },
      { header: 'Brend', key: 'brand', width: 16 },
      { header: 'Model', key: 'model', width: 16 },
      { header: 'O\'lchami', key: 'size', width: 14 },
      { header: 'Turi', key: 'type', width: 14 },
      { header: 'Holat', key: 'status', width: 12 },
      { header: 'Shart', key: 'condition', width: 12 },
      { header: 'Avtomobil', key: 'vehicle', width: 22 },
      { header: 'O\'rnatilgan joy', key: 'position', width: 16 },
      { header: 'Sotib olingan', key: 'purchased', width: 14 },
      { header: 'Narxi (UZS)', key: 'price', width: 16 },
      { header: 'Yurish (km)', key: 'mileage', width: 14 },
      { header: 'Kafolat tugashi', key: 'warranty', width: 16 },
    ]

    const statusMap: Record<string, string> = { active: 'Faol', replaced: 'Almashtirilgan', retired: 'Hisobdan chiqarilgan', damaged: 'Shikastlangan' }
    const condMap: Record<string, string> = { excellent: 'A\'lo', good: 'Yaxshi', fair: 'O\'rtacha', poor: 'Yomon', critical: 'Kritik' }

    tires.forEach((t, i) => ws.addRow({
      no: i + 1,
      uid: t.uniqueId,
      brand: t.brand,
      model: t.model,
      size: t.size,
      type: t.type,
      status: statusMap[t.status] || t.status,
      condition: condMap[t.condition] || t.condition,
      vehicle: t.vehicle ? `${t.vehicle.registrationNumber} ${t.vehicle.brand} ${t.vehicle.model}` : '—',
      position: t.position || '—',
      purchased: new Date(t.purchaseDate).toLocaleDateString('uz-UZ'),
      price: Number(t.purchasePrice),
      mileage: Number(t.totalMileage),
      warranty: t.warrantyEndDate ? new Date(t.warrantyEndDate).toLocaleDateString('uz-UZ') : '—',
    }))

    ws.getColumn('price').numFmt = '#,##0'
    ws.getColumn('mileage').numFmt = '#,##0'
    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', uid: `${tires.length} ta shina`, brand: '', model: '', size: '', type: '', status: '', condition: '', vehicle: '', position: '', purchased: '', price: tires.reduce((s, t) => s + Number(t.purchasePrice), 0), mileage: '', warranty: '' })
    sumRow.font = { bold: true }
    ws.getCell(`L${ws.lastRow!.number}`).numFmt = '#,##0'

    styleWorksheet(ws, 'Shinalar hisoboti')
    await send(wb, `shinalar-${new Date().toISOString().split('T')[0]}.xlsx`, res)
  } catch (err) { next(err) }
}

// ── Kafolatlar ───────────────────────────────────────────────────────────
export async function exportWarranties(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = applyBranchFilter(req)
    const warranties = await prisma.warranty.findMany({
      where: branchId ? { vehicle: { branchId } } : {},
      include: {
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
      },
      orderBy: { endDate: 'asc' },
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Kafolatlar')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Qism turi', key: 'partType', width: 18 },
      { header: 'Qism nomi', key: 'partName', width: 28 },
      { header: 'Avtomobil', key: 'vehicle', width: 22 },
      { header: 'Boshlanish', key: 'start', width: 14 },
      { header: 'Tugash', key: 'end', width: 14 },
      { header: 'Holat', key: 'status', width: 16 },
      { header: 'Qamrov turi', key: 'coverage', width: 16 },
      { header: 'Ta\'minlovchi', key: 'provider', width: 20 },
      { header: 'Km chegarasi', key: 'mileage', width: 14 },
      { header: 'Izoh', key: 'notes', width: 28 },
    ]

    const partTypeMap: Record<string, string> = { tire: 'Shina', spare_part: 'Ehtiyot qism', battery: 'Akkumlyator', vehicle: 'Avtomobil' }
    const statusMap: Record<string, string> = { active: 'Faol', expiring_soon: 'Tugayapti', expired: 'Tugagan', claimed: 'Talab qilingan' }
    const coverageMap: Record<string, string> = { full: 'To\'liq', limited: 'Cheklangan', partial: 'Qisman' }

    warranties.forEach((w, i) => ws.addRow({
      no: i + 1,
      partType: partTypeMap[w.partType] || w.partType,
      partName: w.partName,
      vehicle: w.vehicle ? `${w.vehicle.registrationNumber} ${w.vehicle.brand} ${w.vehicle.model}` : '—',
      start: new Date(w.startDate).toLocaleDateString('uz-UZ'),
      end: new Date(w.endDate).toLocaleDateString('uz-UZ'),
      status: statusMap[w.status] || w.status,
      coverage: coverageMap[w.coverageType] || w.coverageType,
      provider: w.provider || '—',
      mileage: w.mileageLimit ? Number(w.mileageLimit).toLocaleString() : '—',
      notes: w.notes || '',
    }))

    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', partType: `${warranties.length} ta kafolat`, partName: '', vehicle: '', start: '', end: '', status: '', coverage: '', provider: '', mileage: '', notes: '' })
    sumRow.font = { bold: true }

    styleWorksheet(ws, 'Kafolatlar hisoboti')
    await send(wb, `kafolatlar-${new Date().toISOString().split('T')[0]}.xlsx`, res)
  } catch (err) { next(err) }
}

export async function exportSuppliers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search, isActive } = req.query as any
    const where: any = {}
    if (search) {
      const variants = getSearchVariants(search)
      where.OR = variants.flatMap(v => [
        { name: { contains: v, mode: 'insensitive' } },
        { phone: { contains: v, mode: 'insensitive' } },
      ])
    }
    if (isActive !== undefined) where.isActive = isActive === 'true'

    const suppliers = await prisma.supplier.findMany({
      where,
      include: { _count: { select: { spareParts: true } } },
      orderBy: { name: 'asc' },
    })

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Yetkazuvchilar')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Nomi', key: 'name', width: 30 },
      { header: 'Kontakt shaxs', key: 'contactPerson', width: 22 },
      { header: 'Telefon', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'Manzil', key: 'address', width: 30 },
      { header: 'To\'lov shartlari', key: 'paymentTerms', width: 20 },
      { header: 'Ehtiyot qismlar', key: 'parts', width: 16 },
      { header: 'Holat', key: 'status', width: 12 },
    ]

    suppliers.forEach((s, i) => ws.addRow({
      no: i + 1,
      name: s.name,
      contactPerson: s.contactPerson || '—',
      phone: s.phone,
      email: s.email || '—',
      address: s.address || '—',
      paymentTerms: s.paymentTerms || '—',
      parts: s._count.spareParts,
      status: s.isActive ? 'Faol' : 'Nofaol',
    }))

    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', name: `${suppliers.length} ta yetkazuvchi` })
    sumRow.font = { bold: true }

    styleWorksheet(ws, 'Yetkazuvchilar hisoboti')
    await send(wb, `yetkazuvchilar-${new Date().toISOString().split('T')[0]}.xlsx`, res)
  } catch (err) { next(err) }
}

