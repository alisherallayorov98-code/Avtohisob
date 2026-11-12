// Savdo — A4 chop etish sahifalarining umumiy qobig'i (kirim, spetsifikatsiya,
// inventarizatsiya). receiptPrint.ts bilan bir xil sabab: pdfkit o'zbekcha
// belgilarni chizmaydi, shuning uchun brauzerda Ctrl+P -> PDF.

export function printPage(title: string, body: string, opts: { landscape?: boolean } = {}): string {
  const size = opts.landscape ? 'A4 landscape' : 'A4'
  const maxW = opts.landscape ? '277mm' : '190mm'
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html>
<html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { size: ${size}; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system,"Segoe UI",Roboto,Arial,sans-serif; margin: 0; padding: 12mm; color: #1c1917; background: #f5f5f4;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: ${maxW}; margin: 0 auto; background: #fff; padding: 12mm; border: 1px solid #e7e5e4; border-radius: 6px; }
  h1 { font-size: 15pt; margin: 0 0 1mm; text-align: center; }
  .sub { text-align: center; color: #78716c; font-size: 9pt; margin-bottom: 5mm; }
  .parties { display: flex; gap: 8mm; margin-bottom: 5mm; }
  .party { flex: 1; }
  table.info { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.info td { padding: 1mm 0; vertical-align: top; }
  table.info td.k { color: #78716c; width: 32%; }
  table.info td.v { font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 3mm; }
  table.items th { background: #fef3c7; color: #92400e; padding: 2mm; text-align: left; border: 1px solid #fde68a; }
  table.items td { padding: 2mm; border: 1px solid #e7e5e4; }
  table.items td.c { text-align: center; } table.items td.r { text-align: right; }
  table.items tfoot td { font-weight: 700; background: #fafaf9; }
  .muted { color: #a8a29e; font-size: 8pt; }
  .box { margin: 4mm 0; padding: 3mm; background: #fffbeb; border-radius: 6px; font-size: 9.5pt; }
  .box .big { font-size: 13pt; font-weight: 800; color: #92400e; }
  .words { font-size: 8.5pt; color: #57534e; font-style: italic; margin-top: 1mm; }
  .terms { font-size: 9pt; margin-top: 4mm; line-height: 1.5; }
  .terms b { color: #92400e; }
  .sign { margin-top: 10mm; display: flex; justify-content: space-between; font-size: 9pt; gap: 10mm; }
  .sign div { flex: 1; }
  .line { border-bottom: 1px solid #a8a29e; height: 8mm; }
  .cap { font-size: 8pt; color: #78716c; text-align: center; margin-top: 1mm; }
  .blank { height: 6mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #b45309; padding-bottom: 3mm; margin-bottom: 4mm; }
  .head h1 { text-align: left; font-size: 17pt; margin: 0; color: #78350f; letter-spacing: .3px; }
  .head .no { text-align: right; font-size: 10pt; color: #57534e; }
  .head .no b { display: block; font-size: 13pt; color: #92400e; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm 6mm; margin-bottom: 4mm; font-size: 9pt; }
  .meta div span { display: block; color: #78716c; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .4px; }
  .meta div b { font-size: 10pt; }
  .two { display: flex; gap: 6mm; margin-top: 5mm; align-items: flex-start; }
  .two > div { flex: 1; }
  h3.sec { font-size: 9.5pt; margin: 0 0 1.5mm; color: #92400e; text-transform: uppercase; letter-spacing: .4px; }
  .sumgrid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3mm; margin-top: 5mm; }
  .chip { border: 1px solid #fde68a; background: #fffbeb; border-radius: 5px; padding: 2.5mm 3mm; }
  .chip span { display: block; font-size: 7.5pt; color: #78716c; text-transform: uppercase; letter-spacing: .3px; }
  .chip b { font-size: 11.5pt; color: #1c1917; }
  .chip.main { background: #92400e; border-color: #92400e; }
  .chip.main span, .chip.main b { color: #fff; }
  .chip small { display: block; font-size: 7.5pt; color: #a8a29e; }
  .chip.main small { color: #fde68a; }
  .foot { margin-top: 6mm; font-size: 7.5pt; color: #a8a29e; display: flex; justify-content: space-between; }
  table.items tr { page-break-inside: avoid; }
  .btn { display: block; width: 100%; margin: 0 auto 5mm; max-width: 190mm; padding: 3mm; font-size: 11pt; font-weight: 600;
    color: #fff; background: #b45309; border: 0; border-radius: 6px; cursor: pointer; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: 0; border-radius: 0; padding: 0; max-width: none; } .btn { display: none; } }
</style></head><body>
<button class="btn" onclick="window.print()">🖨 Chop etish / PDF saqlash</button>
<div class="sheet">${body}</div>
</body></html>`
}

/** Sotuvchi (korxona) rekvizitlari jadvali — bo'sh maydonlar chiqarilmaydi. */
export function sellerRows(settings: any, esc: (s: unknown) => string, label = 'Sotuvchi'): string {
  if (!settings?.companyName) return `<tr><td class="k">${label}</td><td class="v">—</td></tr>`
  return `
    <tr><td class="k">${label}</td><td class="v">${esc(settings.companyName)}</td></tr>
    ${settings.stir ? `<tr><td class="k">STIR</td><td class="v">${esc(settings.stir)}</td></tr>` : ''}
    ${settings.address ? `<tr><td class="k">Manzil</td><td class="v">${esc(settings.address)}</td></tr>` : ''}
    ${settings.phone ? `<tr><td class="k">Telefon</td><td class="v">${esc(settings.phone)}</td></tr>` : ''}
    ${settings.bankAccount ? `<tr><td class="k">H/r</td><td class="v">${esc(settings.bankAccount)} ${esc(settings.bankName || '')}</td></tr>` : ''}
    ${settings.director ? `<tr><td class="k">Direktor</td><td class="v">${esc(settings.director)}</td></tr>` : ''}`
}
