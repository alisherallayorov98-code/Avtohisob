// Savdo — zakaz (buyurtma) → yig'ish → sotuv.
// Holatlar: new (qabul qilindi) -> picking (yig'ilmoqda) -> picked (yig'ildi) -> sold | cancelled.
// Zakaz omborga ta'sir QILMAYDI: qoldiq va tannarx faqat "Sotuvga aylantirish"da, YAGONA
// yadro createSale orqali sarflanadi (yuridik mijozga spetsifikatsiya ham shu yerda chiqadi).
// Sotuv bekor qilinsa (cancelSale) zakaz "picked" holatiga qaytadi.

import { prisma } from '../../../lib/prisma'
import { SavdoError } from '../lib/savdoError'
import { nextOrderDocNum } from '../lib/docSeq'
import { parseQty, qn } from '../lib/qty'
import { normalizeVatRate } from '../lib/vatMath'
import { createSale } from './saleService'

export const ORDER_STATUSES = ['new', 'picking', 'picked', 'sold', 'cancelled'] as const

export interface OrderInput {
  orgId: string
  actorId: string
  customerId?: string | null
  warehouseId: string
  vatRate?: number | null
  paymentType?: string | null
  dueDate?: string | null
  deliverAt?: string | null
  notes?: string | null
  lines: { productId: string; quantity: number; unitPrice?: number | null }[]
}

function date(v: unknown, label: string): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) throw new SavdoError(`${label} noto'g'ri`)
  return d
}

async function validate(input: OrderInput) {
  const { orgId } = input
  if (!input.warehouseId) throw new SavdoError('Omborni tanlang')
  if (!input.lines || input.lines.length === 0) throw new SavdoError('Kamida bitta qator kerak')
  const lines = input.lines.map((l, i) => {
    const quantity = parseQty(l.quantity)
    if (!l.productId) throw new SavdoError(`${i + 1}-qator: mahsulot tanlanmagan`)
    if (quantity === null) throw new SavdoError(`${i + 1}-qator: miqdor musbat son bo'lishi kerak`)
    const raw = l.unitPrice
    const unitPrice = raw === null || raw === undefined || (raw as any) === '' ? null : Number(raw)
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) throw new SavdoError(`${i + 1}-qator: narx noto'g'ri`)
    return { productId: l.productId, quantity, unitPrice }
  })
  let vatRate: number | null
  try { vatRate = normalizeVatRate(input.vatRate) } catch (e: any) { throw new SavdoError(e.message) }

  const [customer, warehouse, products] = await Promise.all([
    input.customerId ? (prisma as any).savdoCustomer.findUnique({ where: { id: input.customerId } }) : null,
    (prisma as any).savdoWarehouse.findUnique({ where: { id: input.warehouseId } }),
    (prisma as any).savdoProduct.findMany({ where: { id: { in: [...new Set(lines.map(l => l.productId))] } }, select: { id: true, orgId: true } }),
  ])
  if (input.customerId && (!customer || customer.orgId !== orgId)) throw new SavdoError('Mijoz topilmadi', 404)
  if (!warehouse || warehouse.orgId !== orgId) throw new SavdoError('Ombor topilmadi', 404)
  const ok = new Set(products.filter((p: any) => p.orgId === orgId).map((p: any) => p.id))
  for (const l of lines) if (!ok.has(l.productId)) throw new SavdoError('Mahsulot topilmadi', 404)

  let paymentType = input.paymentType || (input.customerId ? 'credit' : 'cash')
  if (!['cash', 'transfer', 'credit'].includes(paymentType)) throw new SavdoError("To'lov turi noto'g'ri")
  if (!input.customerId && paymentType === 'credit') paymentType = 'cash'
  return { lines, vatRate, paymentType }
}

const ORDER_INCLUDE = { lines: true, customer: { select: { id: true, name: true, phone: true, priceTier: true } } }

async function loadOwn(orgId: string, id: string) {
  const order = await (prisma as any).savdoOrder.findUnique({ where: { id }, include: ORDER_INCLUDE })
  if (!order || order.orgId !== orgId) throw new SavdoError('Zakaz topilmadi', 404)
  return order
}

export async function getOrder(orgId: string, id: string) {
  return loadOwn(orgId, id)
}

export async function createOrder(input: OrderInput) {
  const v = await validate(input)
  const number = await nextOrderDocNum(input.orgId)
  return (prisma as any).savdoOrder.create({
    data: {
      orgId: input.orgId, number, customerId: input.customerId || null, warehouseId: input.warehouseId,
      vatRate: v.vatRate, paymentType: v.paymentType,
      dueDate: v.paymentType === 'cash' ? null : date(input.dueDate, "To'lov muddati"),
      deliverAt: date(input.deliverAt, 'Yetkazish sanasi'), notes: input.notes || null,
      createdById: input.actorId, lines: { create: v.lines },
    },
    include: ORDER_INCLUDE,
  })
}

export async function updateOrder(id: string, input: OrderInput) {
  const order = await loadOwn(input.orgId, id)
  if (!['new', 'picking'].includes(order.status)) throw new SavdoError("Yig'ilgan yoki sotilgan zakazni tahrirlab bo'lmaydi")
  const v = await validate(input)
  return prisma.$transaction(async (tx: any) => {
    await tx.savdoOrderLine.deleteMany({ where: { orderId: id } })
    return tx.savdoOrder.update({
      where: { id },
      data: {
        customerId: input.customerId || null, warehouseId: input.warehouseId,
        vatRate: v.vatRate, paymentType: v.paymentType,
        dueDate: v.paymentType === 'cash' ? null : date(input.dueDate, "To'lov muddati"),
        deliverAt: date(input.deliverAt, 'Yetkazish sanasi'), notes: input.notes || null,
        lines: { create: v.lines },
      },
      include: ORDER_INCLUDE,
    })
  })
}

export async function startPicking(orgId: string, id: string) {
  const r = await (prisma as any).savdoOrder.updateMany({ where: { id, orgId, status: 'new' }, data: { status: 'picking' } })
  if (r.count === 0) throw new SavdoError("Faqat yangi zakazni yig'ishga olish mumkin")
  return loadOwn(orgId, id)
}

/**
 * Yig'ildi: har qator uchun haqiqatda yig'ilgan miqdor (0 — topilmadi). Berilmagan qator
 * to'liq yig'ilgan deb olinadi. Qoldiq bu yerda kamaymaydi.
 */
export async function markPicked(orgId: string, id: string, actorId: string, picked: { id: string; pickedQty: number }[]) {
  const order = await loadOwn(orgId, id)
  if (!['new', 'picking'].includes(order.status)) throw new SavdoError("Zakaz allaqachon yig'ilgan, sotilgan yoki bekor qilingan")
  const map = new Map((picked || []).map(p => [p.id, p.pickedQty]))
  const updates = order.lines.map((l: any) => {
    const raw = map.has(l.id) ? Number(map.get(l.id)) : qn(l.quantity)
    if (!Number.isFinite(raw) || raw < 0) throw new SavdoError("Yig'ilgan miqdor noto'g'ri")
    return { id: l.id, pickedQty: Math.round(raw * 1000) / 1000 }
  })
  if (!updates.some((u: any) => u.pickedQty > 0)) throw new SavdoError("Hech narsa yig'ilmadi — zakazni bekor qiling")
  await prisma.$transaction(async (tx: any) => {
    for (const u of updates) await tx.savdoOrderLine.update({ where: { id: u.id }, data: { pickedQty: u.pickedQty } })
    await tx.savdoOrder.update({ where: { id }, data: { status: 'picked', pickedById: actorId, pickedAt: new Date() } })
  })
  return loadOwn(orgId, id)
}

/** Yig'ilgan zakazni qayta yig'ishga qaytarish (sotuvdan oldin xato topilsa). */
export async function reopenPicking(orgId: string, id: string) {
  const r = await (prisma as any).savdoOrder.updateMany({ where: { id, orgId, status: 'picked' }, data: { status: 'picking' } })
  if (r.count === 0) throw new SavdoError("Faqat yig'ilgan (sotilmagan) zakazni qaytarish mumkin")
  return loadOwn(orgId, id)
}

/**
 * Sotuvga aylantirish: yig'ilgan miqdorlar bilan faktura yaratiladi (ombor/tannarx sarfi).
 * Ikki marta bosish ikkita sotuv yaratmasligi uchun holat ATOMIK egallanadi (picked -> selling).
 */
export async function sellOrder(orgId: string, id: string, actorId: string) {
  const order = await loadOwn(orgId, id)
  if (order.status !== 'picked') throw new SavdoError("Avval zakazni yig'ib, \"Yig'ildi\" deb belgilang")
  const lines = order.lines
    .map((l: any) => ({ productId: l.productId, quantity: qn(l.pickedQty ?? l.quantity), unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null }))
    .filter((l: any) => l.quantity > 0)
  if (lines.length === 0) throw new SavdoError("Yig'ilgan qator yo'q")

  const claim = await (prisma as any).savdoOrder.updateMany({ where: { id, orgId, status: 'picked' }, data: { status: 'selling' } })
  if (claim.count === 0) throw new SavdoError('Zakaz hozir sotuvga aylantirilmoqda', 409)

  let sale
  try {
    sale = await createSale({
      orgId, warehouseId: order.warehouseId, customerId: order.customerId, saleType: 'invoice', soldById: actorId,
      paymentType: order.paymentType, dueDate: order.dueDate,
      vatRate: order.vatRate != null ? Number(order.vatRate) : null,
      notes: `Zakaz ${order.number}${order.notes ? ` · ${order.notes}` : ''}`,
      lines,
    })
  } catch (e) {
    await (prisma as any).savdoOrder.updateMany({ where: { id, status: 'selling' }, data: { status: 'picked' } })
    throw e
  }
  await (prisma as any).savdoOrder.update({ where: { id }, data: { status: 'sold', saleId: sale.id } })
  return { order: await loadOwn(orgId, id), sale }
}

export async function cancelOrder(orgId: string, id: string) {
  const r = await (prisma as any).savdoOrder.updateMany({
    where: { id, orgId, status: { in: ['new', 'picking', 'picked'] } }, data: { status: 'cancelled' },
  })
  if (r.count === 0) throw new SavdoError("Sotilgan zakazni bekor qilib bo'lmaydi — avval fakturani bekor qiling")
  return loadOwn(orgId, id)
}
