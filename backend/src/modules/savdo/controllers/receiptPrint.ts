// Hisob-faktura chop etish (A4 HTML) — EkoHisob receiptPrint.ts pattern bilan bir xil
// sabab: pdfkit o'zbekcha belgilarni (ʻ) to'g'ri chizmaydi, shuning uchun chop etishga
// tayyor HTML qaytariladi, brauzer Ctrl+P → "PDF saqlash" bilan yakunlaydi.
// "Topshirdi / Qabul qildi" imzo bloklari bilan — yo'lda hamrohlik qiluvchi hujjat
// sifatida ham ishlatilishi mumkin.

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function amountInWords(n: number): string {
  const ones = ['', 'bir', 'ikki', 'uch', 'to\'rt', 'besh', 'olti', 'yetti', 'sakkiz', 'to\'qqiz']
  const tens = ['', 'o\'n', 'yigirma', 'o\'ttiz', 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', 'to\'qson']
  function under1000(x: number): string {
    const parts: string[] = []
    const h = Math.floor(x / 100)
    if (h > 0) parts.push(`${ones[h]} yuz`)
    const t = Math.floor((x % 100) / 10)
    if (t > 0) parts.push(tens[t])
    const o = x % 10
    if (o > 0) parts.push(ones[o])
    return parts.join(' ')
  }
  let v = Math.round(n)
  if (v === 0) return 'nol'
  const groups: [number, string][] = [[1_000_000_000, 'milliard'], [1_000_000, 'million'], [1000, 'ming']]
  const out: string[] = []
  for (const [base, label] of groups) {
    const q = Math.floor(v / base)
    if (q > 0) { out.push(`${under1000(q)} ${label}`); v %= base }
  }
  if (v > 0) out.push(under1000(v))
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

function fmt(n: number | string): string {
  return Math.round(Number(n)).toLocaleString('ru-RU')
}

export async function printSaleInvoice(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params

    const sale = await (prisma as any).savdoSale.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true, phone: true, address: true } },
        warehouse: { select: { name: true } },
        lines: { include: { product: { select: { name: true, sku: true, unit: true } } } },
      },
    })
    if (!sale || sale.orgId !== orgId) {
      res.status(404).send('Sotuv topilmadi')
      return
    }

    const settings = await (prisma as any).savdoOrgSettings.findUnique({ where: { orgId } })

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(renderInvoiceHtml(sale, settings))
  } catch (err) { next(err) }
}

function renderInvoiceHtml(sale: any, settings: any): string {
  const total = Number(sale.totalAmount)
  const rows = sale.lines.map((l: any, i: number) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.product.name)} <span class="muted">(${esc(l.product.sku)})</span></td>
      <td class="c">${l.quantity} ${esc(l.product.unit)}</td>
      <td class="r">${fmt(l.unitPrice)}</td>
      <td class="r">${fmt(l.lineTotal)}</td>
    </tr>`).join('')

  const seller = settings?.companyName ? `
    <tr><td class="k">Sotuvchi</td><td class="v">${esc(settings.companyName)}</td></tr>
    ${settings.stir ? `<tr><td class="k">STIR</td><td class="v">${esc(settings.stir)}</td></tr>` : ''}
    ${settings.address ? `<tr><td class="k">Manzil</td><td class="v">${esc(settings.address)}</td></tr>` : ''}
    ${settings.phone ? `<tr><td class="k">Telefon</td><td class="v">${esc(settings.phone)}</td></tr>` : ''}
    ${settings.bankAccount ? `<tr><td class="k">H/r</td><td class="v">${esc(settings.bankAccount)} ${esc(settings.bankName || '')}</td></tr>` : ''}
  ` : ''

  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(sale.documentNumber)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    margin: 0; padding: 12mm; color: #1c1917; background: #f5f5f4;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 190mm; margin: 0 auto; background: #fff; padding: 12mm; border: 1px solid #e7e5e4; border-radius: 6px; }
  h1 { font-size: 16pt; margin: 0 0 1mm; text-align: center; }
  .sub { text-align: center; color: #78716c; font-size: 9pt; margin-bottom: 6mm; }
  .num { text-align: center; font-size: 12pt; font-weight: 700; color: #92400e;
    border: 1.5px dashed #fcd34d; border-radius: 6px; padding: 2mm; margin-bottom: 6mm; }
  .parties { display: flex; gap: 8mm; margin-bottom: 6mm; }
  .party { flex: 1; }
  .party h3 { font-size: 9pt; color: #78716c; text-transform: uppercase; margin: 0 0 2mm; }
  table.info { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.info td { padding: 1mm 0; vertical-align: top; }
  table.info td.k { color: #78716c; width: 30%; }
  table.info td.v { font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 3mm; }
  table.items th { background: #fef3c7; color: #92400e; padding: 2mm; text-align: left; border: 1px solid #fde68a; }
  table.items td { padding: 2mm; border: 1px solid #e7e5e4; }
  table.items td.c { text-align: center; }
  table.items td.r { text-align: right; }
  .muted { color: #a8a29e; font-size: 8pt; }
  .amount { margin: 5mm 0; padding: 3mm; background: #fffbeb; border-radius: 6px; text-align: center; }
  .amount .big { font-size: 15pt; font-weight: 800; color: #92400e; }
  .amount .words { font-size: 8.5pt; color: #57534e; margin-top: 1mm; font-style: italic; }
  .sign { margin-top: 10mm; display: flex; justify-content: space-between; font-size: 9pt; }
  .sign div { width: 45%; }
  .line { border-bottom: 1px solid #a8a29e; height: 8mm; }
  .cap { font-size: 8pt; color: #78716c; text-align: center; margin-top: 1mm; }
  .btn { display: block; width: 100%; margin: 0 auto 5mm; max-width: 190mm;
    padding: 3mm; font-size: 11pt; font-weight: 600; color: #fff; background: #b45309;
    border: 0; border-radius: 6px; cursor: pointer; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; border-radius: 0; padding: 0; max-width: none; }
    .btn { display: none; }
  }
</style>
</head>
<body>
<button class="btn" onclick="window.print()">🖨 Chop etish / PDF saqlash</button>
<div class="sheet">
  <h1>HISOB-FAKTURA</h1>
  <div class="sub">Savdo va ombor hisobi</div>
  <div class="num">${esc(sale.documentNumber)} — ${new Date(sale.createdAt).toLocaleDateString('uz-UZ')}</div>

  <div class="parties">
    <div class="party">
      <table class="info">${seller || '<tr><td class="k">Sotuvchi</td><td class="v">—</td></tr>'}</table>
    </div>
    <div class="party">
      <table class="info">
        <tr><td class="k">Xaridor</td><td class="v">${esc(sale.customer?.name || 'Ko\'chadan mijoz')}</td></tr>
        ${sale.customer?.phone ? `<tr><td class="k">Telefon</td><td class="v">${esc(sale.customer.phone)}</td></tr>` : ''}
        ${sale.customer?.address ? `<tr><td class="k">Manzil</td><td class="v">${esc(sale.customer.address)}</td></tr>` : ''}
        <tr><td class="k">Ombor</td><td class="v">${esc(sale.warehouse.name)}</td></tr>
      </table>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr><th style="width:6%">№</th><th>Mahsulot</th><th style="width:14%">Miqdor</th><th style="width:16%">Narx</th><th style="width:16%">Summa</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="amount">
    <div class="big">${fmt(total)} so'm</div>
    <div class="words">${esc(amountInWords(total))} so'm</div>
  </div>

  <div class="sign">
    <div><div class="line"></div><div class="cap">Topshirdi (imzo)</div></div>
    <div><div class="line"></div><div class="cap">Qabul qildi (imzo)</div></div>
  </div>
</div>
</body>
</html>`
}
