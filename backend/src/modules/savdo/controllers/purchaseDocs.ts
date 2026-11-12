// Savdo — kirim HUJJATLARI (import): ko'p qatorli, valyutali, xarajatli.
// Hisob: services/purchaseService.ts + lib/landedCost.ts. Bu yerda faqat HTTP.

import { Response, NextFunction } from 'express'
import { formatUzDate } from '../../../lib/dateFormat'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { paginate, paginatedResponse } from '../../../types'
import { savdoDateRange } from '../lib/dateRange'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'
import { SavdoError } from '../lib/savdoError'
import { qn } from '../lib/qty'
import { printPage, sellerRows } from '../lib/printLayout'
import { esc, fmt, amountInWords } from './receiptPrint'
import {
  createPurchaseDoc, updatePurchaseDoc, cancelPurchaseDoc, PurchaseDocInput,
} from '../services/purchaseService'

function fail(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof SavdoError) {
    res.status(err.statusCode).json({ success: false, error: err.message })
    return
  }
  next(err)
}

function bodyToInput(orgId: string, actorId: string, b: any): PurchaseDocInput {
  return {
    orgId, actorId,
    warehouseId: b.warehouseId,
    supplierId: b.supplierId || null,
    invoiceNumber: b.invoiceNumber ? String(b.invoiceNumber).trim() : null,
    currency: b.currency,
    exchangeRate: b.exchangeRate !== undefined ? Number(b.exchangeRate) : undefined,
    allocBy: b.allocBy === 'quantity' ? 'quantity' : 'value',
    minWage: b.minWage != null && b.minWage !== '' ? Number(b.minWage) : null,
    isOfficial: b.isOfficial !== false,
    notes: b.notes ? String(b.notes).trim() : null,
    costs: Array.isArray(b.costs) ? b.costs : [],
    lines: Array.isArray(b.lines) ? b.lines : [],
  }
}

async function loadDoc(orgId: string, id: string) {
  const doc = await (prisma as any).savdoPurchaseDoc.findUnique({
    where: { id },
    include: {
      costs: true,
      purchases: {
        where: { status: 'completed' },
        include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!doc || doc.orgId !== orgId) throw new SavdoError('Kirim hujjati topilmadi', 404)
  const [warehouse, supplier] = await Promise.all([
    (prisma as any).savdoWarehouse.findUnique({ where: { id: doc.warehouseId }, select: { id: true, name: true } }),
    doc.supplierId ? (prisma as any).savdoSupplier.findUnique({ where: { id: doc.supplierId }, select: { id: true, name: true } }) : null,
  ])
  return { ...doc, warehouse, supplier }
}

/** Xarajatning so'mdagi jami: umumiy — summaning o'zi, birlikka — summa × hujjatdagi jami miqdor. */
function costAmount(c: any, totalQty: number): number {
  return c.mode === 'per_unit' ? Number(c.amount) * totalQty : Number(c.amount)
}

function docTotals(doc: any) {
  const totalQty = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity), 0)
  const goodsForeign = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity) * Number(p.foreignPrice ?? 0), 0)
  // Xarajat jami: qo'lda kiritilgan xarajatlar + qatorlardagi yig'imlar (utilizatsiya va h.k.)
  const extra = doc.costs.reduce((s: number, c: any) => s + costAmount(c, totalQty), 0)
    + doc.purchases.reduce((s: number, p: any) => s + Number(p.levyAmount ?? 0), 0)
  const landed = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity) * Number(p.unitCost), 0)
  const levy = doc.purchases.reduce((s: number, p: any) => s + Number(p.levyAmount ?? 0), 0)
  return {
    levy: Math.round(levy * 100) / 100,
    goodsForeign: Math.round(goodsForeign * 100) / 100,
    goodsLocal: Math.round(goodsForeign * Number(doc.exchangeRate) * 100) / 100,
    extra: Math.round(extra * 100) / 100,
    landed: Math.round(landed * 100) / 100,
  }
}

export async function listPurchaseDocs(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)
    const where: any = { orgId }
    if (q.supplierId) where.supplierId = q.supplierId
    const dateFilter = savdoDateRange(q.from, q.to)
    if (dateFilter) where.createdAt = dateFilter

    const [total, docs] = await Promise.all([
      (prisma as any).savdoPurchaseDoc.count({ where }),
      (prisma as any).savdoPurchaseDoc.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
        include: { costs: true, purchases: { where: { status: 'completed' }, select: { quantity: true, unitCost: true, foreignPrice: true } } },
      }),
    ])
    const whIds = [...new Set(docs.map((d: any) => d.warehouseId))]
    const supIds = [...new Set(docs.map((d: any) => d.supplierId).filter(Boolean))]
    const [whs, sups] = await Promise.all([
      (prisma as any).savdoWarehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, name: true } }),
      (prisma as any).savdoSupplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } }),
    ])
    const whMap = new Map(whs.map((w: any) => [w.id, w.name]))
    const supMap = new Map(sups.map((s: any) => [s.id, s.name]))
    const rows = docs.map((d: any) => ({
      id: d.id, createdAt: d.createdAt, status: d.status, invoiceNumber: d.invoiceNumber,
      currency: d.currency, exchangeRate: Number(d.exchangeRate), isOfficial: d.isOfficial,
      warehouseName: whMap.get(d.warehouseId) ?? '', supplierName: d.supplierId ? supMap.get(d.supplierId) ?? '' : '',
      lineCount: d.purchases.length, ...docTotals(d),
    }))
    res.json(paginatedResponse(rows, total, page, limit))
  } catch (err) { next(err) }
}

export async function getPurchaseDoc(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await loadDoc(req.savdoUser!.orgId, req.params.id)
    res.json({ success: true, data: { ...doc, totals: docTotals(doc) } })
  } catch (err) { fail(res, next, err) }
}

export async function createPurchaseDocHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const doc = await createPurchaseDoc(bodyToInput(actor.orgId, actorId, req.body))
    res.status(201).json({ success: true, data: doc, message: 'Kirim hujjati saqlandi' })
  } catch (err) { fail(res, next, err) }
}

// Faqat admin (route darajasida): tasdiqlangan hujjatni qayta ochib tahrirlash
export async function updatePurchaseDocHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const doc = await updatePurchaseDoc(req.params.id, bodyToInput(actor.orgId, actorId, req.body))
    res.json({ success: true, data: doc, message: 'Kirim hujjati yangilandi' })
  } catch (err) { fail(res, next, err) }
}

export async function cancelPurchaseDocHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    await cancelPurchaseDoc(actor.orgId, req.params.id, actorId)
    res.json({ success: true, data: null, message: 'Kirim hujjati bekor qilindi' })
  } catch (err) { fail(res, next, err) }
}

export async function exportPurchaseDocXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await loadDoc(req.savdoUser!.orgId, req.params.id)
    const { wb, ws } = newWorkbook('Kirim hujjati')
    ws.columns = [
      { header: '№', key: 'n', width: 6 },
      { header: 'Mahsulot', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Miqdor', key: 'qty', width: 12 },
      { header: 'Birlik', key: 'unit', width: 8 },
      { header: `Narx (${doc.currency})`, key: 'price', width: 14 },
      { header: 'Xarajat ulushi (so\'m)', key: 'extra', width: 18 },
      { header: 'To\'liq tannarx (so\'m)', key: 'cost', width: 18 },
      { header: 'Summa (so\'m)', key: 'total', width: 16 },
    ]
    doc.purchases.forEach((p: any, i: number) => ws.addRow({
      n: i + 1, product: p.product.name, sku: p.product.sku, qty: qn(p.quantity), unit: p.product.unit,
      price: p.foreignPrice != null ? Number(p.foreignPrice) : '', extra: Number(p.extraCost),
      cost: Number(p.unitCost), total: Math.round(qn(p.quantity) * Number(p.unitCost) * 100) / 100,
    }))
    ws.addRow({})
    const qtySum = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity), 0)
    for (const c of doc.costs) {
      ws.addRow({
        product: c.mode === 'per_unit' ? `Xarajat: ${c.label} (${Number(c.amount)} so'm × ${qtySum} birlik)` : `Xarajat: ${c.label} (umumiy)`,
        total: costAmount(c, qtySum),
      })
    }
    for (const p of doc.purchases) {
      if (Number(p.levyAmount) > 0) {
        ws.addRow({
          product: `Yig'im: ${p.levyName} — ${p.product.name} (${Number(p.levyPercent)}% ${p.levyBasis === 'per_kg' ? 'kg' : 'dona'}ga, ${p.levyBasis === 'per_kg' ? `${qn(p.quantity) * Number(p.unitWeightKg ?? 0)} kg` : `${qn(p.quantity)} dona`})`,
          total: Number(p.levyAmount),
        })
      }
    }
    const t = docTotals(doc)
    const tr = ws.addRow({ product: 'JAMI tannarx', total: t.landed })
    tr.font = { bold: true }
    styleWorksheet(ws)
    await sendWorkbook(wb, `kirim-${doc.invoiceNumber || doc.id.slice(0, 8)}.xlsx`, res)
  } catch (err) { fail(res, next, err) }
}

export async function printPurchaseDoc(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const doc = await loadDoc(orgId, req.params.id)
    const settings = await (prisma as any).savdoOrgSettings.findUnique({ where: { orgId } })
    const t = docTotals(doc)
    const rows = doc.purchases.map((p: any, i: number) => `
      <tr><td class="c">${i + 1}</td><td>${esc(p.product.name)} <span class="muted">(${esc(p.product.sku)})</span></td>
      <td class="c">${qn(p.quantity)} ${esc(p.product.unit)}</td>
      <td class="r">${p.foreignPrice != null ? Number(p.foreignPrice).toLocaleString('ru-RU') : '—'}</td>
      <td class="r">${fmt(p.unitCost)}</td><td class="r">${fmt(qn(p.quantity) * Number(p.unitCost))}</td></tr>`).join('')
    const qtyAll = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity), 0)
    const costRows = doc.costs.map((c: any) => `<tr><td>${esc(c.label)}${c.mode === 'per_unit' ? ` <span class="muted">(${fmt(c.amount)} so'm × ${qtyAll} birlik)</span>` : ' <span class="muted">(umumiy partiya)</span>'}</td><td class="r">${fmt(costAmount(c, qtyAll))}</td></tr>`).join('')
    const foreign = doc.currency !== 'UZS'
    const levyRows = doc.purchases.filter((p: any) => Number(p.levyAmount) > 0).map((p: any) => {
      const perKg = p.levyBasis === 'per_kg'
      const basisQty = perKg ? qn(p.quantity) * Number(p.unitWeightKg ?? 0) : qn(p.quantity)
      return `<tr><td>${esc(p.levyName)} — ${esc(p.product.name)}</td><td class="c">${Number(p.levyPercent)}%</td>
        <td class="c">${basisQty.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} ${perKg ? 'kg' : 'dona'}</td><td class="r">${fmt(p.levyAmount)}</td></tr>`
    }).join('')

    const body = `
      <h1>KIRIM HUJJATI</h1>
      <div class="sub">${formatUzDate(new Date(doc.createdAt))}${doc.invoiceNumber ? ` · Invoys № ${esc(doc.invoiceNumber)}` : ''}${doc.status === 'cancelled' ? ' · BEKOR QILINGAN' : ''}</div>
      <div class="parties">
        <div class="party"><table class="info">${sellerRows(settings, esc, 'Qabul qiluvchi')}</table></div>
        <div class="party"><table class="info">
          <tr><td class="k">Yetkazib beruvchi</td><td class="v">${esc(doc.supplier?.name || '—')}</td></tr>
          <tr><td class="k">Ombor</td><td class="v">${esc(doc.warehouse?.name || '—')}</td></tr>
          ${foreign ? `<tr><td class="k">Valyuta / kurs</td><td class="v">${esc(doc.currency)} · 1 = ${Number(doc.exchangeRate).toLocaleString('ru-RU')} so'm</td></tr>` : ''}
        </table></div>
      </div>
      <table class="items">
        <thead><tr><th style="width:6%">№</th><th>Mahsulot</th><th style="width:14%">Miqdor</th>
        <th style="width:14%">Narx${foreign ? ` (${esc(doc.currency)})` : ''}</th><th style="width:16%">Tannarx (so'm)</th><th style="width:16%">Summa (so'm)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5">Jami to'liq tannarx</td><td class="r">${fmt(t.landed)}</td></tr></tfoot>
      </table>
      ${doc.costs.length ? `<table class="items" style="margin-top:5mm"><thead><tr><th>Qo'shimcha xarajat</th><th style="width:25%">Summa (so'm)</th></tr></thead><tbody>${costRows}</tbody>
        <tfoot><tr><td>Jami xarajat</td><td class="r">${fmt(t.extra)}</td></tr></tfoot></table>` : ''}
      ${levyRows ? `<table class="items" style="margin-top:5mm"><thead><tr><th>Yig'im (eng kam oylik ${doc.minWage ? fmt(doc.minWage) + ' so\'m' : ''} dan foiz)</th><th style="width:12%">Foiz</th><th style="width:20%">Asos</th><th style="width:22%">Summa (so'm)</th></tr></thead><tbody>${levyRows}</tbody><tfoot><tr><td colspan="3">Jami yig'im</td><td class="r">${fmt(t.levy)}</td></tr></tfoot></table>` : ''}
      <div class="box"><div class="big">${fmt(t.landed)} so'm</div><div class="words">${esc(amountInWords(t.landed))} so'm</div></div>
      ${doc.notes ? `<div class="terms"><b>Izoh:</b> ${esc(doc.notes)}</div>` : ''}
      <div class="sign">
        <div><div class="line"></div><div class="cap">Topshirdi (imzo)</div></div>
        <div><div class="line"></div><div class="cap">Qabul qildi (imzo)</div></div>
      </div>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(printPage('Kirim hujjati', body))
  } catch (err) { fail(res, next, err) }
}
