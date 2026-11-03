import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getOrgFilter, applyNarrowedBranchFilter } from '../lib/orgFilter'
import { computeTireUsage, levelForPct, UsageLevel } from '../lib/tireUsage'
import { send } from './exports'

// ── Palitra ────────────────────────────────────────────────────────────────
const C = {
  ink: 'FF0F172A', slate: 'FF1E293B', mute: 'FF64748B', soft: 'FF94A3B8',
  line: 'FFE2E8F0', zebra: 'FFF8FAFC', white: 'FFFFFFFF', group: 'FFEFF6FF',
  green: 'FF16A34A', amber: 'FFF59E0B', red: 'FFDC2626', blue: 'FF2563EB',
}
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const border = (argb = C.line): Partial<ExcelJS.Borders> => ({
  top: { style: 'thin', color: { argb } }, bottom: { style: 'thin', color: { argb } },
  left: { style: 'thin', color: { argb } }, right: { style: 'thin', color: { argb } },
})

const EVENT_META: Record<string, { label: string; bg: string; fg: string }> = {
  installed: { label: "O'rnatildi", bg: 'FFDCFCE7', fg: 'FF166534' },
  removed: { label: 'Olib olindi', bg: 'FFFFEDD5', fg: 'FF9A3412' },
  returned: { label: 'Qaytarildi', bg: 'FFE0F2FE', fg: 'FF075985' },
  written_off: { label: 'Hisobdan chiqarildi', bg: 'FFFEE2E2', fg: 'FF991B1B' },
  purchased: { label: 'Tizimga kiritildi', bg: 'FFF1F5F9', fg: 'FF475569' },
  deduction_applied: { label: 'Ushlab qolish', bg: 'FFFEF9C3', fg: 'FF854D0E' },
}
const STATUS_UZ: Record<string, string> = {
  in_stock: 'Omborda', installed: "O'rnatilgan", returned: 'Qaytarilgan',
  written_off: 'Hisobdan chiqarilgan', damaged: 'Shikastlangan',
}
const COND_UZ: Record<string, string> = {
  excellent: "A'lo", good: 'Yaxshi', fair: "O'rtacha", poor: 'Yomon', critical: 'Kritik', unknown: "Noma'lum",
}
const POSITION_UZ: Record<string, string> = {
  'Front-Left': 'Old chap', 'Front-Right': "Old o'ng", 'Rear-Left': 'Orqa chap', 'Rear-Right': "Orqa o'ng",
}
const LEVEL_COLOR: Record<UsageLevel, string> = { ok: C.green, warning: C.amber, critical: C.red }
const LEVEL_UZ: Record<UsageLevel, string> = { ok: 'Yaxshi', warning: 'Diqqat', critical: 'Almashtirish' }

const posUz = (p?: string | null) => (p ? POSITION_UZ[p] || p : '—')
const bar = (pct: number) => {
  const n = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return '█'.repeat(n) + '░'.repeat(10 - n)
}
const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
const ddmmyyyy = (d: Date) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
const vName = (v?: { registrationNumber: string; brand?: string; model?: string } | null) =>
  v ? `${v.registrationNumber}${v.brand ? ` — ${v.brand} ${v.model || ''}`.trimEnd() : ''}` : '—'

// ── Uslub yordamchilari ────────────────────────────────────────────────────
function banner(ws: ExcelJS.Worksheet, title: string, subtitle: string, cols: number) {
  ws.mergeCells(1, 1, 1, cols)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = { bold: true, size: 18, color: { argb: C.white } }
  t.fill = fill(C.slate)
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(1).height = 38
  ws.mergeCells(2, 1, 2, cols)
  const s = ws.getCell(2, 1)
  s.value = subtitle
  s.font = { size: 10, color: { argb: C.soft }, italic: true }
  s.fill = fill(C.slate)
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(2).height = 20
}

function headerRow(ws: ExcelJS.Worksheet, rowNo: number, headers: string[]) {
  const row = ws.getRow(rowNo)
  headers.forEach((h, i) => {
    const c = row.getCell(i + 1)
    c.value = h
    c.font = { bold: true, size: 10, color: { argb: C.white } }
    c.fill = fill(C.blue)
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = border(C.blue)
  })
  row.height = 28
}

function styleBodyRow(row: ExcelJS.Row, zebra: boolean, cols: number) {
  for (let i = 1; i <= cols; i++) {
    const c = row.getCell(i)
    c.border = border()
    if (zebra && !c.fill) c.fill = fill(C.zebra)
    c.alignment = { vertical: 'middle', ...(c.alignment || {}) }
  }
  row.height = 20
}

function setupSheet(ws: ExcelJS.Worksheet, widths: number[], freezeRow: number, headerRowNo: number, landscape = true) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  ws.views = [{ state: 'frozen', ySplit: freezeRow, showGridLines: false }]
  ws.pageSetup = { orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: widths.length } }
}

// ── Asosiy eksport ─────────────────────────────────────────────────────────
export async function exportTireReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const branchId = applyNarrowedBranchFilter(filter, (req.query.branchId as string) || undefined) as any
    const fromQ = req.query.from as string | undefined
    const toQ = req.query.to as string | undefined
    const from = fromQ ? new Date(fromQ) : undefined
    const to = toQ ? new Date(`${toQ}T23:59:59.999`) : undefined
    const hasPeriod = !!(from || to)

    const [tires, vehicles] = await Promise.all([
      (prisma as any).tire.findMany({
        where: branchId ? { branchId } : {},
        include: {
          vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true } },
          supplier: { select: { name: true } },
          driver: { select: { fullName: true } },
          tireDeductions: { where: { isSettled: false }, select: { deductionAmount: true } },
        },
        orderBy: [{ status: 'asc' }, { serialCode: 'asc' }],
      }),
      (prisma as any).vehicle.findMany({
        where: branchId ? { branchId } : {},
        select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true },
        orderBy: { registrationNumber: 'asc' },
      }),
    ])

    const tireScope = branchId ? { tire: { branchId } } : {}
    const [periodEvents, pathEvents] = await Promise.all([
      (prisma as any).tireEvent.findMany({
        where: { ...tireScope, ...(hasPeriod ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
        include: { tire: { select: { serialCode: true, brand: true, model: true, size: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      (prisma as any).tireEvent.findMany({
        where: { ...tireScope, eventType: 'installed' },
        select: { tireId: true, vehicleId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const userIds = [...new Set(periodEvents.map((e: any) => e.createdById).filter(Boolean))] as string[]
    const users = userIds.length
      ? await (prisma as any).user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
      : []
    const userName = new Map<string, string>(users.map((u: any) => [u.id, u.fullName]))
    const vehicleById = new Map<string, any>(vehicles.map((v: any) => [v.id, v]))
    const plate = (id?: string | null) => (id ? vehicleById.get(id)?.registrationNumber || '—' : '—')

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    wb.created = new Date()
    const today = new Date()
    const periodText = hasPeriod
      ? `Davr: ${from ? ddmmyyyy(from) : '…'} — ${to ? ddmmyyyy(to) : '…'}`
      : 'Davr: barcha vaqt'
    const subtitle = `${periodText}   ·   Hisobot sanasi: ${ddmmyyyy(today)} ${hhmm(today)}`

    // Foydalanish ma'lumoti (o'rnatilgan shinalar)
    const installed = tires.filter((t: any) => t.status === 'installed')
    const usageOf = (t: any) => computeTireUsage(t, t.vehicle?.mileage != null ? Number(t.vehicle.mileage) : null)
    const usageMap = new Map<string, ReturnType<typeof usageOf>>(installed.map((t: any) => [t.id, usageOf(t)]))
    const count = (lvl: UsageLevel) => installed.filter((t: any) => usageMap.get(t.id)!.level === lvl).length

    // ─── 1) Xulosa ─────────────────────────────────────────────────────────
    const ws1 = wb.addWorksheet('Xulosa', { properties: { tabColor: { argb: C.blue } } })
    const COLS1 = 14
    banner(ws1, 'SHINALAR HISOBOTI', subtitle, COLS1)
    for (let i = 1; i <= COLS1; i++) ws1.getColumn(i).width = 11
    ws1.views = [{ showGridLines: false }]

    const tile = (idx: number, label: string, value: number | string, color: string) => {
      const c1 = idx * 2 + 1
      ws1.mergeCells(4, c1, 4, c1 + 1)
      ws1.mergeCells(5, c1, 5, c1 + 1)
      const l = ws1.getCell(4, c1)
      l.value = label
      l.font = { size: 9, bold: true, color: { argb: C.mute } }
      l.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      const v = ws1.getCell(5, c1)
      v.value = value
      v.font = { size: 22, bold: true, color: { argb: color } }
      v.alignment = { horizontal: 'center', vertical: 'middle' }
      v.numFmt = '#,##0'
      for (let c = c1; c <= c1 + 1; c++) {
        for (const r of [4, 5]) {
          const cell = ws1.getCell(r, c)
          cell.fill = fill(C.zebra)
          cell.border = {
            top: r === 4 ? { style: 'medium', color: { argb: color } } : { style: 'thin', color: { argb: C.line } },
            bottom: r === 5 ? { style: 'thin', color: { argb: C.line } } : undefined,
            left: c === c1 ? { style: 'thin', color: { argb: C.line } } : undefined,
            right: c === c1 + 1 ? { style: 'thin', color: { argb: C.line } } : undefined,
          }
        }
      }
    }
    ws1.getRow(4).height = 24
    ws1.getRow(5).height = 42
    tile(0, 'JAMI SHINALAR', tires.length, C.slate)
    tile(1, "O'RNATILGAN", installed.length, C.green)
    tile(2, 'OMBORDA', tires.filter((t: any) => t.status === 'in_stock').length, C.blue)
    tile(3, 'QAYTARILGAN', tires.filter((t: any) => t.status === 'returned').length, C.mute)
    tile(4, 'DIQQAT (70–89%)', count('warning'), C.amber)
    tile(5, 'ALMASHTIRISH (90%+)', count('critical'), C.red)
    tile(6, 'HISOBDAN CHIQQAN', tires.filter((t: any) => t.status === 'written_off').length, C.soft)

    // Davr harakatlari
    const evCount = (type: string) => periodEvents.filter((e: any) => e.eventType === type).length
    let r = 7
    ws1.mergeCells(r, 1, r, COLS1)
    const h1 = ws1.getCell(r, 1)
    h1.value = hasPeriod ? 'DAVR ICHIDAGI HARAKATLAR' : 'HARAKATLAR (barcha vaqt)'
    h1.font = { bold: true, size: 11, color: { argb: C.slate } }
    h1.border = { bottom: { style: 'medium', color: { argb: C.blue } } }
    r++
    for (const [label, type] of [["O'rnatildi", 'installed'], ['Olib olindi', 'removed'], ['Hisobdan chiqarildi', 'written_off'], ['Tizimga kiritildi', 'purchased']] as const) {
      ws1.mergeCells(r, 1, r, 4)
      ws1.mergeCells(r, 5, r, 6)
      const m = EVENT_META[type]
      const a = ws1.getCell(r, 1)
      a.value = label
      a.font = { color: { argb: m.fg }, bold: true }
      a.fill = fill(m.bg)
      const b = ws1.getCell(r, 5)
      b.value = evCount(type)
      b.font = { bold: true, size: 12 }
      b.alignment = { horizontal: 'center' }
      b.numFmt = '#,##0'
      r++
    }

    // Moliya
    r++
    ws1.mergeCells(r, 1, r, COLS1)
    const h2 = ws1.getCell(r, 1)
    h2.value = "MOLIYAVIY KO'RSATKICHLAR"
    h2.font = { bold: true, size: 11, color: { argb: C.slate } }
    h2.border = { bottom: { style: 'medium', color: { argb: C.blue } } }
    r++
    const totalValue = tires.reduce((s: number, t: any) => s + Number(t.purchasePrice || 0), 0)
    const pending = tires.reduce((s: number, t: any) => s + (t.tireDeductions || []).reduce((d: number, x: any) => d + Number(x.deductionAmount), 0), 0)
    for (const [label, val, color] of [['Jami shinalar qiymati (UZS)', totalValue, C.ink], ['Ushlab qolinishi kerak (UZS)', pending, pending > 0 ? C.red : C.ink]] as const) {
      ws1.mergeCells(r, 1, r, 4)
      ws1.mergeCells(r, 5, r, 7)
      ws1.getCell(r, 1).value = label
      const v = ws1.getCell(r, 5)
      v.value = val
      v.numFmt = '#,##0'
      v.font = { bold: true, size: 12, color: { argb: color } }
      v.alignment = { horizontal: 'right' }
      r++
    }

    // Eng ko'p e'tibor talab qiladigan shinalar
    r++
    ws1.mergeCells(r, 1, r, COLS1)
    const h3 = ws1.getCell(r, 1)
    h3.value = "ENG KO'P YURGAN SHINALAR (TOP 10)"
    h3.font = { bold: true, size: 11, color: { argb: C.slate } }
    h3.border = { bottom: { style: 'medium', color: { argb: C.blue } } }
    r++
    const topHeads = ['Shina raqami', '', 'Mashina', '', '', 'Joyi', '', 'Yurgan km', '', 'Norma', 'Foydalanish', '', '', '']
    topHeads.forEach((h, i) => {
      const c = ws1.getCell(r, i + 1)
      c.value = h || null
      c.font = { bold: true, size: 9, color: { argb: C.white } }
      c.fill = fill(C.slate)
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    ws1.mergeCells(r, 1, r, 2); ws1.mergeCells(r, 3, r, 5); ws1.mergeCells(r, 6, r, 7)
    ws1.mergeCells(r, 8, r, 9); ws1.mergeCells(r, 11, r, 14)
    r++
    const top = [...installed].sort((a: any, b: any) => usageMap.get(b.id)!.pct - usageMap.get(a.id)!.pct).slice(0, 10)
    top.forEach((t: any, i: number) => {
      const u = usageMap.get(t.id)!
      ws1.mergeCells(r, 1, r, 2); ws1.mergeCells(r, 3, r, 5); ws1.mergeCells(r, 6, r, 7)
      ws1.mergeCells(r, 8, r, 9); ws1.mergeCells(r, 11, r, 14)
      ws1.getCell(r, 1).value = t.serialCode
      ws1.getCell(r, 1).font = { bold: true, name: 'Consolas' }
      ws1.getCell(r, 3).value = vName(t.vehicle)
      ws1.getCell(r, 6).value = posUz(t.position)
      ws1.getCell(r, 8).value = u.usedKm
      ws1.getCell(r, 8).numFmt = '#,##0'
      ws1.getCell(r, 10).value = u.normKm
      ws1.getCell(r, 10).numFmt = '#,##0'
      const pc = ws1.getCell(r, 11)
      pc.value = `${bar(u.pct)}  ${u.pct}%`
      pc.font = { bold: true, color: { argb: LEVEL_COLOR[u.level] } }
      for (let c = 1; c <= COLS1; c++) {
        const cell = ws1.getCell(r, c)
        cell.border = border()
        if (i % 2 === 1) cell.fill = fill(C.zebra)
        cell.alignment = { vertical: 'middle', horizontal: c === 1 || c === 3 ? 'left' : 'center' }
      }
      r++
    })
    ws1.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }

    // ─── 2) Mashinalar (guruhlangan) ───────────────────────────────────────
    const ws2 = wb.addWorksheet('Mashinalar', { properties: { tabColor: { argb: C.green } } })
    const H2 = ['Joyi', 'Shina raqami', 'Brend / model', "O'lcham", "O'rnatilgan sana", "O'rnatilgan km", 'Hozirgi km', "O'rnatilganidan beri", 'Jami yurgan km', 'Norma km', 'Foydalanish', 'Holat']
    banner(ws2, 'MASHINALAR BO\'YICHA SHINALAR', subtitle, H2.length)
    headerRow(ws2, 4, H2)
    let row2 = 5
    const installedByVehicle = new Map<string, any[]>()
    for (const t of installed) {
      const list = installedByVehicle.get(t.vehicleId) || []
      list.push(t)
      installedByVehicle.set(t.vehicleId, list)
    }
    const withTires = vehicles.filter((v: any) => installedByVehicle.has(v.id))
    const withoutTires = vehicles.filter((v: any) => !installedByVehicle.has(v.id))
    for (const v of withTires) {
      const list = installedByVehicle.get(v.id)!
      ws2.mergeCells(row2, 1, row2, H2.length)
      const g = ws2.getCell(row2, 1)
      g.value = `${v.registrationNumber}  ·  ${v.brand} ${v.model}  ·  hozirgi km: ${Math.round(Number(v.mileage) || 0).toLocaleString('en-US').replace(/,/g, ' ')}  ·  ${list.length} ta shina`
      g.font = { bold: true, size: 11, color: { argb: C.slate } }
      g.fill = fill(C.group)
      g.alignment = { vertical: 'middle', indent: 1 }
      g.border = { top: { style: 'thin', color: { argb: C.blue } }, bottom: { style: 'thin', color: { argb: C.line } } }
      ws2.getRow(row2).height = 24
      row2++
      list.forEach((t: any, i: number) => {
        const u = usageMap.get(t.id)!
        const rw = ws2.getRow(row2)
        rw.getCell(1).value = posUz(t.position)
        rw.getCell(2).value = t.serialCode
        rw.getCell(2).font = { bold: true, name: 'Consolas', color: { argb: C.blue } }
        rw.getCell(3).value = `${t.brand} ${t.model}`.replace("Noma'lum Noma'lum", "Noma'lum")
        rw.getCell(4).value = t.size === "Noma'lum" || t.size === 'N/A' ? '—' : t.size
        rw.getCell(5).value = t.installationDate ? new Date(t.installationDate) : null
        rw.getCell(5).numFmt = 'dd.mm.yyyy'
        rw.getCell(6).value = t.installedMileageKm != null ? Number(t.installedMileageKm) : null
        rw.getCell(7).value = Math.round(Number(v.mileage) || 0)
        rw.getCell(8).value = u.drivenSinceInstallKm
        rw.getCell(9).value = u.usedKm
        rw.getCell(10).value = u.normKm
        for (const c of [6, 7, 8, 9, 10]) rw.getCell(c).numFmt = '#,##0'
        const pc = rw.getCell(11)
        pc.value = `${bar(u.pct)}  ${u.pct}%`
        pc.font = { bold: true, color: { argb: LEVEL_COLOR[u.level] } }
        const st = rw.getCell(12)
        st.value = LEVEL_UZ[u.level]
        st.font = { bold: true, color: { argb: C.white } }
        st.fill = fill(LEVEL_COLOR[u.level])
        st.alignment = { horizontal: 'center', vertical: 'middle' }
        styleBodyRow(rw, i % 2 === 1, H2.length)
        for (const c of [1, 5, 6, 7, 8, 9, 10, 11]) rw.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' }
        row2++
      })
    }
    if (withoutTires.length) {
      row2++
      ws2.mergeCells(row2, 1, row2, H2.length)
      const g = ws2.getCell(row2, 1)
      g.value = `SHINASI YOZILMAGAN MASHINALAR (${withoutTires.length} ta)`
      g.font = { bold: true, size: 11, color: { argb: C.red } }
      g.fill = fill('FFFEF2F2')
      g.alignment = { vertical: 'middle', indent: 1 }
      ws2.getRow(row2).height = 24
      row2++
      for (const v of withoutTires) {
        ws2.mergeCells(row2, 1, row2, 4)
        const a = ws2.getCell(row2, 1)
        a.value = `${v.registrationNumber} — ${v.brand} ${v.model}`
        a.font = { color: { argb: C.mute } }
        ws2.getCell(row2, 5).value = 'shina raqami kiritilmagan'
        ws2.getCell(row2, 5).font = { italic: true, color: { argb: C.soft } }
        ws2.mergeCells(row2, 5, row2, H2.length)
        row2++
      }
    }
    setupSheet(ws2, [14, 18, 22, 14, 15, 15, 14, 17, 15, 12, 22, 14], 4, 4)

    // ─── 3) Harakatlar jurnali ─────────────────────────────────────────────
    const ws3 = wb.addWorksheet('Harakatlar', { properties: { tabColor: { argb: C.amber } } })
    const H3 = ['Sana', 'Vaqt', 'Voqea', 'Shina raqami', 'Brend / model', 'Mashina', 'Joyi', 'Km (odometr)', 'Bajargan', 'Izoh']
    banner(ws3, 'SHINALAR HARAKATI JURNALI', `${subtitle}   ·   ${periodEvents.length} ta yozuv${periodEvents.length >= 5000 ? ' (oxirgi 5000 ta)' : ''}`, H3.length)
    headerRow(ws3, 4, H3)
    periodEvents.forEach((e: any, i: number) => {
      const rw = ws3.getRow(5 + i)
      const d = new Date(e.createdAt)
      const m = EVENT_META[e.eventType] || { label: e.eventType, bg: 'FFF1F5F9', fg: 'FF475569' }
      rw.getCell(1).value = d
      rw.getCell(1).numFmt = 'dd.mm.yyyy'
      rw.getCell(2).value = hhmm(d)
      const ev = rw.getCell(3)
      ev.value = m.label
      ev.font = { bold: true, color: { argb: m.fg } }
      ev.fill = fill(m.bg)
      ev.alignment = { horizontal: 'center', vertical: 'middle' }
      rw.getCell(4).value = e.tire?.serialCode || '—'
      rw.getCell(4).font = { bold: true, name: 'Consolas', color: { argb: C.blue } }
      rw.getCell(5).value = e.tire ? `${e.tire.brand} ${e.tire.model}`.replace("Noma'lum Noma'lum", "Noma'lum") : '—'
      rw.getCell(6).value = vName(e.vehicleId ? vehicleById.get(e.vehicleId) : null)
      rw.getCell(7).value = posUz(e.position)
      rw.getCell(8).value = e.mileageAtEvent != null ? Number(e.mileageAtEvent) : null
      rw.getCell(8).numFmt = '#,##0'
      rw.getCell(9).value = e.createdById ? userName.get(e.createdById) || '—' : '—'
      rw.getCell(10).value = e.notes || ''
      styleBodyRow(rw, i % 2 === 1, H3.length)
      for (const c of [1, 2, 7, 8]) rw.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' }
      rw.getCell(10).alignment = { vertical: 'middle', wrapText: true }
    })
    if (!periodEvents.length) {
      ws3.mergeCells(5, 1, 5, H3.length)
      ws3.getCell(5, 1).value = "Tanlangan davrda harakat yozuvlari yo'q"
      ws3.getCell(5, 1).font = { italic: true, color: { argb: C.mute } }
      ws3.getCell(5, 1).alignment = { horizontal: 'center' }
    }
    setupSheet(ws3, [12, 8, 20, 18, 22, 28, 13, 14, 20, 44], 4, 4)

    // ─── 4) Shina yo'li ────────────────────────────────────────────────────
    const ws4 = wb.addWorksheet("Shina yo'li", { properties: { tabColor: { argb: 'FF8B5CF6' } } })
    const H4 = ['Shina raqami', 'Brend / model', 'Holati', 'Hozirgi joyi', "Birinchi o'rnatilgan", "O'rnatishlar soni", 'Mashinalar soni', "Mashinalar yo'li (sanasi bilan)", 'Jami yurgan km', 'Norma %']
    banner(ws4, "HAR BIR SHINA YO'LI", `${subtitle}   ·   shina qaysi mashinalarda bo'lgani`, H4.length)
    headerRow(ws4, 4, H4)
    const installsByTire = new Map<string, any[]>()
    for (const e of pathEvents) {
      const list = installsByTire.get(e.tireId) || []
      list.push(e)
      installsByTire.set(e.tireId, list)
    }
    const tiresSorted = [...tires].sort((a: any, b: any) => {
      const rank = (t: any) => (t.status === 'installed' ? 0 : t.status === 'in_stock' ? 1 : t.status === 'returned' ? 2 : 3)
      return rank(a) - rank(b) || String(a.serialCode).localeCompare(String(b.serialCode))
    })
    tiresSorted.forEach((t: any, i: number) => {
      const rw = ws4.getRow(5 + i)
      const inst = installsByTire.get(t.id) || []
      const uniqVeh = new Set(inst.map((e: any) => e.vehicleId).filter(Boolean))
      const u = t.status === 'installed' ? usageMap.get(t.id)! : computeTireUsage(t, null)
      rw.getCell(1).value = t.serialCode
      rw.getCell(1).font = { bold: true, name: 'Consolas', color: { argb: C.blue } }
      rw.getCell(2).value = `${t.brand} ${t.model}`.replace("Noma'lum Noma'lum", "Noma'lum")
      rw.getCell(3).value = STATUS_UZ[t.status] || t.status
      rw.getCell(4).value = t.status === 'installed' ? `${plate(t.vehicleId)} · ${posUz(t.position)}` : '—'
      rw.getCell(5).value = inst[0] ? new Date(inst[0].createdAt) : t.installationDate ? new Date(t.installationDate) : null
      rw.getCell(5).numFmt = 'dd.mm.yyyy'
      rw.getCell(6).value = inst.length || (t.installationDate ? 1 : 0)
      rw.getCell(7).value = uniqVeh.size || (t.vehicleId ? 1 : 0)
      rw.getCell(8).value = inst.length
        ? inst.map((e: any) => `${plate(e.vehicleId)} (${ddmmyyyy(new Date(e.createdAt))})`).join('  →  ')
        : t.vehicleId ? `${plate(t.vehicleId)} (${t.installationDate ? ddmmyyyy(new Date(t.installationDate)) : '—'})` : '—'
      rw.getCell(9).value = u.usedKm
      rw.getCell(9).numFmt = '#,##0'
      const pc = rw.getCell(10)
      pc.value = u.pct
      pc.numFmt = '0"%"'
      pc.font = { bold: true, color: { argb: LEVEL_COLOR[levelForPct(u.pct)] } }
      styleBodyRow(rw, i % 2 === 1, H4.length)
      for (const c of [3, 5, 6, 7, 9, 10]) rw.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' }
      rw.getCell(8).alignment = { vertical: 'middle', wrapText: true }
      if (t.status === 'written_off') rw.eachCell(c => { c.font = { ...(c.font || {}), color: { argb: C.soft }, italic: true } })
    })
    setupSheet(ws4, [18, 22, 18, 24, 16, 12, 12, 70, 15, 10], 4, 4)

    // ─── 5) Barcha shinalar ────────────────────────────────────────────────
    const ws5 = wb.addWorksheet('Barcha shinalar', { properties: { tabColor: { argb: C.soft } } })
    const H5 = ['№', 'Shina raqami', 'Brend', 'Model', "O'lcham", 'Turi', 'Holati', 'Sifati', 'Mashina', 'Joyi', 'Jami yurgan km', 'Norma km', 'Narxi (UZS)', 'Xarid sanasi', 'Kafolat', 'Yetkazuvchi']
    banner(ws5, "BARCHA SHINALAR RO'YXATI", subtitle, H5.length)
    headerRow(ws5, 4, H5)
    tires.forEach((t: any, i: number) => {
      const rw = ws5.getRow(5 + i)
      const u = t.status === 'installed' ? usageMap.get(t.id)! : computeTireUsage(t, null)
      rw.getCell(1).value = i + 1
      rw.getCell(2).value = t.serialCode
      rw.getCell(2).font = { bold: true, name: 'Consolas', color: { argb: C.blue } }
      rw.getCell(3).value = t.brand
      rw.getCell(4).value = t.model
      rw.getCell(5).value = t.size
      rw.getCell(6).value = t.type
      rw.getCell(7).value = STATUS_UZ[t.status] || t.status
      rw.getCell(8).value = COND_UZ[t.condition || 'unknown'] || t.condition
      rw.getCell(9).value = vName(t.vehicle)
      rw.getCell(10).value = posUz(t.position)
      rw.getCell(11).value = u.usedKm
      rw.getCell(12).value = u.normKm
      rw.getCell(13).value = Number(t.purchasePrice || 0)
      rw.getCell(14).value = t.purchaseDate ? new Date(t.purchaseDate) : null
      rw.getCell(15).value = t.warrantyEndDate ? new Date(t.warrantyEndDate) : null
      rw.getCell(16).value = t.supplier?.name || '—'
      for (const c of [11, 12, 13]) rw.getCell(c).numFmt = '#,##0'
      for (const c of [14, 15]) rw.getCell(c).numFmt = 'dd.mm.yyyy'
      styleBodyRow(rw, i % 2 === 1, H5.length)
      for (const c of [1, 6, 7, 8, 10, 14, 15]) rw.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' }
      if (t.status === 'written_off') rw.eachCell(c => { c.font = { ...(c.font || {}), color: { argb: C.soft }, italic: true } })
    })
    const totalRow = ws5.getRow(5 + tires.length + 1)
    totalRow.getCell(2).value = 'JAMI'
    totalRow.getCell(3).value = `${tires.length} ta`
    totalRow.getCell(13).value = totalValue
    totalRow.getCell(13).numFmt = '#,##0'
    totalRow.font = { bold: true }
    setupSheet(ws5, [5, 18, 14, 16, 14, 12, 18, 12, 28, 13, 14, 12, 15, 13, 13, 20], 4, 4)

    await send(wb, `shinalar-hisoboti-${today.toISOString().split('T')[0]}.xlsx`, res, req)
  } catch (err) { next(err) }
}
