// Akt sverka (solishtirma dalolatnoma) — JSON, chop etiladigan HTML va Excel.
//
// Mijoz bilan hisob-kitobni solishtirishda talab qilinadigan rasmiy hujjat.
// Ilgari faqat oylar tasmasi (EntityLedgerModal) bor edi — saldosiz va
// ixtiyoriy davrsiz, ya'ni akt sverka o'rnini bosa olmasdi.

import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { buildReconciliation, amountInWords, ReconResult } from '../lib/reconciliation'
import { getOrgSettings } from '../services/orgSettings'
import { uzDate, uzDateTime, uzMonth } from '../lib/dateFormat'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const DOC_LABEL: Record<string, string> = {
  charge: 'Hisob',
  talon: 'Talon',
  payment: "To'lov",
}

/** Tashkilotni topadi va kirish huquqini tekshiradi. */
async function loadEntity(req: EkoRequest, id: string) {
  const { orgId, role, districtIds } = req.ekoUser!
  const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
    where: { id },
    select: {
      id: true, name: true, orgId: true, districtId: true, stir: true,
      address: true, phone: true, contactName: true, contractNumber: true,
      contractStartMonth: true, billingMode: true, monthlyFee: true, cubicPrice: true,
      createdBy: true, createdAt: true,
      district: { select: { name: true } },
      mahalla: { select: { name: true } },
    },
  })
  if (!entity || entity.orgId !== orgId) return { error: 404 as const }
  if (role === 'inspector' && !districtIds.includes(entity.districtId)) return { error: 403 as const }
  return { entity }
}

/** Hujjatlarni yig'ib akt sverkani quradi. */
async function buildForEntity(entity: any, from: string | null, to: string | null): Promise<ReconResult> {
  const [charges, payments, talons] = await Promise.all([
    entity.billingMode === 'monthly_fixed'
      ? (prisma as any).ekoHisobCharge.findMany({
          where: { entityId: entity.id },
          select: { month: true, expectedAmount: true },
          orderBy: { month: 'asc' },
        })
      : Promise.resolve([]),
    (prisma as any).ekoHisobPayment.findMany({
      where: { entityId: entity.id },
      select: { paidAt: true, amount: true, month: true, note: true, receipt: { select: { receiptNumber: true } } },
      orderBy: { paidAt: 'asc' },
    }),
    entity.billingMode === 'talon'
      ? (prisma as any).ekoHisobTalon.findMany({
          where: { entityId: entity.id },
          select: { date: true, amount: true, volume: true, note: true },
          orderBy: { date: 'asc' },
        })
      : Promise.resolve([]),
  ])

  return buildReconciliation({
    from, to,
    billingMode: entity.billingMode,
    charges,
    talons,
    payments: payments.map((p: any) => ({
      paidAt: p.paidAt,
      amount: p.amount,
      month: p.month,
      note: p.note,
      receiptNumber: p.receipt?.receiptNumber ?? null,
    })),
  })
}

/** So'rov parametrlaridan davr chegaralarini oladi ("YYYY-MM-DD"). */
function periodFromQuery(req: EkoRequest): { from: string | null; to: string | null } {
  const q = req.query as Record<string, string>
  const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  return { from: ok(q.from), to: ok(q.to) }
}

/**
 * GET /entities/:id/reconciliation?from=&to=
 * Standart davr — butun tarix (from/to berilmasa boshlang'ich qoldiq 0 bo'ladi).
 */
export async function getReconciliation(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { entity, error } = await loadEntity(req, req.params.id)
    if (error === 404) { res.status(404).json({ success: false, error: 'Tashkilot topilmadi' }); return }
    if (error === 403) { res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' }); return }

    const { from, to } = periodFromQuery(req)
    const recon = await buildForEntity(entity, from, to)
    const settings = await getOrgSettings(req.ekoUser!.orgId)

    // Kim kiritgani — bir tumanda bir necha inspektor ishlaganda kerak bo'ladi.
    // FK yo'q (eski yozuvlarda mavjud bo'lmagan id bo'lishi mumkin), shuning
    // uchun nomni alohida so'rov bilan olamiz.
    let creatorName: string | null = null
    if (entity.createdBy) {
      const u = await (prisma as any).ekoHisobUser.findUnique({
        where: { id: entity.createdBy },
        select: { fullName: true },
      }).catch(() => null)
      creatorName = u?.fullName ?? null
    }

    res.json({
      success: true,
      data: {
        entity: {
          id: entity.id, name: entity.name, stir: entity.stir, address: entity.address,
          phone: entity.phone, contactName: entity.contactName,
          contractNumber: entity.contractNumber, contractStartMonth: entity.contractStartMonth,
          billingMode: entity.billingMode, monthlyFee: entity.monthlyFee, cubicPrice: entity.cubicPrice,
          district: entity.district?.name ?? null, mahalla: entity.mahalla?.name ?? null,
          creatorName, createdAt: entity.createdAt,
        },
        provider: {
          name: settings.orgOfficialName, stir: settings.orgStir, address: settings.orgAddress,
          phone: settings.orgPhone, bankAccount: settings.orgBankAccount,
          bankName: settings.orgBankName, mfo: settings.orgMfo,
          director: settings.orgDirector, accountant: settings.orgAccountant,
        },
        /** Rekvizitlar to'ldirilmagan bo'lsa UI ogohlantiradi */
        providerConfigured: !!settings.orgOfficialName,
        ...recon,
      },
    })
  } catch (err) { next(err) }
}

/** GET /entities/:id/reconciliation/print — A4 chop etiladigan hujjat */
export async function printReconciliation(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { entity, error } = await loadEntity(req, req.params.id)
    if (error) { res.status(error).send(error === 404 ? 'Tashkilot topilmadi' : 'Ruxsat yo\'q'); return }

    const { from, to } = periodFromQuery(req)
    const recon = await buildForEntity(entity, from, to)
    const s = await getOrgSettings(req.ekoUser!.orgId)

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(renderHtml({ entity, recon, s }))
  } catch (err) { next(err) }
}

function renderHtml({ entity, recon, s }: { entity: any; recon: ReconResult; s: any }): string {
  const period = recon.periodFrom && recon.periodTo
    ? `${uzDate(recon.periodFrom)} — ${uzDate(recon.periodTo)}`
    : 'butun davr'

  const showBalance = recon.mode === 'full'
  const owed = recon.closingBalance
  const verdict = owed > 0
    ? `<b>${esc(entity.name)}</b> tashkilotining <b>${fmt(owed)} so'm</b> qarzi mavjud.`
    : owed < 0
      ? `<b>${esc(entity.name)}</b> tashkilotida <b>${fmt(-owed)} so'm</b> ortiqcha to'lov (avans) mavjud.`
      : `Taraflar o'rtasida hisob-kitob to'liq amalga oshirilgan, qarzdorlik yo'q.`

  const rows = recon.rows.map(r => `
    <tr>
      <td class="c">${uzDate(r.date)}</td>
      <td>${esc(DOC_LABEL[r.kind] ?? r.kind)}${r.doc ? ` <span class="dim">${esc(r.doc)}</span>` : ''}</td>
      <td>${esc(r.description)}</td>
      <td class="n">${r.debit ? fmt(r.debit) : ''}</td>
      <td class="n">${r.credit ? fmt(r.credit) : ''}</td>
      ${showBalance ? `<td class="n b">${fmt(r.balance)}</td>` : ''}
    </tr>`).join('')

  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Akt sverka — ${esc(entity.name)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         margin: 0; padding: 14mm; color: #111; background: #f3f4f6; font-size: 10.5pt; }
  .sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 12mm;
           border: 1px solid #e5e7eb; border-radius: 6px; }
  h1 { font-size: 14pt; text-align: center; margin: 0 0 1mm; letter-spacing: .3px; }
  .sub { text-align: center; color: #6b7280; font-size: 9pt; margin-bottom: 6mm; }
  .parties { display: flex; gap: 6mm; margin-bottom: 5mm; }
  .party { flex: 1; border: 1px solid #e5e7eb; border-radius: 4px; padding: 3mm 4mm; }
  .party h2 { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em;
              color: #6b7280; margin: 0 0 2mm; font-weight: 600; }
  .party dl { margin: 0; font-size: 9pt; }
  .party dt { color: #6b7280; float: left; clear: left; width: 26mm; }
  .party dd { margin: 0 0 1mm 26mm; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 2mm; }
  th { background: #f3f4f6; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em;
       color: #4b5563; padding: 2mm; border: 1px solid #e5e7eb; text-align: left; }
  td { padding: 1.8mm 2mm; border: 1px solid #e5e7eb; vertical-align: top; }
  td.c { white-space: nowrap; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.b { font-weight: 600; }
  .dim { color: #9ca3af; font-size: 8pt; }
  tr.open td { background: #fafafa; font-weight: 600; }
  tr.total td { background: #f3f4f6; font-weight: 700; }
  .verdict { margin-top: 5mm; padding: 3mm 4mm; background: #f9fafb;
             border-left: 3px solid #16a34a; border-radius: 3px; font-size: 10pt; }
  .words { font-size: 8.5pt; color: #4b5563; font-style: italic; margin-top: 1mm; }
  .signs { display: flex; gap: 10mm; margin-top: 10mm; }
  .signs > div { flex: 1; }
  .signs h3 { font-size: 9pt; margin: 0 0 6mm; font-weight: 600; }
  .line { border-bottom: 1px solid #9ca3af; height: 8mm; }
  .cap { font-size: 8pt; color: #6b7280; margin-top: 1mm; }
  .missing { background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
             padding: 2.5mm 3mm; border-radius: 4px; font-size: 8.5pt; margin-bottom: 4mm; }
  .btn { display: block; width: 100%; max-width: 210mm; margin: 0 auto 5mm;
         padding: 3mm; font-size: 11pt; font-weight: 600; color: #fff;
         background: #16a34a; border: 0; border-radius: 6px; cursor: pointer; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; border-radius: 0; padding: 0; max-width: none; }
    .btn, .missing { display: none; }
    tr { break-inside: avoid; }
    thead { display: table-header-group; }
  }
</style>
</head>
<body>
<button class="btn" onclick="window.print()">🖨 Chop etish / PDF saqlash</button>
<div class="sheet">
  ${s.orgOfficialName ? '' : `<div class="missing">
    Xizmat ko'rsatuvchi tomon rekvizitlari to'ldirilmagan — Sozlamalar bo'limida kiriting,
    aks holda hujjat rasmiy kuchga ega bo'lmaydi.
  </div>`}

  <h1>SOLISHTIRMA DALOLATNOMA (AKT SVERKA)</h1>
  <div class="sub">Maishiy chiqindi olib chiqish xizmati · ${esc(period)}</div>

  <div class="parties">
    <div class="party">
      <h2>Xizmat ko'rsatuvchi</h2>
      <dl>
        <dt>Nomi</dt><dd>${esc(s.orgOfficialName ?? '—')}</dd>
        ${s.orgStir ? `<dt>STIR</dt><dd>${esc(s.orgStir)}</dd>` : ''}
        ${s.orgAddress ? `<dt>Manzil</dt><dd>${esc(s.orgAddress)}</dd>` : ''}
        ${s.orgBankAccount ? `<dt>H/r</dt><dd>${esc(s.orgBankAccount)}</dd>` : ''}
        ${s.orgBankName ? `<dt>Bank</dt><dd>${esc(s.orgBankName)}</dd>` : ''}
        ${s.orgMfo ? `<dt>MFO</dt><dd>${esc(s.orgMfo)}</dd>` : ''}
        ${s.orgPhone ? `<dt>Telefon</dt><dd>${esc(s.orgPhone)}</dd>` : ''}
      </dl>
    </div>
    <div class="party">
      <h2>Buyurtmachi</h2>
      <dl>
        <dt>Nomi</dt><dd>${esc(entity.name)}</dd>
        ${entity.stir ? `<dt>STIR</dt><dd>${esc(entity.stir)}</dd>` : ''}
        ${entity.address ? `<dt>Manzil</dt><dd>${esc(entity.address)}</dd>` : ''}
        ${entity.contractNumber ? `<dt>Shartnoma</dt><dd>${esc(entity.contractNumber)}</dd>` : ''}
        <dt>Hudud</dt><dd>${esc(entity.district ?? '—')}${entity.mahalla ? ` / ${esc(entity.mahalla)}` : ''}</dd>
        ${entity.phone ? `<dt>Telefon</dt><dd>${esc(entity.phone)}</dd>` : ''}
      </dl>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:22mm">Sana</th>
        <th style="width:30mm">Hujjat</th>
        <th>Izoh</th>
        <th class="n" style="width:26mm">Hisoblandi</th>
        <th class="n" style="width:26mm">To'landi</th>
        ${showBalance ? '<th class="n" style="width:26mm">Saldo</th>' : ''}
      </tr>
    </thead>
    <tbody>
      ${showBalance ? `<tr class="open">
        <td class="c">${recon.periodFrom ? uzDate(recon.periodFrom) : '—'}</td>
        <td colspan="3">Davr boshiga qoldiq</td>
        <td class="n"></td>
        <td class="n b">${fmt(recon.openingBalance)}</td>
      </tr>` : ''}
      ${rows || `<tr><td colspan="${showBalance ? 6 : 5}" style="text-align:center;color:#9ca3af;padding:6mm">
        Tanlangan davrda hujjat yo'q
      </td></tr>`}
      <tr class="total">
        <td colspan="3">JAMI davr bo'yicha</td>
        <td class="n">${fmt(recon.totals.debit)}</td>
        <td class="n">${fmt(recon.totals.credit)}</td>
        ${showBalance ? `<td class="n">${fmt(recon.closingBalance)}</td>` : ''}
      </tr>
    </tbody>
  </table>

  ${showBalance ? `<div class="verdict">
    ${verdict}
    ${owed !== 0 ? `<div class="words">${esc(amountInWords(Math.abs(owed)))} so'm</div>` : ''}
  </div>` : `<div class="verdict">
    Ushbu tashkilot o'zgaruvchan to'lov rejimida — oldindan hisoblanadigan oylik summa
    yo'q. Yuqorida faqat qabul qilingan to'lovlar keltirilgan.
  </div>`}

  <div class="signs">
    <div>
      <h3>Xizmat ko'rsatuvchi</h3>
      <div class="line"></div>
      <div class="cap">${esc(s.orgDirector ?? 'Rahbar')} — imzo, sana, M.O'.</div>
      ${s.orgAccountant ? `<div class="line" style="margin-top:6mm"></div>
        <div class="cap">${esc(s.orgAccountant)} — bosh hisobchi</div>` : ''}
    </div>
    <div>
      <h3>Buyurtmachi</h3>
      <div class="line"></div>
      <div class="cap">${esc(entity.contactName ?? 'Rahbar')} — imzo, sana, M.O'.</div>
    </div>
  </div>
</div>
</body>
</html>`
}

/**
 * GET /entities/:id/reconciliation.csv
 *
 * Sof jadval CSV — sarlavha qatori, ma'lumot qatorlari, jami qatori.
 * Tashkilot rekvizitlari ATAYLAB qo'shilmaydi: ular qo'shilsa fayl boshqa
 * dasturga (1C, buxgalteriya tizimi) import qilinganda ustunlar siljib
 * ketadi. Tashkilot nomi fayl nomida.
 *
 * Ajratgich `;` — O'zbekiston/MDH mintaqasidagi Excel ro'yxat ajratgichi
 * shu; vergul ishlatilsa summalar ustunlarga to'g'ri tushmaydi.
 * UTF-8 BOM — o'zbekcha harflar Excel'da buzilmasligi uchun.
 */
export async function downloadReconciliationCsv(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { entity, error } = await loadEntity(req, req.params.id)
    if (error === 404) { res.status(404).json({ success: false, error: 'Tashkilot topilmadi' }); return }
    if (error === 403) { res.status(403).json({ success: false, error: 'Ruxsat yo\'q' }); return }

    const { from, to } = periodFromQuery(req)
    const recon = await buildForEntity(entity, from, to)
    const showBalance = recon.mode === 'full'

    // Maydon ichida `;`, `"` yoki qator uzilishi bo'lsa qo'shtirnoqqa olinadi
    const cell = (v: unknown): string => {
      const s = String(v ?? '')
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const line = (cells: unknown[]) => cells.map(cell).join(';')

    const rows: string[] = []
    rows.push(line([
      'Sana', 'Hujjat', 'Izoh', 'Hisoblandi', "To'landi", ...(showBalance ? ['Saldo'] : []),
    ]))

    if (showBalance) {
      rows.push(line([
        recon.periodFrom ? uzDate(recon.periodFrom) : '',
        'Davr boshiga qoldiq', '', '', '', recon.openingBalance,
      ]))
    }

    for (const r of recon.rows) {
      rows.push(line([
        uzDate(r.date),
        `${DOC_LABEL[r.kind] ?? r.kind}${r.doc ? ` ${r.doc}` : ''}`,
        r.description,
        r.debit || '',
        r.credit || '',
        ...(showBalance ? [r.balance] : []),
      ]))
    }

    rows.push(line([
      '', 'JAMI', '', recon.totals.debit, recon.totals.credit,
      ...(showBalance ? [recon.closingBalance] : []),
    ]))

    const safe = entity.name.replace(/[^\p{L}0-9\s-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 40)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''akt_sverka_${encodeURIComponent(safe)}.csv`)
    // BOM — Excel faylni UTF-8 deb tanishi uchun
    res.send('﻿' + rows.join('\r\n'))
  } catch (err) { next(err) }
}

/** GET /entities/:id/reconciliation.xlsx — Excel varianti */
export async function downloadReconciliation(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { entity, error } = await loadEntity(req, req.params.id)
    if (error === 404) { res.status(404).json({ success: false, error: 'Tashkilot topilmadi' }); return }
    if (error === 403) { res.status(403).json({ success: false, error: 'Ruxsat yo\'q' }); return }

    const { from, to } = periodFromQuery(req)
    const recon = await buildForEntity(entity, from, to)
    const s = await getOrgSettings(req.ekoUser!.orgId)
    const showBalance = recon.mode === 'full'

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()
    const ws = wb.addWorksheet('Akt sverka')
    ws.columns = [
      { width: 13 }, { width: 20 }, { width: 44 }, { width: 16 }, { width: 16 }, { width: 16 },
    ]

    const lastCol = showBalance ? 'F' : 'E'
    const title = ws.addRow(['SOLISHTIRMA DALOLATNOMA (AKT SVERKA)'])
    title.font = { bold: true, size: 13 }
    title.alignment = { horizontal: 'center' }
    ws.mergeCells(`A${title.number}:${lastCol}${title.number}`)

    const period = recon.periodFrom && recon.periodTo
      ? `${uzDate(recon.periodFrom)} — ${uzDate(recon.periodTo)}`
      : 'butun davr'
    const sub = ws.addRow([`Maishiy chiqindi olib chiqish xizmati · ${period}`])
    sub.alignment = { horizontal: 'center' }
    sub.font = { color: { argb: 'FF777777' }, size: 10 }
    ws.mergeCells(`A${sub.number}:${lastCol}${sub.number}`)
    ws.addRow([])

    const info: [string, any][] = [
      ["Xizmat ko'rsatuvchi", s.orgOfficialName ?? '—'],
      ...(s.orgStir ? [['STIR', s.orgStir] as [string, any]] : []),
      ...(s.orgBankAccount ? [['H/r', s.orgBankAccount] as [string, any]] : []),
      ['Buyurtmachi', entity.name],
      ...(entity.stir ? [['Buyurtmachi STIR', entity.stir] as [string, any]] : []),
      ...(entity.address ? [['Manzil', entity.address] as [string, any]] : []),
      ...(entity.contractNumber ? [['Shartnoma', entity.contractNumber] as [string, any]] : []),
    ]
    for (const [k, v] of info) {
      const row = ws.addRow([k + ':', v])
      row.getCell(1).font = { color: { argb: 'FF777777' } }
      row.getCell(2).font = { bold: true }
    }
    ws.addRow([])

    const header = ['Sana', 'Hujjat', 'Izoh', 'Hisoblandi', "To'landi", ...(showBalance ? ['Saldo'] : [])]
    const hdr = ws.addRow(header)
    hdr.font = { bold: true }
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    hdr.eachCell(c => { c.border = { bottom: { style: 'thin' } } })

    if (showBalance) {
      const open = ws.addRow([
        recon.periodFrom ? uzDate(recon.periodFrom) : '—',
        'Davr boshiga qoldiq', '', '', '', recon.openingBalance,
      ])
      open.font = { bold: true }
    }

    for (const r of recon.rows) {
      ws.addRow([
        uzDate(r.date),
        `${DOC_LABEL[r.kind] ?? r.kind}${r.doc ? ` ${r.doc}` : ''}`,
        r.description,
        r.debit || null,
        r.credit || null,
        ...(showBalance ? [r.balance] : []),
      ])
    }

    const total = ws.addRow([
      '', 'JAMI davr bo\'yicha', '',
      recon.totals.debit, recon.totals.credit,
      ...(showBalance ? [recon.closingBalance] : []),
    ])
    total.font = { bold: true }
    total.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: recon.closingBalance > 0 ? 'FFFCE4EC' : 'FFE8F5E9' },
    }

    if (showBalance) {
      ws.addRow([])
      const verdict = ws.addRow([
        recon.closingBalance > 0
          ? `Qarz: ${fmt(recon.closingBalance)} so'm (${amountInWords(recon.closingBalance)} so'm)`
          : recon.closingBalance < 0
            ? `Avans: ${fmt(-recon.closingBalance)} so'm`
            : "Qarzdorlik yo'q — hisob-kitob to'liq amalga oshirilgan",
      ])
      verdict.font = { bold: true }
      ws.mergeCells(`A${verdict.number}:${lastCol}${verdict.number}`)
    }

    // Summa ustunlari ming ajratgichi bilan
    for (const col of ['D', 'E', ...(showBalance ? ['F'] : [])]) {
      ws.getColumn(col).numFmt = '# ##0'
      ws.getColumn(col).alignment = { horizontal: 'right' }
    }

    const safe = entity.name.replace(/[^\p{L}0-9\s-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 40)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''akt_sverka_${encodeURIComponent(safe)}.xlsx`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
