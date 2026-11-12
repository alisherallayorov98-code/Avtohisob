// Savdo — inventarizatsiya qoralamasi (HTTP) va chop etish (sanash varaqasi, akt).

import { Response, NextFunction } from 'express'
import { formatUzDate } from '../../../lib/dateFormat'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { SavdoError } from '../lib/savdoError'
import { qn } from '../lib/qty'
import { printPage } from '../lib/printLayout'
import { esc } from './receiptPrint'
import { getInventoryReport } from '../services/inventoryService'
import { saveInventoryDraft, confirmInventoryDraft, deleteInventoryDraft } from '../services/inventoryDraft'

function fail(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof SavdoError) {
    res.status(err.statusCode).json({ success: false, error: err.message })
    return
  }
  next(err)
}

export async function saveDraft(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { warehouseId, lines, notes, draftId } = req.body
    if (!warehouseId) { res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' }); return }
    if (!Array.isArray(lines)) { res.status(400).json({ success: false, error: 'lines talab qilinadi' }); return }
    const countedById = await ensureSavdoActor(actor)
    const draft = await saveInventoryDraft({
      orgId: actor.orgId, warehouseId, countedById, draftId: draftId || null, notes: notes || null,
      lines: lines.map((l: any) => ({ productId: l.productId, countedQty: Number(l.countedQty) })),
    })
    res.json({ success: true, data: draft, message: 'Qoralama saqlandi' })
  } catch (err) { fail(res, next, err) }
}

export async function confirmDraft(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const countedById = await ensureSavdoActor(actor)
    const result = await confirmInventoryDraft(actor.orgId, req.params.id, countedById)
    res.status(201).json({ success: true, data: result, message: 'Inventarizatsiya tasdiqlandi, qoldiq tuzatildi' })
  } catch (err) { fail(res, next, err) }
}

export async function removeDraft(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await deleteInventoryDraft(req.savdoUser!.orgId, req.params.id)
    res.json({ success: true, data: null, message: 'Qoralama o\'chirildi' })
  } catch (err) { fail(res, next, err) }
}

/** Bo'sh sanash varaqasi (qog'ozga): ?warehouseId=...&blind=1 tizim qoldig'ini yashiradi. */
export async function printCountSheet(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { warehouseId, blind } = req.query as Record<string, string>
    if (!warehouseId) { res.status(400).send('warehouseId talab qilinadi'); return }
    const wh = await (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId }, select: { name: true, orgId: true } })
    if (!wh || wh.orgId !== orgId) { res.status(404).send('Ombor topilmadi'); return }
    const report = await getInventoryReport(orgId, warehouseId)
    const items = report.warehouses[0]?.items ?? []
    const hide = blind === '1'
    const rows = items.map((it, i) => `
      <tr><td class="c">${i + 1}</td><td>${esc(it.productName)}</td><td>${esc(it.sku)}</td><td class="c">${esc(it.unit)}</td>
      ${hide ? '' : `<td class="r">${it.quantityOnHand}</td>`}<td></td><td></td></tr>`).join('')
    const body = `
      <h1>INVENTARIZATSIYA VARAQASI</h1>
      <div class="sub">Ombor: ${esc(wh.name)} · ${formatUzDate(new Date())}</div>
      <table class="items"><thead><tr><th style="width:5%">№</th><th>Mahsulot</th><th style="width:14%">SKU</th><th style="width:8%">Birlik</th>
      ${hide ? '' : '<th style="width:12%">Tizim</th>'}<th style="width:14%">Sanalgan</th><th style="width:16%">Izoh</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="sign"><div><div class="line"></div><div class="cap">Sanovchi (imzo)</div></div>
      <div><div class="line"></div><div class="cap">Moddiy javobgar (imzo)</div></div>
      <div><div class="line"></div><div class="cap">Komissiya a'zosi (imzo)</div></div></div>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(printPage('Inventarizatsiya varaqasi', body))
  } catch (err) { fail(res, next, err) }
}

/** Tasdiqlangan inventarizatsiya AKTI (kamomad/ortiqcha) — qog'ozga. */
export async function printCountAct(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const count = await (prisma as any).savdoInventoryCount.findUnique({
      where: { id: req.params.id },
      include: {
        warehouse: { select: { name: true } },
        lines: { include: { product: { select: { name: true, sku: true, unit: true } } } },
      },
    })
    if (!count || count.orgId !== orgId) { res.status(404).send('Topilmadi'); return }
    const changed = count.lines.filter((l: any) => qn(l.diffQty) !== 0)
    const short = changed.filter((l: any) => qn(l.diffQty) < 0).reduce((s: number, l: any) => s + Number(l.diffValue), 0)
    const extra = changed.filter((l: any) => qn(l.diffQty) > 0).reduce((s: number, l: any) => s + Number(l.diffValue), 0)
    const f = (n: number) => Math.round(n).toLocaleString('ru-RU')
    const rows = (changed.length ? changed : count.lines).map((l: any, i: number) => `
      <tr><td class="c">${i + 1}</td><td>${esc(l.product.name)} <span class="muted">(${esc(l.product.sku)})</span></td><td class="c">${esc(l.product.unit)}</td>
      <td class="r">${qn(l.systemQty)}</td><td class="r">${qn(l.countedQty)}</td><td class="r">${qn(l.diffQty)}</td>
      <td class="r">${f(Number(l.unitCost))}</td><td class="r">${f(Number(l.diffValue))}</td></tr>`).join('')
    const body = `
      <h1>INVENTARIZATSIYA AKTI</h1>
      <div class="sub">Ombor: ${esc(count.warehouse.name)} · ${formatUzDate(new Date(count.countedAt))}</div>
      <table class="items"><thead><tr><th>№</th><th>Mahsulot</th><th>Birlik</th><th>Tizim</th><th>Sanalgan</th><th>Farq</th><th>Tannarx</th><th>Farq summasi</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="box">Kamomad: <b>${f(short)}</b> so'm · Ortiqcha: <b>${f(extra)}</b> so'm · Sof natija: <b>${f(short + extra)}</b> so'm</div>
      ${count.notes ? `<div class="terms"><b>Izoh:</b> ${esc(count.notes)}</div>` : ''}
      <div class="sign"><div><div class="line"></div><div class="cap">Sanovchi (imzo)</div></div>
      <div><div class="line"></div><div class="cap">Moddiy javobgar (imzo)</div></div>
      <div><div class="line"></div><div class="cap">Komissiya raisi (imzo)</div></div></div>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(printPage('Inventarizatsiya akti', body))
  } catch (err) { fail(res, next, err) }
}
