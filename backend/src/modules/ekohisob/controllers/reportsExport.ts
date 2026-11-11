// Hisobot eksporti — haqiqiy .xlsx (exceljs).
//
// Ilgari frontend TSV matnini yasab, `.xls` kengaytmasi bilan yuklardi:
// Excel uni ogohlantirish bilan ochardi, formatlash va son formati yo'q edi.
// Loyihaning qolgan qismida (faktura, akt sverka, import shabloni) exceljs
// ishlatiladi — hisobot ham shu yo'lga o'tkazildi.
//
// Qoidalar: son formati `#,##0`; jami qatorlar SUM FORMULA (foydalanuvchi qatorni
// o'zgartirsa jami ham o'zgaradi); foizlar nolga bo'lishdan himoyalangan formula.

import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getReportsData, scopeOf, wantsBlacklisted } from './reports'
import { getMonthlyReportData } from './reportsMonthly'
import { uzDate, uzDateTime, uzMonth } from '../lib/dateFormat'
import { NUM_FMT, PCT_FMT, colLetter, totalCell, ratioFormula } from '../lib/xlsxFormat'
import { reportStatuses } from '../lib/debtSummary'
import { queryDebtors } from '../lib/reportQueries'

const HEADER_FILL = 'FFE8F5E9'
const TOTAL_FILL = 'FFF1F5F9'

/** Sarlavha qatorini bir xil ko'rinishga keltiradi. */
function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  row.eachCell(c => { c.border = { bottom: { style: 'thin' } } })
}

function styleTotal(row: ExcelJS.Row) {
  row.font = { bold: true }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }
}

/** Foiz (butun %) → Excel kasr yoki "—". */
const frac = (pct: number | null | undefined): number | string => (pct == null ? '—' : pct / 100)

/** GET /reports/export.xlsx?from=&to=&includeBlacklisted= */
export async function exportReportsXlsx(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [d, monthly] = await Promise.all([getReportsData(req), getMonthlyReportData(req)])

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()

    const periodText = d.period.from === d.period.to
      ? uzMonth(d.period.from)
      : `${uzMonth(d.period.from)} — ${uzMonth(d.period.to)}`

    // ── 1. Umumiy ──
    const ws = wb.addWorksheet('Umumiy')
    ws.columns = [{ width: 46 }, { width: 22 }]
    const title = ws.addRow(['EKOHISOB — HISOBOT'])
    title.font = { bold: true, size: 14 }
    ws.mergeCells(`A${title.number}:B${title.number}`)
    const sub = ws.addRow([`Davr: ${periodText}`])
    sub.font = { color: { argb: 'FF777777' } }
    ws.mergeCells(`A${sub.number}:B${sub.number}`)
    ws.addRow([])

    const k = d.kpi
    const kpi: [string, any][] = [
      ['Faol tashkilotlar', k.activeEntities],
      [`${uzMonth(d.currentMonth)} — kassaga tushdi (to'lov sanasi)`, k.collectedCash],
      [`${uzMonth(d.currentMonth)} — shu oyga tegishli yig'ilgan`, k.collectedForMonth],
      ["Davr bo'yicha jami (shu oylarga tegishli)", k.totalCollected6m],
      ['Kutilgan summa (oylik)', k.expectedMonthly],
      ['  — hisob (belgilangan oylik)', k.expectedFixed],
      ['  — talon (bajarilgan ish)', k.expectedTalon],
      ['Majburiyat bo\'yicha yopilgan', k.applied],
      ['Avans (majburiyatdan ortiq tushum)', k.advance],
      [k.includeBlacklisted ? 'JAMI QARZ (qora ro\'yxat bilan)' : 'JAMI QARZ (faol tashkilotlar)', k.totalDebt],
      ['Qora ro\'yxatdagi qarz (alohida)', k.blacklistedDebt],
      ['To\'lash majburiyati bo\'lgan', k.obligedCount],
      ['Ulardan to\'liq to\'lagan', k.paidCount],
      ['Ulardan qisman to\'lagan', k.partialCount],
      ['To\'lov foizi (to\'liq to\'laganlar)', k.payRate == null ? '—' : `${k.payRate}%`],
      ['Yig\'im foizi (yopilgan / kutilgan)', k.collectRateExact == null ? '—' : `${k.collectRateExact}%`],
    ]
    if (d.pace) {
      kpi.push(
        [`Tempo: ${d.pace.day}-kunigacha kassa`, d.pace.current],
        ["  o'tgan oyning shu kunigacha", d.pace.previous],
        ['  tempo o\'zgarishi', d.pace.deltaPercent == null ? '—' : `${d.pace.deltaPercent}%`],
      )
    }
    for (const [label, value] of kpi) {
      const row = ws.addRow([label, value])
      row.getCell(1).font = { color: { argb: 'FF555555' } }
      row.getCell(2).font = { bold: true }
      if (typeof value === 'number') row.getCell(2).numFmt = NUM_FMT
    }

    // ── 2. Oyma-oy hisobot ──
    // "Kutilgan" bu yerda va Umumiy varaqda BIR XIL manbadan (reportQueries.queryObligations).
    const wsTrend = wb.addWorksheet('Oyma-oy')
    wsTrend.columns = [
      { width: 18 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 },
      { width: 18 }, { width: 16 }, { width: 10 }, { width: 18 }, { width: 12 }, { width: 18 },
    ]
    styleHeader(wsTrend.addRow([
      'Oy', 'Kutilgan (jami)', '  — hisob', '  — talon', 'Yopilgan',
      "Shu oyga tegishli yig'ilgan", 'Kassaga tushdi', 'Avans', "Yig'im %", 'Qolgan qarz',
      "To'lovlar", "To'lagan tashkilot",
    ]))
    const mFrom = wsTrend.rowCount + 1
    for (const m of monthly.rows) {
      const r = wsTrend.rowCount + 1
      const row = wsTrend.addRow([
        uzMonth(m.month), m.expected, m.expectedCharge, m.expectedTalon, m.applied,
        m.collected, m.collectedCash, m.advance, '', m.debt, m.payments, m.payers,
      ])
      row.getCell(9).value = { formula: ratioFormula(`E${r}`, `B${r}`), result: frac(m.collectRate) } as any
    }
    const mTo = wsTrend.rowCount
    const tr = wsTrend.rowCount + 1
    const t = monthly.totals
    const trendTotal = wsTrend.addRow([
      'JAMI',
      totalCell(2, mFrom, mTo, t.expected),
      totalCell(3, mFrom, mTo, monthly.rows.reduce((s, r) => s + r.expectedCharge, 0)),
      totalCell(4, mFrom, mTo, monthly.rows.reduce((s, r) => s + r.expectedTalon, 0)),
      totalCell(5, mFrom, mTo, t.applied),
      totalCell(6, mFrom, mTo, t.collected),
      totalCell(7, mFrom, mTo, t.collectedCash),
      totalCell(8, mFrom, mTo, t.advance),
      '',
      totalCell(10, mFrom, mTo, t.debt),
      totalCell(11, mFrom, mTo, t.payments),
      '',
    ])
    trendTotal.getCell(9).value = { formula: ratioFormula(`E${tr}`, `B${tr}`), result: frac(t.collectRate) } as any
    styleTotal(trendTotal)
    for (const col of [2, 3, 4, 5, 6, 7, 8, 10, 11]) wsTrend.getColumn(col).numFmt = NUM_FMT
    wsTrend.getColumn(9).numFmt = PCT_FMT
    wsTrend.addRow([])
    const trendNote = wsTrend.addRow([
      "Izoh: yopilgan + qolgan qarz = kutilgan. Yig'im % = yopilgan / kutilgan (100% dan oshmaydi); "
      + "ortiqcha tushum 'Avans' ustunida. 'Kassaga tushdi' — to'lov sanasi shu oyda; "
      + "'Shu oyga tegishli' — pul qaysi oy hisobiga yozilgani.",
    ])
    trendNote.font = { color: { argb: 'FF777777' }, size: 9 }

    // ── 3. Qarz muddati ──
    const wsAge = wb.addWorksheet('Qarz muddati')
    wsAge.columns = [{ width: 16 }, { width: 16 }, { width: 20 }]
    styleHeader(wsAge.addRow(['Muddat', 'Tashkilot', "Summa (so'm)"]))
    const aFrom = wsAge.rowCount + 1
    for (const a of d.debtByAge) wsAge.addRow([a.label, a.count, a.amount])
    const aTo = wsAge.rowCount
    const ageTotal = wsAge.addRow([
      'JAMI',
      totalCell(2, aFrom, aTo, d.debtByAge.reduce((s: number, a: any) => s + a.count, 0)),
      totalCell(3, aFrom, aTo, d.debtByAge.reduce((s: number, a: any) => s + a.amount, 0)),
    ])
    styleTotal(ageTotal)
    wsAge.getColumn(3).numFmt = NUM_FMT

    // ── 4. Eng katta qarzdorlar ──
    if (d.topDebtors.length > 0) {
      const wsTop = wb.addWorksheet('Eng katta qarzdorlar')
      wsTop.columns = [{ width: 36 }, { width: 18 }, { width: 18 }, { width: 12 }, { width: 20 }]
      styleHeader(wsTop.addRow(['Tashkilot', 'Tuman', 'Mahalla', 'Qarz oyi', "Qarz (so'm)"]))
      const tFrom = wsTop.rowCount + 1
      for (const x of d.topDebtors) {
        wsTop.addRow([x.name, x.district ?? '—', x.mahalla ?? '—', x.debtMonths, x.debtAmount])
      }
      const tTo = wsTop.rowCount
      styleTotal(wsTop.addRow([
        'JAMI (TOP)', '', '', '',
        totalCell(5, tFrom, tTo, d.topDebtors.reduce((s: number, x: any) => s + x.debtAmount, 0)),
      ]))
      wsTop.getColumn(5).numFmt = NUM_FMT
    }

    // ── 5. Tuman bo'yicha ──
    const wsDist = wb.addWorksheet('Tuman')
    wsDist.columns = [
      { width: 26 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 12 }, { width: 12 },
      { width: 20 }, { width: 20 }, { width: 20 }, { width: 10 },
    ]
    styleHeader(wsDist.addRow([
      'Tuman', 'Jami', "To'lashi kerak", "To'liq to'lagan", 'Qisman', 'Qarzdor',
      "Shu oyga tegishli yig'ilgan", 'Kassaga tushdi', 'Qarz', 'Foiz',
    ]))
    const dFrom = wsDist.rowCount + 1
    for (const r of d.byDistrict) {
      const rr = wsDist.rowCount + 1
      const row = wsDist.addRow([
        r.name, r.total, r.obliged, r.paid, r.partial, r.unpaid, r.collected, r.collectedCash, r.debt, '',
      ])
      row.getCell(10).value = { formula: ratioFormula(`D${rr}`, `C${rr}`), result: frac(r.payRate) } as any
    }
    const dTo = wsDist.rowCount
    const dr = wsDist.rowCount + 1
    const sumBy = (f: (r: any) => number) => d.byDistrict.reduce((s: number, r: any) => s + f(r), 0)
    const distTotal = wsDist.addRow([
      'JAMI',
      totalCell(2, dFrom, dTo, sumBy(r => r.total)),
      totalCell(3, dFrom, dTo, sumBy(r => r.obliged)),
      totalCell(4, dFrom, dTo, sumBy(r => r.paid)),
      totalCell(5, dFrom, dTo, sumBy(r => r.partial)),
      totalCell(6, dFrom, dTo, sumBy(r => r.unpaid)),
      totalCell(7, dFrom, dTo, sumBy(r => r.collected)),
      totalCell(8, dFrom, dTo, sumBy(r => r.collectedCash)),
      totalCell(9, dFrom, dTo, sumBy(r => r.debt)),
      '',
    ])
    distTotal.getCell(10).value = {
      formula: ratioFormula(`D${dr}`, `C${dr}`), result: frac(d.kpi.payRate),
    } as any
    styleTotal(distTotal)
    for (const col of [7, 8, 9]) wsDist.getColumn(col).numFmt = NUM_FMT
    wsDist.getColumn(10).numFmt = PCT_FMT

    // ── 6. Inspektor (faqat admin/boshliq ko'rinishida) ──
    if (d.byInspector.length > 0) {
      const wsIns = wb.addWorksheet('Inspektor')
      wsIns.columns = [{ width: 30 }, { width: 24 }, { width: 22 }, { width: 18 }]
      styleHeader(wsIns.addRow([
        'Inspektor', `Shu davrga tegishli yig'ilgan (${d.period.months} oy)`, 'Kassaga tushdi', "To'lovlar soni",
      ]))
      const iFrom = wsIns.rowCount + 1
      for (const i of d.byInspector) wsIns.addRow([i.name, i.collected, i.collectedCash ?? 0, i.payments])
      const iTo = wsIns.rowCount
      styleTotal(wsIns.addRow([
        'JAMI',
        totalCell(2, iFrom, iTo, d.byInspector.reduce((s: number, i: any) => s + i.collected, 0)),
        totalCell(3, iFrom, iTo, d.byInspector.reduce((s: number, i: any) => s + (i.collectedCash ?? 0), 0)),
        totalCell(4, iFrom, iTo, d.byInspector.reduce((s: number, i: any) => s + i.payments, 0)),
      ]))
      wsIns.getColumn(2).numFmt = NUM_FMT
      wsIns.getColumn(3).numFmt = NUM_FMT
    }

    const stamp = `${d.period.from}_${d.period.to}`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="ekohisob_hisobot_${stamp}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

/** Reestrdagi qatorlar chegarasi (Excel uchun oqilona; oshsa varaqda ogohlantirish). */
const DEBTOR_EXPORT_LIMIT = 20000

/**
 * GET /reports/export/debtors?includeBlacklisted=1&order=age|debt
 *
 * To'liq qarzdorlar reestri: har qarzdor tashkilot bitta qatorda — qarz yoshi (necha oy) bo'yicha
 * kamayish tartibida (eng eskisi birinchi), keyin qarz summasi bo'yicha. Telefon, tuman/mahalla va
 * mas'ul inspektor(lar) bilan — inspektor shu ro'yxat bilan ishga chiqadi.
 * Doira ekoScope orqali: admin — butun korxona; boshliq/inspektor — faqat o'z tumanlari.
 */
export async function exportDebtorsXlsx(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = scopeOf(req)
    const statuses = reportStatuses(wantsBlacklisted(req))
    const order = String((req.query as any).order ?? 'age') === 'debt' ? 'debt' : 'age'

    const all = await queryDebtors(user, statuses, DEBTOR_EXPORT_LIMIT + 1, order)
    const truncated = all.length > DEBTOR_EXPORT_LIMIT
    const rows = truncated ? all.slice(0, DEBTOR_EXPORT_LIMIT) : all

    // Mas'ul inspektorlar: tumanga biriktirilgan faol inspektorlar
    const districtIds = Array.from(new Set(rows.map(r => r.districtId)))
    const inspectorsByDistrict = new Map<string, string[]>()
    if (districtIds.length > 0) {
      const links = await (prisma as any).ekoHisobUserDistrict.findMany({
        where: {
          districtId: { in: districtIds },
          user: { orgId: user.orgId, role: 'inspector', isActive: true, isMirror: false },
        },
        select: { districtId: true, user: { select: { fullName: true } } },
      })
      for (const l of links) {
        const arr = inspectorsByDistrict.get(l.districtId) ?? []
        arr.push(l.user.fullName)
        inspectorsByDistrict.set(l.districtId, arr)
      }
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()
    const ws = wb.addWorksheet('Qarzdorlar')
    ws.columns = [
      { width: 6 }, { width: 38 }, { width: 14 }, { width: 18 }, { width: 20 }, { width: 22 },
      { width: 28 }, { width: 34 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 14 },
      { width: 18 }, { width: 14 },
    ]
    const title = ws.addRow([`QARZDORLAR REESTRI — ${uzDateTime(new Date())}`])
    title.font = { bold: true, size: 13 }
    ws.mergeCells(`A${title.number}:N${title.number}`)
    const note = ws.addRow([
      `Tartib: ${order === 'age' ? 'qarz yoshi (eng eskisi birinchi), keyin summa' : 'qarz summasi'}. `
      + `Qora ro'yxat ${statuses.includes('blacklisted') ? 'kiritilgan' : 'kiritilmagan'}.`
      + (truncated ? ` DIQQAT: faqat birinchi ${DEBTOR_EXPORT_LIMIT} qator ko'rsatildi.` : ''),
    ])
    note.font = { color: { argb: truncated ? 'FFB91C1C' : 'FF777777' }, size: 9 }
    ws.mergeCells(`A${note.number}:N${note.number}`)

    const header = ws.addRow([
      '№', 'Tashkilot', 'STIR', 'Telefon', 'Tuman', 'Mahalla', "Mas'ul inspektor", 'Manzil', 'Holat',
      'Rejim', 'Qarz oyi', 'Eng eski qarz oyi', "Qarz (so'm)", "Oxirgi to'lov",
    ])
    styleHeader(header)
    const first = ws.rowCount + 1
    const modeLabel: Record<string, string> = {
      monthly_fixed: 'Belgilangan oylik', talon: 'Talon', variable: "O'zgaruvchan",
    }
    rows.forEach((r, i) => {
      ws.addRow([
        i + 1, r.name, r.stir ?? '—', r.phone ?? '—', r.district ?? '—', r.mahalla ?? '—',
        (inspectorsByDistrict.get(r.districtId) ?? []).join(', ') || '—',
        r.address ?? '—',
        r.status === 'blacklisted' ? "Qora ro'yxat" : 'Faol',
        modeLabel[r.billingMode] ?? r.billingMode,
        r.debtMonths, r.oldestMonth ? uzMonth(r.oldestMonth) : '—', r.debtAmount,
        r.lastPaidAt ? uzDate(r.lastPaidAt) : '—',
      ])
    })
    const last = ws.rowCount
    const total = ws.addRow([
      '', `JAMI (${rows.length} ta)`, '', '', '', '', '', '', '', '', '', '',
      totalCell(13, first, last, rows.reduce((s, r) => s + r.debtAmount, 0)), '',
    ])
    styleTotal(total)
    ws.getColumn(13).numFmt = NUM_FMT
    ws.views = [{ state: 'frozen', ySplit: header.number }]
    if (rows.length > 0) ws.autoFilter = `A${header.number}:${colLetter(14)}${last}`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="ekohisob_qarzdorlar.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

/**
 * GET /reports/print — rahbar yig'ilishga olib boradigan A4 sahifa.
 * PDF kutubxona qo'shilmaydi: brauzer Ctrl+P bilan bir xil natija beradi va
 * o'zbek `ʻ` / kirill shriftlari muammosi bo'lmaydi.
 */
export async function printReport(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [d, monthly] = await Promise.all([getReportsData(req), getMonthlyReportData(req)])
    const settings = await (prisma as any).ekoHisobOrgSettings.findUnique({
      where: { orgId: req.ekoUser!.orgId },
      select: { orgOfficialName: true },
    }).catch(() => null)

    const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')
    const esc = (s: unknown) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const periodText = d.period.from === d.period.to
      ? uzMonth(d.period.from)
      : `${uzMonth(d.period.from)} — ${uzMonth(d.period.to)}`

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(`<!doctype html>
<html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hisobot — ${esc(periodText)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         margin: 0; padding: 12mm; background: #f3f4f6; color: #111; font-size: 10.5pt; }
  .sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 12mm;
           border: 1px solid #e5e7eb; border-radius: 6px; }
  h1 { font-size: 15pt; margin: 0 0 1mm; text-align: center; }
  .sub { text-align: center; color: #6b7280; font-size: 9pt; margin-bottom: 6mm; }
  h2 { font-size: 11pt; margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #e5e7eb; }
  .kpis { display: flex; gap: 4mm; flex-wrap: wrap; }
  .kpi { flex: 1 1 40mm; border: 1px solid #e5e7eb; border-radius: 4px; padding: 3mm; }
  .kpi .l { font-size: 8pt; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
  .kpi .v { font-size: 14pt; font-weight: 700; margin-top: 1mm; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { background: #f3f4f6; text-align: left; padding: 2mm; border: 1px solid #e5e7eb;
       font-size: 8pt; text-transform: uppercase; color: #4b5563; }
  td { padding: 1.8mm 2mm; border: 1px solid #e5e7eb; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { background: #f3f4f6; font-weight: 700; }
  .btn { display: block; width: 100%; max-width: 210mm; margin: 0 auto 5mm; padding: 3mm;
         font-size: 11pt; font-weight: 600; color: #fff; background: #16a34a;
         border: 0; border-radius: 6px; cursor: pointer; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; border-radius: 0; padding: 0; max-width: none; }
    .btn { display: none; }
    tr, .kpi { break-inside: avoid; }
    thead { display: table-header-group; }
  }
</style></head>
<body>
<button class="btn" onclick="window.print()">🖨 Chop etish / PDF saqlash</button>
<div class="sheet">
  <h1>HISOBOT</h1>
  <div class="sub">${esc(settings?.orgOfficialName ?? 'EkoHisob')} · ${esc(periodText)}</div>

  <div class="kpis">
    <div class="kpi"><div class="l">${esc(uzMonth(d.currentMonth))} kassaga tushdi</div>
      <div class="v">${fmt(d.kpi.collectedCash)}</div></div>
    <div class="kpi"><div class="l">${esc(uzMonth(d.currentMonth))} shu oyga tegishli</div>
      <div class="v">${fmt(d.kpi.collectedForMonth)}</div></div>
    <div class="kpi"><div class="l">Jami qarz${d.kpi.includeBlacklisted ? ' (qora royxat bilan)' : ''}</div>
      <div class="v" style="color:#dc2626">${fmt(d.kpi.totalDebt)}</div></div>
    <div class="kpi"><div class="l">To'lov foizi</div>
      <div class="v">${d.kpi.payRate == null ? '—' : d.kpi.payRate + '%'}</div></div>
    ${d.kpi.blacklistedDebt > 0 && !d.kpi.includeBlacklisted ? `<div class="kpi"><div class="l">Qora ro'yxat qarzi</div>
      <div class="v">${fmt(d.kpi.blacklistedDebt)}</div></div>` : ''}
    <div class="kpi"><div class="l">Faol tashkilotlar</div>
      <div class="v">${fmt(d.kpi.activeEntities)}</div></div>
  </div>

  <h2>Oyma-oy</h2>
  <table><thead><tr>
    <th>Oy</th><th class="n">Kutilgan</th><th class="n">Shu oyga teg. yig'ilgan</th>
    <th class="n">Yig'im %</th><th class="n">Qolgan qarz</th><th class="n">To'lagan</th>
  </tr></thead><tbody>
    ${monthly.rows.map((m: any) => `<tr>
      <td>${esc(uzMonth(m.month))}</td><td class="n">${fmt(m.expected)}</td>
      <td class="n">${fmt(m.collected)}</td>
      <td class="n">${m.collectRate == null ? '—' : m.collectRate + '%'}</td>
      <td class="n">${fmt(m.debt)}</td><td class="n">${m.payers}</td></tr>`).join('')}
    <tr class="total"><td>JAMI</td>
      <td class="n">${fmt(monthly.totals.expected)}</td>
      <td class="n">${fmt(monthly.totals.collected)}</td>
      <td class="n">${monthly.totals.collectRate == null ? '—' : monthly.totals.collectRate + '%'}</td>
      <td class="n">${fmt(monthly.totals.debt)}</td><td class="n">—</td></tr>
  </tbody></table>

  <h2>Qarz muddati bo'yicha</h2>
  <table><thead><tr><th>Muddat</th><th class="n">Tashkilot</th><th class="n">Summa</th></tr></thead>
  <tbody>
    ${d.debtByAge.map((a: any) =>
      `<tr><td>${esc(a.label)}</td><td class="n">${a.count}</td><td class="n">${fmt(a.amount)}</td></tr>`).join('')}
    <tr class="total"><td>JAMI</td>
      <td class="n">${d.debtByAge.reduce((s: number, a: any) => s + a.count, 0)}</td>
      <td class="n">${fmt(d.debtByAge.reduce((s: number, a: any) => s + a.amount, 0))}</td></tr>
  </tbody></table>

  <h2>Tuman bo'yicha — ${esc(uzMonth(d.currentMonth))}</h2>
  <table><thead><tr>
    <th>Tuman</th><th class="n">To'lashi kerak</th><th class="n">To'lagan</th>
    <th class="n">Yig'ilgan</th><th class="n">Qarz</th><th class="n">Foiz</th>
  </tr></thead><tbody>
    ${d.byDistrict.map((r: any) => `<tr>
      <td>${esc(r.name)}</td><td class="n">${r.obliged}</td><td class="n">${r.paid}</td>
      <td class="n">${fmt(r.collected)}</td><td class="n">${fmt(r.debt)}</td>
      <td class="n">${r.payRate == null ? '—' : r.payRate + '%'}</td></tr>`).join('')}
  </tbody></table>

  ${d.topDebtors.length > 0 ? `
  <h2>Eng katta qarzdorlar</h2>
  <table><thead><tr><th>Tashkilot</th><th>Hudud</th><th class="n">Oy</th><th class="n">Qarz</th></tr></thead>
  <tbody>${d.topDebtors.map((t: any) => `<tr>
    <td>${esc(t.name)}</td>
    <td>${esc([t.district, t.mahalla].filter(Boolean).join(' / ') || '—')}</td>
    <td class="n">${t.debtMonths}</td><td class="n">${fmt(t.debtAmount)}</td></tr>`).join('')}
  </tbody></table>` : ''}

  ${d.byInspector.length > 0 ? `
  <h2>Inspektor samaradorligi (${d.period.months} oy)</h2>
  <table><thead><tr><th>Inspektor</th><th class="n">Yig'ilgan</th><th class="n">To'lovlar</th></tr></thead>
  <tbody>${d.byInspector.map((i: any) =>
    `<tr><td>${esc(i.name)}</td><td class="n">${fmt(i.collected)}</td><td class="n">${i.payments}</td></tr>`).join('')}
  </tbody></table>` : ''}

  <p style="margin-top:8mm;font-size:8pt;color:#9ca3af;text-align:right">
    Yaratilgan: ${uzDateTime(new Date())}
  </p>
</div>
</body></html>`)
  } catch (err) { next(err) }
}
