// Savdo — zakaz HTTP qatlami (holat/mantiq: services/orderService.ts).

import { Response, NextFunction } from 'express'
import { formatUzDate } from '../../../lib/dateFormat'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { paginate, paginatedResponse } from '../../../types'
import { SavdoError } from '../lib/savdoError'
import { qn } from '../lib/qty'
import { resolveUnitPrice } from '../lib/pricing'
import { printPage } from '../lib/printLayout'
import { esc } from './receiptPrint'
import {
  createOrder, updateOrder, startPicking, markPicked, reopenPicking, sellOrder, cancelOrder, getOrder,
  OrderInput, ORDER_STATUSES,
} from '../services/orderService'

function fail(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof SavdoError) {
    res.status(err.statusCode).json({ success: false, error: err.message })
    return
  }
  next(err)
}

function toInput(orgId: string, actorId: string, b: any): OrderInput {
  return {
    orgId, actorId,
    customerId: b.customerId || null, warehouseId: b.warehouseId,
    vatRate: b.vatRate !== undefined && b.vatRate !== '' && b.vatRate !== null ? Number(b.vatRate) : null,
    paymentType: b.paymentType || null, dueDate: b.dueDate || null, deliverAt: b.deliverAt || null,
    notes: b.notes ? String(b.notes).trim() : null,
    lines: Array.isArray(b.lines) ? b.lines : [],
  }
}

/** Qatorlarga mahsulot, ombordagi qoldiq va taxminiy narx/summa qo'shadi. */
async function enrich(orders: any[]) {
  const productIds = [...new Set(orders.flatMap(o => o.lines.map((l: any) => l.productId)))]
  const warehouseIds = [...new Set(orders.map(o => o.warehouseId))]
  const [products, stocks, warehouses] = await Promise.all([
    (prisma as any).savdoProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, unit: true, wholesalePrice: true, retailPrice: true },
    }),
    (prisma as any).savdoStock.findMany({
      where: { productId: { in: productIds }, warehouseId: { in: warehouseIds } },
      select: { productId: true, warehouseId: true, quantityOnHand: true },
    }),
    (prisma as any).savdoWarehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } }),
  ])
  const pMap = new Map<string, any>(products.map((p: any) => [p.id, p]))
  const sMap = new Map<string, number>(stocks.map((s: any) => [`${s.productId}|${s.warehouseId}`, qn(s.quantityOnHand)]))
  const wMap = new Map<string, any>(warehouses.map((w: any) => [w.id, w]))
  return orders.map(o => {
    let total = 0
    let short = 0
    const lines = o.lines.map((l: any) => {
      const p = pMap.get(l.productId)
      const qty = qn(l.pickedQty ?? l.quantity)
      const price = p ? resolveUnitPrice({
        wholesalePrice: Number(p.wholesalePrice), retailPrice: Number(p.retailPrice),
        customerPriceTier: o.customer?.priceTier ?? null, manualPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
      }) : 0
      const stock = sMap.get(`${l.productId}|${o.warehouseId}`) ?? 0
      if (stock < qn(l.quantity)) short++
      total += price * qty
      return {
        ...l, product: p ? { id: p.id, name: p.name, sku: p.sku, unit: p.unit } : null,
        price, stock, lineTotal: Math.round(price * qty * 100) / 100,
      }
    })
    return {
      ...o, lines, warehouse: wMap.get(o.warehouseId) ?? null,
      estimatedTotal: Math.round(total * 100) / 100, shortLines: short,
    }
  })
}

export async function listOrders(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)
    const where: any = { orgId }
    if (q.status === 'active') where.status = { in: ['new', 'picking', 'picked'] }
    else if (q.status && (ORDER_STATUSES as readonly string[]).includes(q.status)) where.status = q.status
    if (q.customerId) where.customerId = q.customerId
    const [total, rows, counts] = await Promise.all([
      (prisma as any).savdoOrder.count({ where }),
      (prisma as any).savdoOrder.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
        include: { lines: true, customer: { select: { id: true, name: true, phone: true, priceTier: true } } },
      }),
      (prisma as any).savdoOrder.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
    ])
    const statusCounts: Record<string, number> = {}
    for (const c of counts) statusCounts[c.status] = c._count._all
    res.json({ ...paginatedResponse(await enrich(rows), total, page, limit), statusCounts })
  } catch (err) { next(err) }
}

export async function getOrderHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await getOrder(req.savdoUser!.orgId, req.params.id)
    res.json({ success: true, data: (await enrich([order]))[0] })
  } catch (err) { fail(res, next, err) }
}

export async function createOrderHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const order = await createOrder(toInput(actor.orgId, actorId, req.body))
    res.status(201).json({ success: true, data: order, message: `Zakaz ${order.number} qabul qilindi` })
  } catch (err) { fail(res, next, err) }
}

export async function updateOrderHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const actorId = await ensureSavdoActor(actor)
    const order = await updateOrder(req.params.id, toInput(actor.orgId, actorId, req.body))
    res.json({ success: true, data: order, message: 'Zakaz yangilandi' })
  } catch (err) { fail(res, next, err) }
}

export async function orderActionHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const id = req.params.id
    switch (req.params.action) {
      case 'start': {
        const order = await startPicking(orgId, id)
        res.json({ success: true, data: order, message: "Yig'ish boshlandi" }); return
      }
      case 'picked': {
        const actorId = await ensureSavdoActor(actor)
        const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
        const order = await markPicked(orgId, id, actorId, lines)
        res.json({ success: true, data: order, message: "Zakaz yig'ildi" }); return
      }
      case 'repick': {
        const order = await reopenPicking(orgId, id)
        res.json({ success: true, data: order, message: "Zakaz qayta yig'ishga qaytarildi" }); return
      }
      case 'sell': {
        const actorId = await ensureSavdoActor(actor)
        const r = await sellOrder(orgId, id, actorId)
        res.json({ success: true, data: r, message: `Faktura ${r.sale.documentNumber} yaratildi` }); return
      }
      case 'cancel': {
        const order = await cancelOrder(orgId, id)
        res.json({ success: true, data: order, message: 'Zakaz bekor qilindi' }); return
      }
      default:
        res.status(404).json({ success: false, error: "Noma'lum amal" })
    }
  } catch (err) { fail(res, next, err) }
}

/** Yig'ish varaqasi — omborchi uchun chop etiladigan ro'yxat (narxsiz). */
export async function printPickList(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = (await enrich([await getOrder(req.savdoUser!.orgId, req.params.id)]))[0]
    const rows = order.lines.map((l: any, i: number) => `
      <tr><td class="c">${i + 1}</td><td>${esc(l.product?.name)} <span class="muted">(${esc(l.product?.sku)})</span></td>
      <td class="c">${esc(l.product?.unit)}</td><td class="c"><b>${qn(l.quantity)}</b></td>
      <td class="c">${l.stock}</td><td class="c">${l.pickedQty != null ? qn(l.pickedQty) : ''}</td><td></td></tr>`).join('')
    const body = `
      <h1>YIG'ISH VARAQASI — ZAKAZ № ${esc(order.number)}</h1>
      <div class="sub">${formatUzDate(new Date(order.createdAt))} · ${esc(order.warehouse?.name || '')}${order.customer ? ` · ${esc(order.customer.name)}` : ''}${order.deliverAt ? ` · yetkazish: ${formatUzDate(new Date(order.deliverAt))}` : ''}</div>
      <table class="items">
        <thead><tr><th style="width:5%">№</th><th>Mahsulot</th><th style="width:9%">Birlik</th><th style="width:11%">Kerak</th>
        <th style="width:11%">Omborda</th><th style="width:11%">Yig'ildi</th><th style="width:8%">✓</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${order.notes ? `<div class="terms"><div><b>Izoh:</b> ${esc(order.notes)}</div></div>` : ''}
      <div class="sign">
        <div><div class="cap" style="text-align:left">Yig'di</div><div class="line"></div><div class="cap">F.I.Sh / imzo</div></div>
        <div><div class="cap" style="text-align:left">Tekshirdi</div><div class="line"></div><div class="cap">F.I.Sh / imzo</div></div>
      </div>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(printPage(`Yig'ish varaqasi ${order.number}`, body))
  } catch (err) { fail(res, next, err) }
}
