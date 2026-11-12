// Savdo — kirim HUJJATLARI (import): ko'p qatorli, valyutali, ikki guruh xarajatli
// (bojxona / qo'shimcha), yig'imli (utilizatsiya), qoralama bilan.
// Hisob: services/purchaseService.ts + lib/landedCost.ts + lib/levyCalc.ts. Bu yerda faqat HTTP va hujjat shakli.

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
import { printPage } from '../lib/printLayout'
import { esc, fmt, amountInWords } from './receiptPrint'
import {
  createPurchaseDoc, updatePurchaseDoc, cancelPurchaseDoc, PurchaseDocInput,
  saveDocDraft, postDocDraft, deleteDocDraft, updateDocMeta,
} from '../services/purchaseService'

const r2 = (n: number): number => Math.round(n * 100) / 100

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
      // Bekor qilingan hujjatda qatorlar ham 'cancelled' — ular ko'rinib turishi kerak (aks holda hujjat bo'sh/nol chiqadi)
      purchases: {
        include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!doc || doc.orgId !== orgId) throw new SavdoError('Kirim hujjati topilmadi', 404)
  if (doc.status !== 'cancelled') doc.purchases = doc.purchases.filter((p: any) => p.status === 'completed')
  const [warehouse, supplier] = await Promise.all([
    doc.warehouseId ? (prisma as any).savdoWarehouse.findUnique({ where: { id: doc.warehouseId }, select: { id: true, name: true } }) : null,
    doc.supplierId ? (prisma as any).savdoSupplier.findUnique({ where: { id: doc.supplierId }, select: { id: true, name: true } }) : null,
  ])
  return { ...doc, warehouse, supplier }
}

/** Xarajatning so'mdagi jami: umumiy — summaning o'zi, birlikka — summa × hujjatdagi jami miqdor. */
function costAmount(c: any, totalQty: number): number {
  return c.mode === 'per_unit' ? Number(c.amount) * totalQty : Number(c.amount)
}

/** Hujjat jamilari: tovar, bojxona, qo'shimcha, yig'im, jami xarajat va to'liq tannarx. */
function docTotals(doc: any) {
  const totalQty = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity), 0)
  const totalWeight = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity) * Number(p.unitWeightKg ?? 0), 0)
  const goodsForeign = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity) * Number(p.foreignPrice ?? 0), 0)
  const goodsLocal = goodsForeign * Number(doc.exchangeRate)
  const sumGroup = (g: string) => doc.costs.filter((c: any) => (c.group || 'other') === g).reduce((s: number, c: any) => s + costAmount(c, totalQty), 0)
  const customs = sumGroup('customs')
  const other = sumGroup('other')
  const levy = doc.purchases.reduce((s: number, p: any) => s + Number(p.levyAmount ?? 0), 0)
  const extra = customs + other + levy
  const landed = doc.purchases.reduce((s: number, p: any) => s + qn(p.quantity) * Number(p.unitCost), 0)
  return {
    totalQty: Math.round(totalQty * 1000) / 1000,
    totalWeight: Math.round(totalWeight * 1000) / 1000,
    goodsForeign: r2(goodsForeign), goodsLocal: r2(goodsLocal),
    customs: r2(customs), other: r2(other), levy: r2(levy), extra: r2(extra),
    extraPct: goodsLocal > 0 ? r2((extra / goodsLocal) * 100) : 0,
    landed: r2(landed),
  }
}

export async function listPurchaseDocs(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)
    const where: any = { orgId }
    if (q.supplierId) where.supplierId = q.supplierId
    if (q.status) where.status = q.status
    const dateFilter = savdoDateRange(q.from, q.to)
    if (dateFilter) where.createdAt = dateFilter

    const [total, docs] = await Promise.all([
      (prisma as any).savdoPurchaseDoc.count({ where }),
      (prisma as any).savdoPurchaseDoc.findMany({
        where, skip, take: limit,
        // Qoralamalar yuqorida (davom ettirilishi kerak), keyin yangilari
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          costs: true,
          purchases: { select: { status: true, quantity: true, unitCost: true, foreignPrice: true, unitWeightKg: true, levyAmount: true } },
        },
      }),
    ])
    const whIds = [...new Set(docs.map((d: any) => d.warehouseId).filter(Boolean))]
    const supIds = [...new Set(docs.map((d: any) => d.supplierId).filter(Boolean))]
    const [whs, sups] = await Promise.all([
      (prisma as any).savdoWarehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, name: true } }),
      (prisma as any).savdoSupplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } }),
    ])
    const whMap = new Map(whs.map((w: any) => [w.id, w.name]))
    const supMap = new Map(sups.map((s: any) => [s.id, s.name]))
    for (const d of docs) {
      if (d.status !== 'cancelled') d.purchases = d.purchases.filter((p: any) => p.status === 'completed')
    }
    const rows = docs.map((d: any) => ({
      id: d.id, number: d.number, createdAt: d.createdAt, updatedAt: d.updatedAt, status: d.status,
      invoiceNumber: d.invoiceNumber, currency: d.currency, exchangeRate: Number(d.exchangeRate), isOfficial: d.isOfficial,
      warehouseName: d.warehouseId ? whMap.get(d.warehouseId) ?? '' : '',
      supplierName: d.supplierId ? supMap.get(d.supplierId) ?? '' : '',
      lineCount: d.status === 'draft' ? (Array.isArray(d.draftPayload?.lines) ? d.draftPayload.lines.length : 0) : d.purchases.length,
      ...docTotals(d),
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

// Faqat admin (route darajasida): kirim qilingan hujjatni qayta ochib tahrirlash
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

// ── Qoralama ──────────────────────────────────────────────────────────────────
export async function saveDraftHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const doc = await saveDocDraft(actor.orgId, actorId, req.body.docId || null, req.body)
    res.json({ success: true, data: { id: doc.id }, message: 'Qoralama saqlandi — keyinroq davom ettirishingiz mumkin' })
  } catch (err) { fail(res, next, err) }
}

export async function postDraftHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const doc = await postDocDraft(actor.orgId, req.params.id, actorId)
    res.json({ success: true, data: doc, message: 'Kirim qilindi' })
  } catch (err) { fail(res, next, err) }
}

export async function deleteDraftHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await deleteDocDraft(req.savdoUser!.orgId, req.params.id)
    res.json({ success: true, data: null, message: 'Qoralama o\'chirildi' })
  } catch (err) { fail(res, next, err) }
}

// Faqat admin: kirim qilingan hujjat ma'lumotini (invoys, yetkazib beruvchi, izoh) tuzatish —
// tovar sotilgan bo'lsa ham ishlaydi, ombor va tannarxga tegmaydi
export async function updateMetaHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { invoiceNumber, supplierId, notes, isOfficial } = req.body
    const doc = await updateDocMeta(req.savdoUser!.orgId, req.params.id, { invoiceNumber, supplierId, notes, isOfficial })
    res.json({ success: true, data: doc, message: 'Ma\'lumot tuzatildi' })
  } catch (err) { fail(res, next, err) }
}

const GROUP_LABEL: Record<string, string> = { customs: 'Bojxona xarajatlari', other: 'Qo\'shimcha xarajatlar' }

export async function exportPurchaseDocXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await loadDoc(req.savdoUser!.orgId, req.params.id)
    const t = docTotals(doc)
    const { wb, ws } = newWorkbook('Kirim hujjati')
    ws.columns = [
      { header: '№', key: 'n', width: 6 },
      { header: 'Mahsulot', key: 'product', width: 34 },
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Miqdor', key: 'qty', width: 12 },
      { header: 'Birlik', key: 'unit', width: 8 },
      { header: 'Og\'irlik, kg', key: 'weight', width: 12 },
      { header: `Narx (${doc.currency})`, key: 'price', width: 14 },
      { header: 'Bojxona (so\'m)', key: 'customs', width: 16 },
      { header: 'Qo\'shimcha (so\'m)', key: 'other', width: 17 },
      { header: 'Yig\'im (so\'m)', key: 'levy', width: 15 },
      { header: 'To\'liq tannarx (so\'m)', key: 'cost', width: 18 },
      { header: 'Summa (so\'m)', key: 'total', width: 17 },
    ]
    doc.purchases.forEach((p: any, i: number) => ws.addRow({
      n: i + 1, product: p.product.name, sku: p.product.sku, qty: qn(p.quantity), unit: p.product.unit,
      weight: p.unitWeightKg != null ? Math.round(qn(p.quantity) * Number(p.unitWeightKg) * 1000) / 1000 : '',
      price: p.foreignPrice != null ? Number(p.foreignPrice) : '',
      customs: Number(p.extraCustoms), other: Number(p.extraOther), levy: Number(p.levyAmount),
      cost: Number(p.unitCost), total: r2(qn(p.quantity) * Number(p.unitCost)),
    }))
    ws.addRow({})
    for (const g of ['customs', 'other']) {
      for (const c of doc.costs.filter((x: any) => (x.group || 'other') === g)) {
        ws.addRow({
          product: `${GROUP_LABEL[g]}: ${c.label}${c.mode === 'per_unit' ? ` (${Number(c.amount)} so'm × ${t.totalQty} birlik)` : ''}`,
          total: r2(costAmount(c, t.totalQty)),
        })
      }
    }
    ws.addRow({})
    const bold = (row: any) => { row.font = { bold: true } }
    bold(ws.addRow({ product: 'Tovar qiymati (so\'m)', total: t.goodsLocal }))
    bold(ws.addRow({ product: 'Bojxona xarajatlari', total: t.customs }))
    bold(ws.addRow({ product: 'Qo\'shimcha xarajatlar', total: t.other }))
    bold(ws.addRow({ product: 'Yig\'im (utilizatsiya va h.k.)', total: t.levy }))
    bold(ws.addRow({ product: `Jami xarajat (tovar qiymatining ${t.extraPct}%)`, total: t.extra }))
    bold(ws.addRow({ product: 'JAMI to\'liq tannarx', total: t.landed }))
    styleWorksheet(ws)
    await sendWorkbook(wb, `kirim-${doc.number || doc.invoiceNumber || doc.id.slice(0, 8)}.xlsx`, res)
  } catch (err) { fail(res, next, err) }
}

/** Import kirim hujjati — landscape A4: jadval, ikki guruh xarajat, xulosa, imzolar. */
export async function printPurchaseDoc(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const doc = await loadDoc(orgId, req.params.id)
    const settings = await (prisma as any).savdoOrgSettings.findUnique({ where: { orgId } })
    const t = docTotals(doc)
    const foreign = doc.currency !== 'UZS'
    const num = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })

    const rows = doc.purchases.map((p: any, i: number) => {
      const q = qn(p.quantity)
      const w = p.unitWeightKg != null ? q * Number(p.unitWeightKg) : null
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(p.product.name)} <span class="muted">${esc(p.product.sku)}</span>${p.levyName ? `<div class="muted">${esc(p.levyName)}: ${Number(p.levyPercent)}%</div>` : ''}</td>
        <td class="r">${num(q)} ${esc(p.product.unit)}</td>
        <td class="r">${w != null ? num(w) : '—'}</td>
        <td class="r">${p.foreignPrice != null ? Number(p.foreignPrice).toLocaleString('ru-RU') : '—'}</td>
        <td class="r">${p.foreignPrice != null ? fmt(q * Number(p.foreignPrice) * Number(doc.exchangeRate)) : '—'}</td>
        <td class="r">${Number(p.extraCustoms) ? fmt(p.extraCustoms) : '—'}</td>
        <td class="r">${Number(p.extraOther) ? fmt(p.extraOther) : '—'}</td>
        <td class="r">${Number(p.levyAmount) ? fmt(p.levyAmount) : '—'}</td>
        <td class="r">${fmt(p.unitCost)}</td>
        <td class="r"><b>${fmt(q * Number(p.unitCost))}</b></td></tr>`
    }).join('')

    const costTable = (group: 'customs' | 'other') => {
      const list = doc.costs.filter((c: any) => (c.group || 'other') === group)
      const sum = group === 'customs' ? t.customs : t.other
      const body = list.length
        ? list.map((c: any) => `<tr><td>${esc(c.label)}</td>
            <td class="muted">${c.mode === 'per_unit' ? `${fmt(c.amount)} so'm × ${num(t.totalQty)} birlik` : 'butun partiya'}</td>
            <td class="r">${fmt(costAmount(c, t.totalQty))}</td></tr>`).join('')
        : '<tr><td colspan="3" class="muted">—</td></tr>'
      return `<div><h3 class="sec">${GROUP_LABEL[group]}</h3>
        <table class="items"><thead><tr><th>Nomi</th><th style="width:34%">Hisoblash</th><th style="width:24%">Summa, so'm</th></tr></thead>
        <tbody>${body}</tbody><tfoot><tr><td colspan="2">Jami</td><td class="r">${fmt(sum)}</td></tr></tfoot></table></div>`
    }

    const levyRows = doc.purchases.filter((p: any) => Number(p.levyAmount) > 0).map((p: any) => {
      const perKg = p.levyBasis === 'per_kg'
      const basisQty = perKg ? qn(p.quantity) * Number(p.unitWeightKg ?? 0) : qn(p.quantity)
      return `<tr><td>${esc(p.levyName)} — ${esc(p.product.name)}</td><td class="r">${Number(p.levyPercent)}%</td>
        <td class="r">${num(basisQty)} ${perKg ? 'kg' : 'dona'}</td><td class="r">${fmt(p.levyAmount)}</td></tr>`
    }).join('')
    const levyBlock = levyRows ? `<div><h3 class="sec">Yig'im (utilizatsiya va h.k.)${doc.minWage ? ` — eng kam oylik ${fmt(doc.minWage)} so'm` : ''}</h3>
        <table class="items"><thead><tr><th>Yig'im — mahsulot</th><th style="width:14%">Foiz</th><th style="width:22%">Asos</th><th style="width:24%">Summa, so'm</th></tr></thead>
        <tbody>${levyRows}</tbody><tfoot><tr><td colspan="3">Jami</td><td class="r">${fmt(t.levy)}</td></tr></tfoot></table></div>` : ''

    const chip = (label: string, value: string, extra = '', main = false) =>
      `<div class="chip${main ? ' main' : ''}"><span>${label}</span><b>${value}</b>${extra ? `<small>${extra}</small>` : ''}</div>`
    const statusNote = doc.status === 'cancelled' ? ' · BEKOR QILINGAN' : ''

    const body = `
      <div class="head">
        <h1>IMPORT KIRIM HUJJATI${statusNote}</h1>
        <div class="no">№<b>${esc(doc.number || doc.id.slice(0, 8).toUpperCase())}</b>${formatUzDate(new Date(doc.createdAt))}</div>
      </div>
      <div class="meta">
        <div><span>Qabul qiluvchi</span><b>${esc(settings?.companyName || '—')}</b></div>
        <div><span>Yetkazib beruvchi</span><b>${esc(doc.supplier?.name || '—')}</b></div>
        <div><span>Invoys / faktura №</span><b>${esc(doc.invoiceNumber || '—')}</b></div>
        <div><span>Ombor</span><b>${esc(doc.warehouse?.name || '—')}</b></div>
        <div><span>Valyuta / kurs</span><b>${foreign ? `${esc(doc.currency)} · 1 = ${Number(doc.exchangeRate).toLocaleString('ru-RU')} so'm` : "so'm"}</b></div>
        <div><span>Xarajat taqsimlash</span><b>${doc.allocBy === 'quantity' ? 'miqdor bo\'yicha' : 'qiymat bo\'yicha'}</b></div>
        <div><span>Turi</span><b>${doc.isOfficial ? 'Rasmiy (fakturali)' : 'Norasmiy'}</b></div>
        <div><span>Jami miqdor / og'irlik</span><b>${num(t.totalQty)}${t.totalWeight ? ` · ${num(t.totalWeight)} kg` : ''}</b></div>
      </div>

      <table class="items">
        <thead><tr>
          <th style="width:3%">№</th><th>Mahsulot</th><th style="width:8%">Miqdor</th><th style="width:7%">Og'irlik, kg</th>
          <th style="width:7%">Narx${foreign ? `, ${esc(doc.currency)}` : ''}</th><th style="width:10%">Tovar, so'm</th>
          <th style="width:8%">Bojxona</th><th style="width:8%">Qo'shimcha</th><th style="width:8%">Yig'im</th>
          <th style="width:8%">Tannarx / birlik</th><th style="width:10%">Jami tannarx</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5">JAMI</td><td class="r">${fmt(t.goodsLocal)}</td><td class="r">${fmt(t.customs)}</td>
          <td class="r">${fmt(t.other)}</td><td class="r">${fmt(t.levy)}</td><td></td><td class="r">${fmt(t.landed)}</td></tr></tfoot>
      </table>

      <div class="two">${costTable('customs')}${costTable('other')}${levyBlock}</div>

      <div class="sumgrid">
        ${chip('Tovar qiymati', fmt(t.goodsLocal) + " so'm", foreign ? `${t.goodsForeign.toLocaleString('ru-RU')} ${esc(doc.currency)}` : '')}
        ${chip('Bojxona xarajatlari', fmt(t.customs) + " so'm")}
        ${chip("Qo'shimcha xarajatlar", fmt(t.other) + " so'm", 'sertifikat, transport, deklarant ...')}
        ${chip("Yig'im (utilizatsiya)", fmt(t.levy) + " so'm")}
        ${chip('Jami xarajat', fmt(t.extra) + " so'm", `tovar qiymatining ${t.extraPct}%`)}
        ${chip("TO'LIQ TANNARX", fmt(t.landed) + " so'm", '', true)}
      </div>
      <div class="words" style="margin-top:2mm">${esc(amountInWords(t.landed))} so'm</div>
      ${doc.notes ? `<div class="terms"><b>Izoh:</b> ${esc(doc.notes)}</div>` : ''}

      <div class="sign" style="gap:8mm">
        <div><div class="line"></div><div class="cap">Tayyorladi</div></div>
        <div><div class="line"></div><div class="cap">Omborchi (qabul qildi)</div></div>
        <div><div class="line"></div><div class="cap">Bosh hisobchi</div></div>
        <div><div class="line"></div><div class="cap">Direktor${settings?.director ? ` — ${esc(settings.director)}` : ''}</div></div>
      </div>
      <div class="foot"><span>${esc(settings?.companyName || '')}</span><span>Chop etildi: ${formatUzDate(new Date())}</span></div>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(printPage(`Kirim ${doc.number || ''}`, body, { landscape: true }))
  } catch (err) { fail(res, next, err) }
}
