// Hisobot eksporti — haqiqiy .xlsx (exceljs).
//
// Ilgari frontend TSV matnini yasab, `.xls` kengaytmasi bilan yuklardi:
// Excel uni ogohlantirish bilan ochardi, formatlash va son formati yo'q edi.
// Loyihaning qolgan qismida (faktura, akt sverka, import shabloni) exceljs
// ishlatiladi — hisobot ham shu yo'lga o'tkazildi.

import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getReportsData } from './reports'
import { uzDate, uzDateTime, uzMonth } from '../lib/dateFormat'

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function monthLabel(m: string): string {
  const [y, mo] = String(m).split('-')
  return `${UZ_MONTHS[parseInt(mo, 10) - 1] ?? mo} ${y}`
}

const HEADER_FILL = 'FFE8F5E9'
const TOTAL_FILL = 'FFF1F5F9'

/** Sarlavha qatorini bir xil ko'rinishga keltiradi. */
function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  row.eachCell(c => { c.border = { bottom: { style: 'thin' } } })
}

/** GET /reports/export.xlsx?from=&to= */
export async function exportReportsXlsx(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const d = await getReportsData(req)

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()

    const periodText = d.period.from === d.period.to
      ? monthLabel(d.period.from)
      : `${monthLabel(d.period.from)} — ${monthLabel(d.period.to)}`

    // ── 1. Umumiy ──
    const ws = wb.addWorksheet('Umumiy')
    ws.columns = [{ width: 34 }, { width: 22 }]
    const title = ws.addRow(['EKOHISOB — HISOBOT'])
    title.font = { bold: true, size: 14 }
    ws.mergeCells(`A${title.number}:B${title.number}`)
    const sub = ws.addRow([`Davr: ${periodText}`])
    sub.font = { color: { argb: 'FF777777' } }
    ws.mergeCells(`A${sub.number}:B${sub.number}`)
    ws.addRow([])

    const kpi: [string, any][] = [
      ['Faol tashkilotlar', d.kpi.activeEntities],
      [`${monthLabel(d.currentMonth)} yig'ilgan`, d.kpi.collectedThisMonth],
      ['Davr bo\'yicha jami yig\'ilgan', d.kpi.totalCollected6m],
      ['Kutilgan summa (oylik)', d.kpi.expectedMonthly],
      ['  — belgilangan oylik', d.kpi.expectedFixed],
      ['  — talon (bajarilgan ish)', d.kpi.expectedTalon],
      ['JAMI QARZ', d.kpi.totalDebt],
      ['To\'lash majburiyati bo\'lgan', d.kpi.obligedCount],
      ['Ulardan to\'lagan', d.kpi.paidCount],
      ['To\'lov foizi', d.kpi.payRate == null ? '—' : `${d.kpi.payRate}%`],
    ]
    for (const [label, value] of kpi) {
      const row = ws.addRow([label, value])
      row.getCell(1).font = { color: { argb: 'FF555555' } }
      row.getCell(2).font = { bold: true }
      if (typeof value === 'number') row.getCell(2).numFmt = '# ##0'
    }

    // ── 2. Oylik dinamika ──
    const wsTrend = wb.addWorksheet('Oylik dinamika')
    wsTrend.columns = [{ width: 18 }, { width: 20 }]
    styleHeader(wsTrend.addRow(['Oy', "Yig'ilgan (so'm)"]))
    for (const m of d.monthlyTrend) wsTrend.addRow([monthLabel(m.month), m.collected])
    const trendTotal = wsTrend.addRow(['JAMI', d.monthlyTrend.reduce((s: number, m: any) => s + m.collected, 0)])
    trendTotal.font = { bold: true }
    trendTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }
    wsTrend.getColumn(2).numFmt = '# ##0'

    // ── 3. Qarz muddati ──
    const wsAge = wb.addWorksheet('Qarz muddati')
    wsAge.columns = [{ width: 16 }, { width: 16 }, { width: 20 }]
    styleHeader(wsAge.addRow(['Muddat', 'Tashkilot', "Summa (so'm)"]))
    for (const a of d.debtByAge) wsAge.addRow([a.label, a.count, a.amount])
    const ageTotal = wsAge.addRow([
      'JAMI',
      d.debtByAge.reduce((s: number, a: any) => s + a.count, 0),
      d.debtByAge.reduce((s: number, a: any) => s + a.amount, 0),
    ])
    ageTotal.font = { bold: true }
    ageTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }
    wsAge.getColumn(3).numFmt = '# ##0'

    // ── 4. Eng katta qarzdorlar ──
    if (d.topDebtors.length > 0) {
      const wsTop = wb.addWorksheet('Eng katta qarzdorlar')
      wsTop.columns = [{ width: 36 }, { width: 18 }, { width: 18 }, { width: 12 }, { width: 20 }]
      styleHeader(wsTop.addRow(['Tashkilot', 'Tuman', 'Mahalla', 'Qarz oyi', "Qarz (so'm)"]))
      for (const t of d.topDebtors) {
        wsTop.addRow([t.name, t.district ?? '—', t.mahalla ?? '—', t.debtMonths, t.debtAmount])
      }
      wsTop.getColumn(5).numFmt = '# ##0'
    }

    // ── 5. Tuman bo'yicha ──
    const wsDist = wb.addWorksheet('Tuman')
    wsDist.columns = [
      { width: 26 }, { width: 12 }, { width: 16 }, { width: 12 },
      { width: 12 }, { width: 20 }, { width: 20 }, { width: 10 },
    ]
    styleHeader(wsDist.addRow([
      'Tuman', 'Jami', "To'lashi kerak", "To'lagan", 'Qarzdor', "Yig'ilgan", 'Qarz', 'Foiz',
    ]))
    for (const r of d.byDistrict) {
      wsDist.addRow([
        r.name, r.total, r.obliged, r.paid, r.unpaid, r.collected, r.debt,
        r.payRate == null ? '—' : r.payRate / 100,
      ])
    }
    wsDist.getColumn(6).numFmt = '# ##0'
    wsDist.getColumn(7).numFmt = '# ##0'
    wsDist.getColumn(8).numFmt = '0%'

    // ── 6. Inspektor (faqat admin/boshliq ko'rinishida) ──
    if (d.byInspector.length > 0) {
      const wsIns = wb.addWorksheet('Inspektor')
      wsIns.columns = [{ width: 30 }, { width: 22 }, { width: 18 }]
      styleHeader(wsIns.addRow(['Inspektor', `Yig'ilgan (${d.period.months} oy)`, "To'lovlar soni"]))
      for (const i of d.byInspector) wsIns.addRow([i.name, i.collected, i.payments])
      wsIns.getColumn(2).numFmt = '# ##0'
    }

    const stamp = `${d.period.from}_${d.period.to}`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="ekohisob_hisobot_${stamp}.xlsx"`)
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
    const d = await getReportsData(req)
    const settings = await (prisma as any).ekoHisobOrgSettings.findUnique({
      where: { orgId: req.ekoUser!.orgId },
      select: { orgOfficialName: true },
    }).catch(() => null)

    const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')
    const esc = (s: unknown) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const periodText = d.period.from === d.period.to
      ? monthLabel(d.period.from)
      : `${monthLabel(d.period.from)} — ${monthLabel(d.period.to)}`

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
    <div class="kpi"><div class="l">${esc(monthLabel(d.currentMonth))} yig'ilgan</div>
      <div class="v">${fmt(d.kpi.collectedThisMonth)}</div></div>
    <div class="kpi"><div class="l">Jami qarz</div>
      <div class="v" style="color:#dc2626">${fmt(d.kpi.totalDebt)}</div></div>
    <div class="kpi"><div class="l">To'lov foizi</div>
      <div class="v">${d.kpi.payRate == null ? '—' : d.kpi.payRate + '%'}</div></div>
    <div class="kpi"><div class="l">Faol tashkilotlar</div>
      <div class="v">${fmt(d.kpi.activeEntities)}</div></div>
  </div>

  <h2>Qarz muddati bo'yicha</h2>
  <table><thead><tr><th>Muddat</th><th class="n">Tashkilot</th><th class="n">Summa</th></tr></thead>
  <tbody>
    ${d.debtByAge.map((a: any) =>
      `<tr><td>${esc(a.label)}</td><td class="n">${a.count}</td><td class="n">${fmt(a.amount)}</td></tr>`).join('')}
    <tr class="total"><td>JAMI</td>
      <td class="n">${d.debtByAge.reduce((s: number, a: any) => s + a.count, 0)}</td>
      <td class="n">${fmt(d.debtByAge.reduce((s: number, a: any) => s + a.amount, 0))}</td></tr>
  </tbody></table>

  <h2>Tuman bo'yicha — ${esc(monthLabel(d.currentMonth))}</h2>
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
