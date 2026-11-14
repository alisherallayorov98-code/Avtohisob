// Savdo — spetsifikatsiya HTTP qatlami (hisob/holat: services/specService.ts).

import { Response, NextFunction } from 'express'
import { formatUzDate } from '../../../lib/dateFormat'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { paginate, paginatedResponse } from '../../../types'
import { SavdoError } from '../lib/savdoError'
import { qn } from '../lib/qty'
import { printPage, sellerRows } from '../lib/printLayout'
import { esc, fmt, amountInWords } from './receiptPrint'
import {
  createSpec, updateSpec, confirmSpec, reopenSpec, cancelSpec, specTotals, SpecInput,
} from '../services/specService'
import { backfillAutoSpecs } from '../services/saleService'

function fail(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof SavdoError) {
    res.status(err.statusCode).json({ success: false, error: err.message })
    return
  }
  next(err)
}

function toInput(orgId: string, actorId: string, b: any): SpecInput {
  return {
    orgId, actorId,
    customerId: b.customerId, warehouseId: b.warehouseId,
    contractNumber: b.contractNumber ? String(b.contractNumber).trim() : null,
    contractDate: b.contractDate || null,
    vatRate: b.vatRate !== undefined && b.vatRate !== '' ? Number(b.vatRate) : null,
    paymentTerms: b.paymentTerms ? String(b.paymentTerms).trim() : null,
    deliveryTerms: b.deliveryTerms ? String(b.deliveryTerms).trim() : null,
    validUntil: b.validUntil || null,
    paymentType: b.paymentType || null,
    dueDate: b.dueDate || null,
    notes: b.notes ? String(b.notes).trim() : null,
    lines: Array.isArray(b.lines) ? b.lines : [],
  }
}

async function withProducts(spec: any) {
  const products = await (prisma as any).savdoProduct.findMany({
    where: { id: { in: spec.lines.map((l: any) => l.productId) } },
    select: { id: true, name: true, sku: true, unit: true },
  })
  const map = new Map(products.map((p: any) => [p.id, p]))
  return { ...spec, lines: spec.lines.map((l: any) => ({ ...l, product: map.get(l.productId) ?? null })), totals: specTotals(spec) }
}

export async function listSpecs(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)
    const where: any = { orgId }
    if (q.status) where.status = q.status
    if (q.customerId) where.customerId = q.customerId
    const [total, rows] = await Promise.all([
      (prisma as any).savdoSpec.count({ where }),
      (prisma as any).savdoSpec.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
        include: { lines: true, customer: { select: { id: true, name: true } } },
      }),
    ])
    res.json(paginatedResponse(rows.map((s: any) => ({ ...s, totals: specTotals(s) })), total, page, limit))
  } catch (err) { next(err) }
}

async function getOwn(orgId: string, id: string) {
  const spec = await (prisma as any).savdoSpec.findUnique({ where: { id }, include: { lines: true, customer: true } })
  if (!spec || spec.orgId !== orgId) throw new SavdoError('Spetsifikatsiya topilmadi', 404)
  return spec
}

export async function getSpec(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const spec = await getOwn(req.savdoUser!.orgId, req.params.id)
    res.json({ success: true, data: await withProducts(spec) })
  } catch (err) { fail(res, next, err) }
}

export async function createSpecHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const spec = await createSpec(toInput(actor.orgId, actorId, req.body))
    res.status(201).json({ success: true, data: spec, message: `Spetsifikatsiya ${spec.number} saqlandi` })
  } catch (err) { fail(res, next, err) }
}

export async function updateSpecHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const spec = await updateSpec(req.params.id, toInput(actor.orgId, actorId, req.body))
    res.json({ success: true, data: spec, message: 'Spetsifikatsiya yangilandi' })
  } catch (err) { fail(res, next, err) }
}

export async function confirmSpecHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const r = await confirmSpec(actor.orgId, req.params.id, actorId)
    res.json({ success: true, data: r, message: `Tasdiqlandi — faktura ${r.sale.documentNumber} yaratildi` })
  } catch (err) { fail(res, next, err) }
}

export async function reopenSpecHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const spec = await reopenSpec(actor.orgId, req.params.id, actorId)
    res.json({ success: true, data: spec, message: 'Spetsifikatsiya qayta ochildi (sotuv bekor qilindi)' })
  } catch (err) { fail(res, next, err) }
}

export async function cancelSpecHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const spec = await cancelSpec(req.savdoUser!.orgId, req.params.id)
    res.json({ success: true, data: spec, message: 'Spetsifikatsiya bekor qilindi' })
  } catch (err) { fail(res, next, err) }
}

/** Admin: o'tgan faktura-sotuvlar (yuridik mijoz) uchun spetsifikatsiyalarni yaratish. */
export async function backfillSpecsHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const created = await backfillAutoSpecs(actor.orgId, actorId)
    res.json({
      success: true, data: { created },
      message: created ? `${created} ta spetsifikatsiya yaratildi` : "Spetsifikatsiyasiz yuridik mijoz sotuvi topilmadi",
    })
  } catch (err) { fail(res, next, err) }
}

export async function printSpec(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const spec = await withProducts(await getOwn(orgId, req.params.id))
    const settings = await (prisma as any).savdoOrgSettings.findUnique({ where: { orgId } })
    const c = spec.customer
    const t = spec.totals
    const hasVat = spec.vatRate != null && Number(spec.vatRate) > 0
    const contractNo = spec.contractNumber || c.contractNumber
    const contractDt = spec.contractDate || c.contractDate

    const rows = spec.lines.map((l: any, i: number) => `
      <tr><td class="c">${i + 1}</td><td>${esc(l.product?.name)} <span class="muted">(${esc(l.product?.sku)})</span></td>
      <td class="c">${esc(l.product?.unit)}</td><td class="c">${qn(l.quantity)}</td>
      <td class="r">${fmt(l.unitPrice)}</td><td class="r">${fmt(qn(l.quantity) * Number(l.unitPrice))}</td></tr>`).join('')

    const buyer = `
      <tr><td class="k">Xaridor</td><td class="v">${esc(c.name)}</td></tr>
      ${c.stir ? `<tr><td class="k">STIR</td><td class="v">${esc(c.stir)}</td></tr>` : ''}
      ${c.address ? `<tr><td class="k">Manzil</td><td class="v">${esc(c.address)}</td></tr>` : ''}
      ${c.phone ? `<tr><td class="k">Telefon</td><td class="v">${esc(c.phone)}</td></tr>` : ''}
      ${c.bankAccount ? `<tr><td class="k">H/r</td><td class="v">${esc(c.bankAccount)} ${esc(c.bankName || '')}${c.mfo ? ` MFO ${esc(c.mfo)}` : ''}</td></tr>` : ''}
      ${c.director ? `<tr><td class="k">Direktor</td><td class="v">${esc(c.director)}</td></tr>` : ''}`

    const body = `
      <h1>SPETSIFIKATSIYA № ${esc(spec.number)}</h1>
      <div class="sub">${contractNo ? `Shartnoma № ${esc(contractNo)}${contractDt ? ` (${formatUzDate(new Date(contractDt))})` : ''} ga ilova · ` : ''}${formatUzDate(new Date(spec.createdAt))}${spec.status === 'cancelled' ? ' · BEKOR QILINGAN' : ''}</div>
      <div class="parties">
        <div class="party"><table class="info">${sellerRows(settings, esc, 'Sotuvchi')}</table></div>
        <div class="party"><table class="info">${buyer}</table></div>
      </div>
      <table class="items">
        <thead><tr><th style="width:5%">№</th><th>Mahsulot nomi</th><th style="width:9%">Birlik</th><th style="width:11%">Miqdor</th>
        <th style="width:16%">Narx${hasVat ? ' (QQSsiz)' : ''}</th><th style="width:17%">Summa${hasVat ? ' (QQSsiz)' : ''}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          ${hasVat ? `<tr><td colspan="5">Jami (QQSsiz)</td><td class="r">${fmt(t.subtotal)}</td></tr>
          <tr><td colspan="5">QQS ${Number(spec.vatRate)}%</td><td class="r">${fmt(t.vatAmount)}</td></tr>` : ''}
          <tr><td colspan="5">${hasVat ? 'QQS bilan jami to\'lov' : 'Jami'}</td><td class="r">${fmt(t.total)}</td></tr>
        </tfoot>
      </table>
      <div class="box"><div class="big">${fmt(t.total)} so'm</div><div class="words">${esc(amountInWords(t.total))} so'm${hasVat ? '' : ' (QQSsiz)'}</div></div>
      <div class="terms">
        ${spec.paymentTerms ? `<div><b>To'lov shartlari:</b> ${esc(spec.paymentTerms)}</div>` : ''}
        ${spec.deliveryTerms ? `<div><b>Yetkazib berish:</b> ${esc(spec.deliveryTerms)}</div>` : ''}
        ${spec.validUntil ? `<div><b>Amal qilish muddati:</b> ${formatUzDate(new Date(spec.validUntil))} gacha</div>` : ''}
        ${spec.notes ? `<div><b>Izoh:</b> ${esc(spec.notes)}</div>` : ''}
      </div>
      <div class="sign">
        <div><div class="cap" style="text-align:left">Sotuvchi${settings?.director ? `: ${esc(settings.director)}` : ''}</div><div class="line"></div><div class="cap">imzo / muhr</div></div>
        <div><div class="cap" style="text-align:left">Xaridor${c.director ? `: ${esc(c.director)}` : ''}</div><div class="line"></div><div class="cap">imzo / muhr</div></div>
      </div>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(printPage(`Spetsifikatsiya ${spec.number}`, body))
  } catch (err) { fail(res, next, err) }
}
