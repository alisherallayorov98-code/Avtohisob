import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getSearchVariants, latinToCyrillic } from '../lib/transliterate'
import { getOrgFilter, applyBranchFilter, applyNarrowedBranchFilter, resolveOrgId } from '../lib/orgFilter'
import { isSimplifiedView } from '../services/orgSettingsService'
import { AppError } from '../middleware/errorHandler'

// ── i18n: Excel eksportda til ──────────────────────────────────────────────
// Foydalanuvchi ?lang=uz-cyrl bilan so'rasa, butun workbook kirillga
// transliteratsiya qilinadi. Default: uz (lotin) — eski xulq-atvor.
// RU/ZH uchun keyinchalik tarjima lug'ati qo'shiladi (Bosqich 2-3).
function getExportLang(req: AuthRequest): 'uz' | 'uz-cyrl' | 'ru' | 'zh' {
  const q = (req.query.lang as string)?.toLowerCase()
  if (q === 'uz-cyrl' || q === 'uz' || q === 'ru' || q === 'zh') return q as any
  return 'uz'
}

// Workbook'ni so'ralgan tilga moslashtirish.
// uz-cyrl uchun: hamma string cellalarni va sheet nomini lotinda kirillga.
// Eslatma: bu data values'ni ham transliterate qiladi (xuddi UI'da kabi —
// foydalanuvchi UZ-Krill rejimda hammasini kirill ko'rishni xohlaydi).
function localizeWorkbook(wb: ExcelJS.Workbook, lang: 'uz' | 'uz-cyrl' | 'ru' | 'zh') {
  if (lang !== 'uz-cyrl') return
  wb.eachSheet(ws => {
    // Sheet nomini transliteratsiya qilamiz (Excel sheet name 31 belgigacha)
    if (ws.name) {
      const cyrl = latinToCyrillic(ws.name)
      if (cyrl !== ws.name && cyrl.length <= 31) ws.name = cyrl
    }
    // Hamma cell'lardagi string qiymatlarni tekshiramiz
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const v = cell.value
        if (typeof v === 'string') {
          const cyrl = latinToCyrillic(v)
          if (cyrl !== v) cell.value = cyrl
        }
        // Boy text (ExcelJS rich text) yoki formula — tegmaymiz
      })
    })
  })
}

// Org-scoped branch filter for exports.
// - super_admin: optional ?branchId query narrows to that branch
// - org admin: optional ?branchId narrows within their org's branches
// - branch_manager/operator: always pinned to their own branch
// Returns undefined | string | { in: string[] } — use directly as branchId filter.
async function resolveBranchFilter(req: AuthRequest) {
  const filter = await getOrgFilter(req.user!)
  const requested = (req.query.branchId as string) || undefined
  return applyNarrowedBranchFilter(filter, requested)
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

function send(wb: ExcelJS.Workbook, filename: string, res: Response, req?: AuthRequest) {
  // Til so'ralgan bo'lsa workbook'ni transliteratsiya qilamiz (uz-cyrl uchun)
  if (req) {
    const lang = getExportLang(req)
    localizeWorkbook(wb, lang)
    // Fayl nomini ham mos tilga moslaymiz (uz-cyrl)
    if (lang === 'uz-cyrl') filename = latinToCyrillic(filename)
  }
  const encoded = encodeURIComponent(filename)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  // RFC 5987: supports non-ASCII filenames in all modern browsers
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`)
  return wb.xlsx.write(res).then(() => res.end())
}

export async function exportVehicles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = await resolveBranchFilter(req) as any
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
    await send(wb, 'avtomobillar.xlsx', res, req)
  } catch (err) {
    console.error('[exportVehicles]', err)
    next(err)
  }
}

// ── Per-mashina jami xarajat (ekrandagi "Mashinalar" tab bilan bir xil) ──────
export async function exportVehicleCosts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchId = await resolveBranchFilter(req) as any
    const dateFilter = from || to ? { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } : undefined
    const vBranchScope: any = branchId ? { vehicle: { branchId } } : {}
    const simplified = await isSimplifiedView(await resolveOrgId(req.user!))

    const [vehicles, fuelAgg, maintAgg, expAgg]: any[] = await Promise.all([
      prisma.vehicle.findMany({
        where: branchId ? { branchId } : {},
        include: { branch: { select: { name: true } } },
        orderBy: { registrationNumber: 'asc' },
      }),
      prisma.fuelRecord.groupBy({
        by: ['vehicleId'],
        where: { ...(dateFilter ? { refuelDate: dateFilter } : {}), ...vBranchScope },
        _sum: { cost: true },
      }),
      prisma.maintenanceRecord.groupBy({
        by: ['vehicleId'],
        where: { ...(dateFilter ? { installationDate: dateFilter } : {}), ...vBranchScope, ...(simplified ? { isOfficial: true } : {}) },
        _sum: { cost: true, laborCost: true },
      }),
      prisma.expense.groupBy({
        by: ['vehicleId'],
        where: { ...(dateFilter ? { expenseDate: dateFilter } : {}), ...vBranchScope, category: { name: { not: 'Texnik xizmat' } } },
        _sum: { amount: true },
      }),
    ])
    const fuelByV = new Map<string, number>(fuelAgg.map((a: any) => [a.vehicleId, Number(a._sum.cost) || 0]))
    const maintByV = new Map<string, number>(maintAgg.map((a: any) => [a.vehicleId, (Number(a._sum.cost) || 0) + (Number(a._sum.laborCost) || 0)]))
    const expByV = new Map<string, number>(expAgg.map((a: any) => [a.vehicleId, Number(a._sum.amount) || 0]))

    type Row = { reg: string; model: string; branch: string; fuel: number; maint: number; other: number; total: number; mileage: number }
    const rows: Row[] = (vehicles as any[]).map((v: any): Row => {
      const fuel = fuelByV.get(v.id) || 0
      const maint = maintByV.get(v.id) || 0
      const other = expByV.get(v.id) || 0
      return { reg: v.registrationNumber, model: `${v.brand} ${v.model}`, branch: v.branch?.name ?? '—', fuel, maint, other, total: fuel + maint + other, mileage: Number(v.mileage) }
    }).sort((a, b) => b.total - a.total)

    const gF = rows.reduce((s, r) => s + r.fuel, 0)
    const gM = rows.reduce((s, r) => s + r.maint, 0)
    const gO = rows.reduce((s, r) => s + r.other, 0)

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Mashina xarajatlari')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Raqam', key: 'reg', width: 15 },
      { header: 'Marka / model', key: 'model', width: 22 },
      { header: 'Filial', key: 'branch', width: 18 },
      { header: "Yoqilg'i (UZS)", key: 'fuel', width: 16 },
      { header: "Ta'mir (UZS)", key: 'maint', width: 16 },
      { header: 'Boshqa (UZS)', key: 'other', width: 14 },
      { header: 'JAMI (UZS)', key: 'total', width: 18 },
      { header: 'Yurish (km)', key: 'mileage', width: 14 },
    ]
    rows.forEach((r, i) => ws.addRow({ no: i + 1, ...r }))
    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', reg: '', model: `${rows.length} ta mashina`, branch: '', fuel: gF, maint: gM, other: gO, total: gF + gM + gO, mileage: '' })
    sumRow.font = { bold: true }
    sumRow.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } } })
    ;['fuel', 'maint', 'other', 'total'].forEach(k => { ws.getColumn(k).numFmt = '#,##0' })
    ws.getColumn('mileage').numFmt = '#,##0'
    styleWorksheet(ws, 'Mashina xarajatlari (jami)')
    await send(wb, `mashina-xarajatlari-${new Date().toISOString().split('T')[0]}.xlsx`, res, req)
  } catch (err) {
    console.error('[exportVehicleCosts]', err)
    next(err)
  }
}

export async function exportFuelRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchId = await resolveBranchFilter(req) as any
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
    await send(wb, 'yoqilgi-hisobot.xlsx', res, req)
  } catch (err) { next(err) }
}

// ── Ustalar hisobi: bajargan ish · to'langan · qarz ─────────────────────────
export async function exportMasters(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    const [masters, labor, payAgg] = await Promise.all([
      prisma.master.findMany({ where: orgId ? { organizationId: orgId } : {}, orderBy: { name: 'asc' } }),
      prisma.maintenanceRecord.groupBy({
        by: ['workerName'],
        where: { workerName: { not: null }, laborCost: { gt: 0 }, ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}) },
        _sum: { laborCost: true },
        _count: { _all: true },
      }),
      prisma.masterPayment.groupBy({ by: ['masterId'], _sum: { amount: true } }),
    ])

    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase()
    const laborMap = new Map<string, { work: number; count: number }>()
    for (const g of labor as any[]) {
      const key = norm(g.workerName)
      if (!key) continue
      const prev = laborMap.get(key) || { work: 0, count: 0 }
      prev.work += Number(g._sum.laborCost) || 0
      prev.count += g._count._all || 0
      laborMap.set(key, prev)
    }
    const paidMap = new Map<string, number>((payAgg as any[]).map(p => [p.masterId, Number(p._sum.amount) || 0]))

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Ustalar')
    ws.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Usta', key: 'name', width: 24 },
      { header: 'Telefon', key: 'phone', width: 16 },
      { header: 'Ishlar soni', key: 'count', width: 12 },
      { header: 'Bajargan ish (UZS)', key: 'work', width: 18 },
      { header: "To'langan (UZS)", key: 'paid', width: 18 },
      { header: 'Qarz (UZS)', key: 'balance', width: 18 },
    ]
    let gWork = 0, gPaid = 0
    masters.forEach((m, i) => {
      const l = laborMap.get(norm(m.name)) || { work: 0, count: 0 }
      const paid = paidMap.get(m.id) || 0
      gWork += l.work; gPaid += paid
      ws.addRow({ no: i + 1, name: m.name, phone: m.phone || '—', count: l.count, work: Math.round(l.work), paid: Math.round(paid), balance: Math.round(l.work - paid) })
    })
    ;['work', 'paid', 'balance'].forEach(k => { ws.getColumn(k).numFmt = '#,##0' })
    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', name: `${masters.length} ta usta`, phone: '', count: '', work: Math.round(gWork), paid: Math.round(gPaid), balance: Math.round(gWork - gPaid) })
    sumRow.font = { bold: true }
    sumRow.getCell('no').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }

    styleWorksheet(ws, 'Ustalar hisobi')
    await send(wb, 'ustalar-hisobi.xlsx', res, req)
  } catch (err) { next(err) }
}

// ── Bitta usta bo'yicha batafsil hisobot (xulosa + oylik + ishlar + to'lovlar) ──
export async function exportMaster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const master = await prisma.master.findUnique({
      where: { id: req.params.id },
      include: { payments: { orderBy: { paymentDate: 'desc' } } },
    })
    if (!master) throw new AppError('Usta topilmadi', 404)
    if (orgId && master.organizationId && master.organizationId !== orgId)
      throw new AppError("Bu ustaga kirish huquqingiz yo'q", 403)

    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const works = await prisma.maintenanceRecord.findMany({
      where: {
        workerName: { equals: master.name, mode: 'insensitive' },
        laborCost: { gt: 0 },
        ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}),
      },
      select: {
        installationDate: true, laborCost: true, notes: true, paymentType: true,
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
      },
      orderBy: { installationDate: 'desc' },
    })

    const totalWork = works.reduce((s, w) => s + Number(w.laborCost), 0)
    const totalPaid = master.payments.reduce((s, p) => s + Number(p.amount), 0)

    // Oylik kesim
    const byMonth = new Map<string, { work: number; count: number }>()
    for (const w of works) {
      const mKey = new Date(w.installationDate).toISOString().slice(0, 7)
      const prev = byMonth.get(mKey) || { work: 0, count: 0 }
      prev.work += Number(w.laborCost) || 0
      prev.count++
      byMonth.set(mKey, prev)
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'

    // 1) Xulosa
    const sum = wb.addWorksheet('Xulosa')
    sum.columns = [{ header: 'Ko\'rsatkich', key: 'k', width: 26 }, { header: 'Qiymat', key: 'v', width: 28 }]
    sum.addRow({ k: 'Usta', v: master.name })
    sum.addRow({ k: 'Telefon', v: master.phone || '—' })
    sum.addRow({ k: 'Ishlar soni', v: works.length })
    sum.addRow({ k: 'Bajargan ish (UZS)', v: Math.round(totalWork) })
    sum.addRow({ k: "To'langan (UZS)", v: Math.round(totalPaid) })
    sum.addRow({ k: 'Qarz (UZS)', v: Math.round(totalWork - totalPaid) })
    styleWorksheet(sum, `Usta hisobi — ${master.name}`)

    // 2) Oylik
    const mon = wb.addWorksheet('Oylik')
    mon.columns = [
      { header: 'Oy', key: 'month', width: 16 },
      { header: 'Ishlar soni', key: 'count', width: 14 },
      { header: 'Bajargan ish (UZS)', key: 'work', width: 20 },
    ]
    ;[...byMonth.entries()].sort(([a], [b]) => b.localeCompare(a)).forEach(([month, d]) => {
      mon.addRow({ month, count: d.count, work: Math.round(d.work) })
    })
    mon.getColumn('work').numFmt = '#,##0'
    styleWorksheet(mon, 'Oylik bajarilgan ish')

    // 3) Bajarilgan ishlar
    const wsW = wb.addWorksheet('Ishlar')
    wsW.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Mashina', key: 'vehicle', width: 28 },
      { header: 'Ish izohi', key: 'notes', width: 40 },
      { header: 'Usta haqi (UZS)', key: 'cost', width: 18 },
    ]
    works.forEach((w, i) => wsW.addRow({
      no: i + 1,
      date: new Date(w.installationDate).toISOString().split('T')[0],
      vehicle: w.vehicle ? `${w.vehicle.registrationNumber} (${w.vehicle.brand} ${w.vehicle.model})` : '—',
      notes: w.notes || '—',
      cost: Math.round(Number(w.laborCost)),
    }))
    wsW.getColumn('cost').numFmt = '#,##0'
    styleWorksheet(wsW, 'Bajarilgan ishlar')

    // 4) To'lovlar
    const wsP = wb.addWorksheet("To'lovlar")
    wsP.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Summa (UZS)', key: 'amount', width: 18 },
      { header: 'Usul', key: 'method', width: 12 },
      { header: 'Izoh', key: 'note', width: 30 },
    ]
    const methodLabel: Record<string, string> = { cash: 'Naqd', card: 'Karta', transfer: "O'tkazma" }
    master.payments.forEach((p, i) => wsP.addRow({
      no: i + 1,
      date: new Date(p.paymentDate).toISOString().split('T')[0],
      amount: Math.round(Number(p.amount)),
      method: methodLabel[p.method] || p.method,
      note: p.note || '—',
    }))
    wsP.getColumn('amount').numFmt = '#,##0'
    styleWorksheet(wsP, "To'lovlar tarixi")

    const safeName = master.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'usta'
    await send(wb, `usta-${safeName}-hisobot.xlsx`, res, req)
  } catch (err) { next(err) }
}

// ── Kunlik umumiy yoqilg'i (gaz zapravka cheki bilan solishtirish uchun) ──────
export async function exportFuelDaily(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const month = parseInt(String(req.query.month)) || (new Date().getMonth() + 1)
    const year = parseInt(String(req.query.year)) || new Date().getFullYear()
    const branchId = await resolveBranchFilter(req) as any

    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1)
    const records = await prisma.fuelRecord.findMany({
      where: { refuelDate: { gte: start, lt: end }, ...(branchId ? { vehicle: { branchId } } : {}) },
      select: { refuelDate: true, amountLiters: true, cost: true },
    })

    const daysInMonth = new Date(year, month, 0).getDate()
    const acc = Array.from({ length: daysInMonth }, () => ({ liters: 0, cost: 0, count: 0 }))
    records.forEach(r => {
      const idx = new Date(r.refuelDate).getDate() - 1
      if (idx < 0 || idx >= daysInMonth) return
      acc[idx].liters += Number(r.amountLiters)
      acc[idx].cost += Number(r.cost)
      acc[idx].count++
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    const ws = wb.addWorksheet('Kunlik yoqilg\'i')
    ws.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Miqdor (m3/L)', key: 'liters', width: 16 },
      { header: 'Summa (UZS)', key: 'cost', width: 18 },
      { header: 'Yozuvlar soni', key: 'count', width: 14 },
    ]
    acc.forEach((d, i) => ws.addRow({
      date: `${String(i + 1).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
      liters: Number(d.liters.toFixed(1)),
      cost: Math.round(d.cost),
      count: d.count,
    }))
    ws.getColumn('liters').numFmt = '#,##0.0'
    ws.getColumn('cost').numFmt = '#,##0'

    const totalLiters = acc.reduce((s, d) => s + d.liters, 0)
    const totalCost = acc.reduce((s, d) => s + d.cost, 0)
    const totalCount = acc.reduce((s, d) => s + d.count, 0)
    ws.addRow([])
    const sumRow = ws.addRow({ date: 'JAMI', liters: Number(totalLiters.toFixed(1)), cost: Math.round(totalCost), count: totalCount })
    sumRow.font = { bold: true }
    sumRow.getCell('date').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }

    styleWorksheet(ws, `Kunlik yoqilg'i — ${String(month).padStart(2, '0')}.${year}`)
    await send(wb, `kunlik-yoqilgi-${year}-${String(month).padStart(2, '0')}.xlsx`, res, req)
  } catch (err) { next(err) }
}

export async function exportMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchId = await resolveBranchFilter(req) as any
    const _simplified = await isSimplifiedView(await resolveOrgId(req.user!))
    const records = await prisma.maintenanceRecord.findMany({
      where: {
        ...(from || to ? { installationDate: { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } } : {}),
        ...(branchId ? { vehicle: { branchId } } : {}),
        ...(_simplified ? { isOfficial: true } : {}),
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
    await send(wb, 'texnik-xizmat.xlsx', res, req)
  } catch (err) { next(err) }
}

export async function exportInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Tenant scope: filter inventory to warehouses belonging to user's org branches
    const { getOrgWarehouseIds } = await import('../lib/orgFilter')
    const filter = await getOrgFilter(req.user!)
    const allowedWarehouses = filter.type !== 'none' ? await getOrgWarehouseIds(filter) : null
    const requestedWh = (req.query.warehouseId as string) || undefined

    let whereWh: any = {}
    if (allowedWarehouses) {
      if (requestedWh && allowedWarehouses.includes(requestedWh)) {
        whereWh = { warehouseId: requestedWh }
      } else {
        whereWh = { warehouseId: { in: allowedWarehouses.length ? allowedWarehouses : ['__no_match__'] } }
      }
    } else if (requestedWh) {
      whereWh = { warehouseId: requestedWh }
    }

    const items = await prisma.inventory.findMany({
      where: whereWh,
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
    await send(wb, 'ombor-hisoboti.xlsx', res, req)
  } catch (err) { next(err) }
}

export async function exportExpenses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchId = await resolveBranchFilter(req) as any
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
    await send(wb, 'xarajatlar.xlsx', res, req)
  } catch (err) { next(err) }
}

export async function exportBranches(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const where: any = filter.type === 'none'
      ? {}
      : filter.type === 'single'
        ? { id: filter.branchId }
        : { id: { in: filter.orgBranchIds } }
    const branches = await prisma.branch.findMany({
      where,
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
    await send(wb, 'filiallar.xlsx', res, req)
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
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)

    // Tenant: org admin sees only their org's vehicles; branch_manager/operator — only their branch.
    const { isBranchAllowed } = await import('../lib/orgFilter')
    const vfilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(vfilter, vehicle.branchId)) {
      throw new AppError('Boshqa filial avtomobiliga kirish taqiqlangan', 403)
    }

    const _simpVR = await isSimplifiedView(await resolveOrgId(req.user!))
    const [maintenance, fuelRecords, expenses] = await Promise.all([
      prisma.maintenanceRecord.findMany({
        where: {
          vehicleId: id,
          ...(dateRange ? { installationDate: dateRange } : {}),
          ...(_simpVR ? { isOfficial: true } : {}),
        },
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
    const lang = getExportLang(req)
    localizeWorkbook(wb, lang)
    const finalFilename = lang === 'uz-cyrl' ? latinToCyrillic(filename) : filename
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(finalFilename)}"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function export1CReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = await resolveBranchFilter(req) as any
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
          // 1C eksporti soliqchi tomonidan tekshiriladi — soddalashtirilgan rejimda
          // faqat rasmiy yozuvlar
          ...(await isSimplifiedView(await resolveOrgId(req.user!)) ? { isOfficial: true } : {}),
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
    const branchId = await resolveBranchFilter(req) as any
    const { from, to } = req.query
    const dateFilter = from || to ? { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } : undefined

    // Tenant-scoped filtrlar: inventory (warehouseId), sparePartStatistic (organizationId), branches (branchIds)
    const { getOrgWarehouseIds } = await import('../lib/orgFilter')
    const filter = await getOrgFilter(req.user!)
    const allowedWarehouses = filter.type !== 'none' ? await getOrgWarehouseIds(filter) : null
    const orgId = await resolveOrgId(req.user!)

    const inventoryWhere: any = allowedWarehouses
      ? { warehouseId: { in: allowedWarehouses.length ? allowedWarehouses : ['__no_match__'] } }
      : {}
    const statsWhere: any = orgId ? { organizationId: orgId } : {}
    const branchWhere: any = filter.type === 'none'
      ? {}
      : filter.type === 'single'
        ? { id: filter.branchId }
        : { id: { in: filter.orgBranchIds.length ? filter.orgBranchIds : ['__no_match__'] } }

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
          ...(await isSimplifiedView(await resolveOrgId(req.user!)) ? { isOfficial: true } : {}),
        },
        include: {
          vehicle: { select: { registrationNumber: true } },
          sparePart: { select: { name: true, partCode: true } },
        },
        orderBy: { installationDate: 'desc' },
        take: 1000,
      }),
      prisma.inventory.findMany({
        where: inventoryWhere,
        include: {
          sparePart: { select: { name: true, partCode: true, category: true, unitPrice: true } },
          warehouse: { select: { name: true } },
        },
      }),
      (prisma as any).sparePartStatistic.findMany({
        where: statsWhere,
        include: { sparePart: { select: { name: true, partCode: true, category: true } } },
        orderBy: { totalCost: 'desc' },
        take: 100,
      }),
      prisma.branch.findMany({
        where: branchWhere,
        select: { name: true, location: true, _count: { select: { vehicles: true } } },
      }),
    ])

    // ── Per-mashina jami xarajat (aniq agregat — groupBy, take limiti yo'q) ──
    // Yoqilg'i + Ta'mir (cost+laborCost) + Boshqa xarajat = Jami. Ekrandagi
    // "Mashinalar" tab bilan bir xil hisoblanadi.
    const simplifiedFR = await isSimplifiedView(orgId)
    const vBranchScope: any = branchId ? { vehicle: { branchId } } : {}
    const [fuelAgg, maintAgg, expAgg]: any[] = await Promise.all([
      prisma.fuelRecord.groupBy({
        by: ['vehicleId'],
        where: { ...(dateFilter ? { refuelDate: dateFilter } : {}), ...vBranchScope },
        _sum: { cost: true },
      }),
      prisma.maintenanceRecord.groupBy({
        by: ['vehicleId'],
        where: { ...(dateFilter ? { installationDate: dateFilter } : {}), ...vBranchScope, ...(simplifiedFR ? { isOfficial: true } : {}) },
        _sum: { cost: true, laborCost: true },
      }),
      prisma.expense.groupBy({
        by: ['vehicleId'],
        where: { ...(dateFilter ? { expenseDate: dateFilter } : {}), ...vBranchScope, category: { name: { not: 'Texnik xizmat' } } },
        _sum: { amount: true },
      }),
    ])
    const fuelByV = new Map<string, number>(fuelAgg.map((a: any) => [a.vehicleId, Number(a._sum.cost) || 0]))
    const maintByV = new Map<string, number>(maintAgg.map((a: any) => [a.vehicleId, (Number(a._sum.cost) || 0) + (Number(a._sum.laborCost) || 0)]))
    const expByV = new Map<string, number>(expAgg.map((a: any) => [a.vehicleId, Number(a._sum.amount) || 0]))

    type VCostRow = { reg: string; model: string; branch: string; fuel: number; maint: number; other: number; total: number }
    const perVehicle: VCostRow[] = (vehicles as any[]).map((v: any): VCostRow => {
      const fuel = fuelByV.get(v.id) || 0
      const maint = maintByV.get(v.id) || 0
      const other = expByV.get(v.id) || 0
      return {
        reg: v.registrationNumber,
        model: `${v.brand} ${v.model}`,
        branch: v.branch?.name ?? '—',
        fuel, maint, other, total: fuel + maint + other,
      }
    }).sort((a, b) => b.total - a.total)

    const grandFuel = perVehicle.reduce((s, r) => s + r.fuel, 0)
    const grandMaint = perVehicle.reduce((s, r) => s + r.maint, 0)
    const grandOther = perVehicle.reduce((s, r) => s + r.other, 0)
    const grandTotalCost = grandFuel + grandMaint + grandOther

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    wb.created = new Date()

    // ── Sheet 1: Summary ─────────────────────────────────────────────
    const wsSummary = wb.addWorksheet('Umumiy ma\'lumotnoma')
    wsSummary.columns = [{ width: 35 }, { width: 25 }]
    const totalInventoryVal = inventory.reduce((s: number, i: any) => s + i.quantityOnHand * Number(i.sparePart.unitPrice), 0)
    const periodLabel = from || to
      ? `${from ? new Date(from as string).toLocaleDateString('uz-UZ') : '...'} — ${to ? new Date(to as string).toLocaleDateString('uz-UZ') : '...'}`
      : 'Barcha davr'
    const summaryData = [
      ['Ko\'rsatkich', 'Qiymat'],
      ['Hisobot sanasi', new Date().toLocaleDateString('uz-UZ')],
      ['Hisobot davri', periodLabel],
      ['Jami avtomobillar', vehicles.length],
      ['Faol avtomobillar', vehicles.filter((v: any) => v.status === 'active').length],
      ['Jami filiallar', branches.length],
      ['Yoqilgi xarajati (UZS)', grandFuel],
      ["Ta'mirlash xarajati (UZS)", grandMaint],
      ['Boshqa xarajatlar (UZS)', grandOther],
      ['JAMI XARAJAT (UZS)', grandTotalCost],
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

    // ── Sheet 2: Mashina xarajatlari (jami) — rahbar uchun asosiy varaq ──
    const wsCosts = wb.addWorksheet('Mashina xarajatlari')
    wsCosts.columns = [
      { header: 'Mashina', key: 'reg', width: 16 },
      { header: 'Marka / model', key: 'model', width: 22 },
      { header: 'Filial', key: 'branch', width: 18 },
      { header: "Yoqilg'i (UZS)", key: 'fuel', width: 16 },
      { header: "Ta'mir (UZS)", key: 'maint', width: 16 },
      { header: 'Boshqa (UZS)', key: 'other', width: 14 },
      { header: 'JAMI (UZS)', key: 'total', width: 18 },
    ]
    perVehicle.forEach(r => wsCosts.addRow(r))
    // JAMI qatori
    const totalRow = wsCosts.addRow({ reg: 'JAMI', model: `${perVehicle.length} ta mashina`, branch: '', fuel: grandFuel, maint: grandMaint, other: grandOther, total: grandTotalCost })
    totalRow.font = { bold: true }
    totalRow.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } } })
    styleHeaderRow(wsCosts)
    styleDataRows(wsCosts, perVehicle.length)
    ;['fuel', 'maint', 'other', 'total'].forEach(k => { wsCosts.getColumn(k).numFmt = '#,##0' })
    wsCosts.views = [{ state: 'frozen', ySplit: 1 }]

    // ── Sheet 3: Vehicles ─────────────────────────────────────────────
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
    maintenance.forEach((r: any) => wsMaint.addRow({ vehicle: r.vehicle.registrationNumber, date: r.installationDate.toISOString().split('T')[0], part: r.sparePart?.name || '—', code: r.sparePart?.partCode || '—', qty: r.quantityUsed, cost: Number(r.cost) }))
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
    inventory.forEach((i: any) => wsInv.addRow({ branch: i.warehouse?.name ?? '—', part: i.sparePart.name, code: i.sparePart.partCode, cat: i.sparePart.category, qty: i.quantityOnHand, reorder: i.reorderLevel, price: Number(i.sparePart.unitPrice), total: i.quantityOnHand * Number(i.sparePart.unitPrice) }))
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

    const lang = getExportLang(req)
    localizeWorkbook(wb, lang)
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
    const orgId = await resolveOrgId(req.user!)
    const orgBlock = orgId ? { organizationId: orgId } : {}
    const parts = await (prisma as any).sparePart.findMany({
      where: {
        ...orgBlock,
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

    parts.forEach((p: any, i: number) => {
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
    await send(wb, `ehtiyot-qismlar-${new Date().toISOString().split('T')[0]}.xlsx`, res, req)
  } catch (err) { next(err) }
}

// ── O'tkazmalar (transferlar) ────────────────────────────────────────────
export async function exportTransfers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query
    const branchFilter = await resolveBranchFilter(req)
    let warehouseWhere: any = {}
    if (branchFilter) {
      // Scalar branchId → single warehouse; org-list → all warehouses in those branches
      const branchWhere = typeof branchFilter === 'string' ? { id: branchFilter } : { id: branchFilter }
      const branches = await prisma.branch.findMany({
        where: branchWhere,
        select: { warehouseId: true },
      })
      const warehouseIds = branches.map(b => b.warehouseId).filter((w): w is string => !!w)
      if (warehouseIds.length) {
        warehouseWhere = {
          OR: [
            { fromWarehouseId: { in: warehouseIds } },
            { toWarehouseId: { in: warehouseIds } },
          ],
        }
      } else {
        warehouseWhere = { id: '__no_match__' }
      }
    }
    const transfers = await prisma.inventoryTransfer.findMany({
      where: {
        ...(from || to ? { transferDate: { gte: from ? new Date(from as string) : undefined, lte: to ? new Date(to as string) : undefined } } : {}),
        ...warehouseWhere,
      },
      include: {
        sparePart: { select: { name: true, partCode: true } },
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
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
      from: t.fromWarehouse.name,
      to: t.toWarehouse.name,
      qty: t.quantity,
      status: statusMap[t.status] || t.status,
      approver: t.approvedBy?.fullName || '—',
    }))

    ws.addRow([])
    const sumRow = ws.addRow({ no: 'JAMI', date: '', part: `${transfers.length} ta o'tkazma`, code: '', from: '', to: '', qty: transfers.reduce((s, t) => s + t.quantity, 0), status: '', approver: '' })
    sumRow.font = { bold: true }

    styleWorksheet(ws, "O'tkazmalar hisoboti")
    await send(wb, `otkazmalar-${new Date().toISOString().split('T')[0]}.xlsx`, res, req)
  } catch (err) { next(err) }
}

// ── Shinalar ─────────────────────────────────────────────────────────────
export async function exportTires(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = await resolveBranchFilter(req) as any
    const tires = await (prisma as any).tire.findMany({
      where: branchId ? { branchId } : {},
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true } },
        supplier: { select: { name: true } },
        driver: { select: { fullName: true } },
        tireDeductions: { where: { isSettled: false }, select: { deductionAmount: true } },
      },
      orderBy: [{ status: 'asc' }, { vehicleId: 'asc' }, { position: 'asc' }],
    })

    // GPS km — installed shinalar uchun batch
    const installedTires = tires.filter((t: any) => t.status === 'installed' && t.vehicleId)
    const vehicleIds = [...new Set(installedTires.map((t: any) => t.vehicleId as string))]
    const gpsMap: Record<string, number> = {}
    for (const vid of vehicleIds) {
      const log = await (prisma as any).gpsMileageLog.findFirst({
        where: { vehicleId: vid, skipped: false },
        orderBy: { syncedAt: 'desc' },
      })
      if (log) gpsMap[String(vid)] = Number(log.gpsMileageKm)
    }

    const statusMap: Record<string, string> = {
      in_stock: 'Omborda', installed: "O'rnatilgan",
      returned: 'Qaytarilgan', written_off: 'Hisobdan chiqarilgan', damaged: 'Shikastlangan',
    }
    const condMap: Record<string, string> = {
      excellent: "A'lo", good: 'Yaxshi', fair: "O'rtacha", poor: 'Yomon', critical: 'Kritik', unknown: "Noma'lum",
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    const today = new Date().toLocaleDateString('uz-UZ')

    // ─── 1-varaq: O'rnatilgan shinalar (mashinalar bo'yicha) ──────────────
    const ws1 = wb.addWorksheet("O'rnatilgan shinalar")
    ws1.columns = [
      { header: '№',                    key: 'no',          width: 5  },
      { header: 'Avtomobil',            key: 'vehicle',     width: 22 },
      { header: 'Pozitsiya',            key: 'position',    width: 16 },
      { header: 'Serial kod',           key: 'serial',      width: 16 },
      { header: 'Brend / Model',        key: 'brand',       width: 18 },
      { header: "O'lcham",              key: 'size',        width: 14 },
      { header: "O'rnatilgan km",       key: 'installKm',   width: 16 },
      { header: 'GPS joriy km',         key: 'currentKm',   width: 16 },
      { header: 'GPS yurgan km',        key: 'gpsKm',       width: 16 },
      { header: 'Jami yurgan km',       key: 'totalKm',     width: 16 },
      { header: 'Norma km',             key: 'normKm',      width: 14 },
      { header: 'Norma %',              key: 'pct',         width: 10 },
      { header: 'Protector (mm)',       key: 'tread',       width: 14 },
      { header: 'Haydovchi',            key: 'driver',      width: 20 },
      { header: "O'rnatilgan sana",     key: 'installDate', width: 16 },
      { header: 'Narxi (UZS)',          key: 'price',       width: 16 },
    ]

    let n1 = 0
    for (const t of tires.filter((t: any) => t.status === 'installed')) {
      const curKm = gpsMap[t.vehicleId] ?? Number(t.vehicle?.mileage ?? 0)
      const installKm = t.installedMileageKm != null ? Number(t.installedMileageKm) : null
      const gpsKm = installKm != null ? Math.max(0, curKm - installKm) : null
      const totalKm = Number(t.totalMileage || 0) + (gpsKm ?? 0)
      const normKm = t.standardMileageKm || 40000
      const pct = Math.min(100, Math.round((totalKm / normKm) * 100))

      const row = ws1.addRow({
        no: ++n1,
        vehicle: t.vehicle ? `${t.vehicle.registrationNumber} — ${t.vehicle.brand} ${t.vehicle.model}` : '—',
        position: t.position || '—',
        serial: t.serialCode,
        brand: `${t.brand} ${t.model}`,
        size: t.size,
        installKm: installKm ?? '—',
        currentKm: curKm,
        gpsKm: gpsKm ?? '—',
        totalKm,
        normKm,
        pct,
        tread: t.currentTreadDepth ? Number(t.currentTreadDepth) : '—',
        driver: t.driver?.fullName || '—',
        installDate: t.installationDate ? new Date(t.installationDate).toLocaleDateString('uz-UZ') : '—',
        price: Number(t.purchasePrice),
      })

      // Rang: 90%+ qizil, 70-89% sariq
      const pctCell = row.getCell('pct')
      if (pct >= 90) {
        row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } } })
        pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEF4444' } }
        pctCell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      } else if (pct >= 70) {
        row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7E0' } } })
        pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } }
        pctCell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      }
    }

    ;['installKm','currentKm','gpsKm','totalKm','normKm','price'].forEach(k => {
      ws1.getColumn(k).numFmt = '#,##0'
    })
    ws1.getColumn('pct').numFmt = '0"%"'
    ws1.getColumn('tread').numFmt = '0.0'
    ws1.addRow([])
    const s1 = ws1.addRow({ no: 'JAMI', vehicle: `${n1} ta shina` })
    s1.font = { bold: true }
    styleWorksheet(ws1, `O'rnatilgan shinalar — ${today}`)

    // ─── 2-varaq: Barcha shinalar ─────────────────────────────────────────
    const ws2 = wb.addWorksheet('Barcha shinalar')
    ws2.columns = [
      { header: '№',              key: 'no',        width: 5  },
      { header: 'Unikal ID',      key: 'uid',       width: 18 },
      { header: 'Serial kod',     key: 'serial',    width: 16 },
      { header: 'Brend',          key: 'brand',     width: 14 },
      { header: 'Model',          key: 'model',     width: 14 },
      { header: "O'lcham",        key: 'size',      width: 14 },
      { header: 'Turi',           key: 'type',      width: 12 },
      { header: 'Holati',         key: 'status',    width: 16 },
      { header: 'Sifati',         key: 'condition', width: 12 },
      { header: 'Avtomobil',      key: 'vehicle',   width: 22 },
      { header: 'Pozitsiya',      key: 'position',  width: 14 },
      { header: 'Yurgan km',      key: 'mileage',   width: 14 },
      { header: 'Norma km',       key: 'normKm',    width: 14 },
      { header: 'Narxi (UZS)',    key: 'price',     width: 16 },
      { header: 'Xarid sanasi',   key: 'purchased', width: 14 },
      { header: 'Kafolat',        key: 'warranty',  width: 14 },
      { header: 'Yetkazuvchi',    key: 'supplier',  width: 18 },
    ]

    tires.forEach((t: any, i: number) => {
      const row = ws2.addRow({
        no: i + 1,
        uid: t.uniqueId,
        serial: t.serialCode,
        brand: t.brand,
        model: t.model,
        size: t.size,
        type: t.type,
        status: statusMap[t.status] || t.status,
        condition: condMap[t.condition || 'unknown'],
        vehicle: t.vehicle ? `${t.vehicle.registrationNumber} — ${t.vehicle.brand} ${t.vehicle.model}` : '—',
        position: t.position || '—',
        mileage: Number(t.totalMileage || 0),
        normKm: t.standardMileageKm || 40000,
        price: Number(t.purchasePrice),
        purchased: new Date(t.purchaseDate).toLocaleDateString('uz-UZ'),
        warranty: t.warrantyEndDate ? new Date(t.warrantyEndDate).toLocaleDateString('uz-UZ') : '—',
        supplier: t.supplier?.name || '—',
      })
      if (t.status === 'written_off') {
        row.eachCell(c => { c.font = { color: { argb: 'FF9CA3AF' }, italic: true } })
      }
    })

    ;['mileage','normKm','price'].forEach(k => ws2.getColumn(k).numFmt = '#,##0')
    ws2.addRow([])
    const s2 = ws2.addRow({
      no: 'JAMI', uid: `${tires.length} ta`,
      price: tires.reduce((s: number, t: any) => s + Number(t.purchasePrice), 0),
    })
    s2.font = { bold: true }
    ws2.getCell(`N${ws2.lastRow!.number}`).numFmt = '#,##0'
    styleWorksheet(ws2, `Barcha shinalar — ${today}`)

    // ─── 3-varaq: Xulosa statistika ───────────────────────────────────────
    const ws3 = wb.addWorksheet('Xulosa')
    ws3.getColumn('A').width = 32
    ws3.getColumn('B').width = 18

    const addStat = (label: string, value: any, bold = false, color?: string) => {
      const r = ws3.addRow([label, value])
      if (bold) r.font = { bold: true, size: 12 }
      if (color) r.getCell(2).font = { bold: true, color: { argb: color } }
    }

    const installed  = tires.filter((t: any) => t.status === 'installed')
    const inStock    = tires.filter((t: any) => t.status === 'in_stock')
    const returned   = tires.filter((t: any) => t.status === 'returned')
    const writtenOff = tires.filter((t: any) => t.status === 'written_off')
    const critical   = installed.filter((t: any) => {
      const curKm = gpsMap[t.vehicleId] ?? Number(t.vehicle?.mileage ?? 0)
      const installKm = t.installedMileageKm != null ? Number(t.installedMileageKm) : null
      const gpsKm = installKm != null ? Math.max(0, curKm - installKm) : 0
      const totalKm = Number(t.totalMileage || 0) + gpsKm
      return totalKm / (t.standardMileageKm || 40000) >= 0.9
    })
    const warning = installed.filter((t: any) => {
      const curKm = gpsMap[t.vehicleId] ?? Number(t.vehicle?.mileage ?? 0)
      const installKm = t.installedMileageKm != null ? Number(t.installedMileageKm) : null
      const gpsKm = installKm != null ? Math.max(0, curKm - installKm) : 0
      const totalKm = Number(t.totalMileage || 0) + gpsKm
      const pct = totalKm / (t.standardMileageKm || 40000)
      return pct >= 0.7 && pct < 0.9
    })

    const totalValue = tires.reduce((s: number, t: any) => s + Number(t.purchasePrice), 0)
    const pendingDeductions = tires.reduce((s: number, t: any) =>
      s + (t.tireDeductions || []).reduce((d: number, x: any) => d + Number(x.deductionAmount), 0), 0)

    ws3.addRow(['SHINALAR HISOBOTI', today]).font = { bold: true, size: 14 }
    ws3.addRow([])
    addStat('UMUMIY STATISTIKA', '', true)
    addStat('Jami shinalar', tires.length)
    addStat("O'rnatilgan", installed.length, false, 'FF16A34A')
    addStat('Omborda', inStock.length)
    addStat('Qaytarilgan', returned.length)
    addStat('Hisobdan chiqarilgan', writtenOff.length, false, 'FF9CA3AF')
    ws3.addRow([])
    addStat('HOLAT BO\'YICHA', '', true)
    addStat('⚠ Kritik (90%+ norma)', critical.length, false, 'FFEF4444')
    addStat('⚡ Diqqat (70-90% norma)', warning.length, false, 'FFF59E0B')
    addStat("✅ Normal (70% dan kam)", installed.length - critical.length - warning.length, false, 'FF16A34A')
    ws3.addRow([])
    addStat('MOLIYAVIY KO\'RSATKICHLAR', '', true)
    addStat("Jami shinalar qiymati (UZS)", totalValue)
    ws3.getCell(`B${ws3.lastRow!.number}`).numFmt = '#,##0'
    addStat("Ushlab qolinishi kerak (UZS)", pendingDeductions, false, 'FFEF4444')
    ws3.getCell(`B${ws3.lastRow!.number}`).numFmt = '#,##0'
    ws3.addRow([])
    addStat('Hisobot sanasi', today)

    styleWorksheet(ws3, 'Xulosa')

    await send(wb, `shinalar-hisoboti-${new Date().toISOString().split('T')[0]}.xlsx`, res, req)
  } catch (err) { next(err) }
}

// ── Kafolatlar ───────────────────────────────────────────────────────────
export async function exportWarranties(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = await resolveBranchFilter(req) as any
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
    await send(wb, `kafolatlar-${new Date().toISOString().split('T')[0]}.xlsx`, res, req)
  } catch (err) { next(err) }
}

export async function exportEngineMonitor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as any
    const filter = await getOrgFilter(req.user!)

    const vehicleWhere: any = { status: { not: 'inactive' } }
    if (filter.type === 'single') vehicleWhere.branchId = filter.branchId
    else if (filter.type === 'org') vehicleWhere.branchId = { in: filter.orgBranchIds }

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true },
      orderBy: { registrationNumber: 'asc' },
    })

    const vIds = vehicles.map(v => v.id)
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

    const [oilRecords, oilIntervals, engineRecords] = await Promise.all([
      prisma.maintenanceRecord.findMany({
        where: { vehicleId: { in: vIds }, isOil: true, installationDate: { gte: twelveMonthsAgo } },
        select: { id: true, vehicleId: true, installationDate: true, installationMileage: true, cost: true, oilLiters: true },
        orderBy: { installationDate: 'asc' },
      }),
      prisma.serviceInterval.findMany({
        where: { vehicleId: { in: vIds }, serviceType: 'oil_change' },
        select: { vehicleId: true, lastServiceKm: true, nextDueKm: true, status: true },
      }),
      (prisma as any).engineRecord.findMany({
        where: {
          vehicleId: { in: vIds },
          ...(from || to ? { date: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } } : {}),
        },
        select: { id: true, vehicleId: true, recordType: true, mileage: true, date: true, description: true, cost: true, performedBy: true },
        orderBy: { date: 'desc' },
      }),
    ])

    const TYPE_LABELS_EX: Record<string, string> = {
      overhaul: 'Kapital remont',
      major_repair: "Yirik ta'mirat",
      minor_repair: "Kichik ta'mirat",
      inspection: "Texnik ko'rik",
    }
    const FATIGUE_LABELS: Record<string, string> = { critical: 'Kritik', warning: 'Ogohlantirish', ok: 'Yaxshi' }

    // Build vehicle stats (same algorithm as getEngineDashboard)
    const stats = vehicles.map(v => {
      const vOilRecs = oilRecords.filter(r => r.vehicleId === v.id)
      const vEngRecs = engineRecords.filter((r: any) => r.vehicleId === v.id)

      const monthlyMap = new Map<string, { cost: number; liters: number }>()
      for (const r of vOilRecs) {
        const key = r.installationDate.toISOString().slice(0, 7)
        const cur = monthlyMap.get(key) || { cost: 0, liters: 0 }
        cur.cost += Number(r.cost); cur.liters += r.oilLiters ?? 0
        monthlyMap.set(key, cur)
      }
      const monthlyTrend = Array.from(monthlyMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, mv]) => ({ month, ...mv }))

      const totalCost12 = vOilRecs.reduce((s, r) => s + Number(r.cost), 0)
      const totalLiters12 = vOilRecs.reduce((s, r) => s + (r.oilLiters ?? 0), 0)
      const last3Avg = monthlyTrend.slice(-3).reduce((s, m) => s + m.cost, 0) / (monthlyTrend.slice(-3).length || 1)
      const prev3Avg = monthlyTrend.slice(-6, -3).reduce((s, m) => s + m.cost, 0) / (monthlyTrend.slice(-6, -3).length || 1)
      const trendPct = prev3Avg > 0 ? Math.round((last3Avg - prev3Avg) / prev3Avg * 100) : 0

      let consecutiveTrendMonths = 0
      for (let i = monthlyTrend.length - 1; i >= 1; i--) {
        if (monthlyTrend[i].cost > monthlyTrend[i - 1].cost) consecutiveTrendMonths++
        else break
      }

      const lastOverhaul = vEngRecs.find((r: any) => r.recordType === 'overhaul' || r.recordType === 'major_repair')
      const repairCount12m = vEngRecs.filter((r: any) => {
        const d = new Date(r.date)
        return d >= twelveMonthsAgo && (r.recordType === 'overhaul' || r.recordType === 'major_repair')
      }).length

      const oilInterval = oilIntervals.find(si => si.vehicleId === v.id)
      const nextOilServiceMileage = oilInterval?.nextDueKm != null ? Number(oilInterval.nextDueKm) : null
      const oilOverdueKm = nextOilServiceMileage !== null ? Math.round(Number(v.mileage) - nextOilServiceMileage) : null

      const firstOilMileage = vOilRecs.length > 0 ? Number(vOilRecs[0].installationMileage) : null
      const kmDriven = firstOilMileage != null ? Number(v.mileage) - firstOilMileage : 0
      const costPerKm = kmDriven > 500 && totalCost12 > 0 ? Math.round(totalCost12 / kmDriven) : null

      let fatigueScore = 0
      if (trendPct > 20) fatigueScore += 2; else if (trendPct > 10) fatigueScore += 1
      if (repairCount12m >= 2) fatigueScore += 3; else if (repairCount12m === 1) fatigueScore += 1
      if (oilOverdueKm !== null && oilOverdueKm > 0) fatigueScore += 2
      if (lastOverhaul && repairCount12m >= 1 && Number(v.mileage) - Number(lastOverhaul.mileage) > 100_000) fatigueScore += 2
      if (consecutiveTrendMonths >= 3) fatigueScore += 1
      const fatigueLevel = fatigueScore >= 6 ? 'critical' : fatigueScore >= 3 ? 'warning' : 'ok'

      return { v, totalCost12: Math.round(totalCost12), totalLiters12: Math.round(totalLiters12 * 10) / 10, trendPct, repairCount12m, nextOilServiceMileage, oilOverdueKm, costPerKm, fatigueLevel, fatigueScore, consecutiveTrendMonths, monthlyTrend, vEngRecs }
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'

    // ─── Sheet 1: Umumiy holat ────────────────────────────────────────────
    const ws1 = wb.addWorksheet('Umumiy holat')
    ws1.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Avtomobil', key: 'reg', width: 14 },
      { header: 'Marka/Model', key: 'brand', width: 18 },
      { header: 'Yurish (km)', key: 'mileage', width: 14 },
      { header: 'Holat', key: 'fatigue', width: 16 },
      { header: 'Ball', key: 'score', width: 8 },
      { header: "Yog' xarajati (12 oy)", key: 'oilCost', width: 22 },
      { header: "Yog' (litr, 12 oy)", key: 'oilLiters', width: 18 },
      { header: 'Trend (%)', key: 'trend', width: 12 },
      { header: '1 km xarajat (so\'m)', key: 'costPerKm', width: 20 },
      { header: 'Keyingi moy (km)', key: 'nextOil', width: 18 },
      { header: "O'tib ketgan (km)", key: 'overdue', width: 18 },
      { header: "Ta'mirlash (12 oy)", key: 'repairs', width: 18 },
    ]
    stats.forEach((s, i) => ws1.addRow({
      no: i + 1,
      reg: s.v.registrationNumber,
      brand: `${s.v.brand} ${s.v.model}`,
      mileage: Number(s.v.mileage),
      fatigue: FATIGUE_LABELS[s.fatigueLevel],
      score: s.fatigueScore,
      oilCost: s.totalCost12,
      oilLiters: s.totalLiters12,
      trend: s.trendPct,
      costPerKm: s.costPerKm ?? '—',
      nextOil: s.nextOilServiceMileage ?? '—',
      overdue: s.oilOverdueKm != null ? (s.oilOverdueKm > 0 ? `+${s.oilOverdueKm}` : s.oilOverdueKm) : '—',
      repairs: s.repairCount12m,
    }))
    ws1.getColumn('oilCost').numFmt = '#,##0'
    ws1.getColumn('costPerKm').numFmt = '#,##0'
    // Color critical/warning rows
    ws1.eachRow((row, rowNum) => {
      if (rowNum === 1) return
      const cell = row.getCell('fatigue')
      const val = cell.value as string
      if (val === 'Kritik') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCDD2' } }
      else if (val === 'Ogohlantirish') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } }
    })
    styleWorksheet(ws1, 'Dvigatel holati umumiy')

    // ─── Sheet 2: Dvigatel yozuvlari (overhaul, repair) ──────────────────
    const ws2 = wb.addWorksheet('Dvigatel yozuvlari')
    ws2.columns = [
      { header: '№', key: 'no', width: 6 },
      { header: 'Avtomobil', key: 'reg', width: 14 },
      { header: 'Tur', key: 'type', width: 18 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Yurish (km)', key: 'mileage', width: 14 },
      { header: 'Tavsif', key: 'desc', width: 40 },
      { header: 'Xarajat (so\'m)', key: 'cost', width: 18 },
      { header: 'Bajaruvchi', key: 'by', width: 22 },
    ]
    let rowIdx = 0
    for (const s of stats) {
      for (const r of s.vEngRecs) {
        rowIdx++
        ws2.addRow({
          no: rowIdx,
          reg: s.v.registrationNumber,
          type: TYPE_LABELS_EX[r.recordType] || r.recordType,
          date: new Date(r.date).toISOString().split('T')[0],
          mileage: Number(r.mileage),
          desc: r.description,
          cost: Number(r.cost),
          by: r.performedBy || '—',
        })
      }
    }
    ws2.getColumn('cost').numFmt = '#,##0'
    styleWorksheet(ws2, "Dvigatel ta'mir yozuvlari")

    // ─── Sheet 3: Oylik yog' sarfi trendi ────────────────────────────────
    const ws3 = wb.addWorksheet("Oylik yog' trendi")
    // Collect all unique months
    const allMonths = Array.from(new Set(stats.flatMap(s => s.monthlyTrend.map(m => m.month)))).sort()
    ws3.columns = [
      { header: 'Oy', key: 'month', width: 12 },
      ...stats.map(s => ({ header: s.v.registrationNumber, key: s.v.id, width: 18 })),
    ]
    for (const month of allMonths) {
      const row: any = { month }
      for (const s of stats) {
        const entry = s.monthlyTrend.find(m => m.month === month)
        row[s.v.id] = entry ? Math.round(entry.cost) : 0
      }
      ws3.addRow(row)
    }
    // Format all vehicle columns as currency
    stats.forEach(s => {
      const col = ws3.getColumn(s.v.id)
      if (col) col.numFmt = '#,##0'
    })
    styleWorksheet(ws3, "Oylik yog' sarfi trendi")

    await send(wb, `dvigatel-nazorati-${new Date().toISOString().split('T')[0]}.xlsx`, res, req)
  } catch (err) { next(err) }
}

export async function exportSuppliers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search, isActive } = req.query as any
    const orgId = await resolveOrgId(req.user!)
    const and: any[] = []
    if (orgId) and.push({ organizationId: orgId })
    if (search) {
      const variants = getSearchVariants(search)
      and.push({
        OR: variants.flatMap(v => [
          { name: { contains: v, mode: 'insensitive' } },
          { phone: { contains: v, mode: 'insensitive' } },
        ]),
      })
    }
    if (isActive !== undefined) and.push({ isActive: isActive === 'true' })
    const where: any = and.length ? { AND: and } : {}

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
    await send(wb, `yetkazuvchilar-${new Date().toISOString().split('T')[0]}.xlsx`, res, req)
  } catch (err) { next(err) }
}

