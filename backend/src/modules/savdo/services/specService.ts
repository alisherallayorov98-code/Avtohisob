// Savdo — spetsifikatsiya (yuridik shaxslarga sotish) yadrosi.
// Holatlar: draft (erkin tahrirlanadi) -> confirmed (sotuv yaratilgan, ombor/tannarx
// sarflangan) | cancelled. Tasdiqlangan spetsifikatsiyani faqat admin "qayta ochadi":
// bog'langan sotuv bekor qilinadi (saleService.cancelSale), spetsifikatsiya draft'ga qaytadi.
// Sotuv yaratish YAGONA yadro createSale orqali — mustaqil nusxa yozilmaydi.

import { prisma } from '../../../lib/prisma'
import { SavdoError } from '../lib/savdoError'
import { nextSpecDocNum } from '../lib/docSeq'
import { parseQty, qn } from '../lib/qty'
import { applyVat, normalizeVatRate } from '../lib/vatMath'
import { createSale, cancelSale } from './saleService'

export interface SpecInput {
  orgId: string
  actorId: string
  customerId: string
  warehouseId: string
  contractNumber?: string | null
  contractDate?: string | null
  vatRate?: number | null
  paymentTerms?: string | null
  deliveryTerms?: string | null
  validUntil?: string | null
  notes?: string | null
  lines: { productId: string; quantity: number; unitPrice: number }[]
}

function date(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) throw new SavdoError('Sana noto\'g\'ri')
  return d
}

async function validate(input: SpecInput) {
  const { orgId } = input
  if (!input.lines || input.lines.length === 0) throw new SavdoError('Kamida bitta qator kerak')
  const lines = input.lines.map((l, i) => {
    const quantity = parseQty(l.quantity)
    const unitPrice = Number(l.unitPrice)
    if (!l.productId) throw new SavdoError(`${i + 1}-qator: mahsulot tanlanmagan`)
    if (quantity === null) throw new SavdoError(`${i + 1}-qator: miqdor musbat son bo'lishi kerak`)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new SavdoError(`${i + 1}-qator: narx noto'g'ri`)
    return { productId: l.productId, quantity, unitPrice }
  })
  let vatRate: number | null
  try { vatRate = normalizeVatRate(input.vatRate) } catch (e: any) { throw new SavdoError(e.message) }

  const [customer, warehouse, products] = await Promise.all([
    (prisma as any).savdoCustomer.findUnique({ where: { id: input.customerId } }),
    (prisma as any).savdoWarehouse.findUnique({ where: { id: input.warehouseId } }),
    (prisma as any).savdoProduct.findMany({ where: { id: { in: [...new Set(lines.map(l => l.productId))] } }, select: { id: true, orgId: true } }),
  ])
  if (!customer || customer.orgId !== orgId) throw new SavdoError('Mijoz topilmadi', 404)
  if (!warehouse || warehouse.orgId !== orgId) throw new SavdoError('Ombor topilmadi', 404)
  const ok = new Set(products.filter((p: any) => p.orgId === orgId).map((p: any) => p.id))
  for (const l of lines) if (!ok.has(l.productId)) throw new SavdoError('Mahsulot topilmadi', 404)

  return { lines, vatRate }
}

const SPEC_INCLUDE = { lines: true, customer: true }

export async function createSpec(input: SpecInput) {
  const v = await validate(input)
  const number = await nextSpecDocNum(input.orgId)
  return (prisma as any).savdoSpec.create({
    data: {
      orgId: input.orgId, number, customerId: input.customerId, warehouseId: input.warehouseId,
      contractNumber: input.contractNumber || null, contractDate: date(input.contractDate),
      vatRate: v.vatRate, paymentTerms: input.paymentTerms || null, deliveryTerms: input.deliveryTerms || null,
      validUntil: date(input.validUntil), notes: input.notes || null, createdById: input.actorId,
      lines: { create: v.lines },
    },
    include: SPEC_INCLUDE,
  })
}

async function loadOwn(orgId: string, id: string) {
  const spec = await (prisma as any).savdoSpec.findUnique({ where: { id }, include: SPEC_INCLUDE })
  if (!spec || spec.orgId !== orgId) throw new SavdoError('Spetsifikatsiya topilmadi', 404)
  return spec
}

export async function updateSpec(id: string, input: SpecInput) {
  const spec = await loadOwn(input.orgId, id)
  if (spec.status !== 'draft') throw new SavdoError('Faqat qoralamani tahrirlash mumkin — avval admin qayta ochsin')
  const v = await validate(input)
  return prisma.$transaction(async (tx: any) => {
    await tx.savdoSpecLine.deleteMany({ where: { specId: id } })
    return tx.savdoSpec.update({
      where: { id },
      data: {
        customerId: input.customerId, warehouseId: input.warehouseId,
        contractNumber: input.contractNumber || null, contractDate: date(input.contractDate),
        vatRate: v.vatRate, paymentTerms: input.paymentTerms || null, deliveryTerms: input.deliveryTerms || null,
        validUntil: date(input.validUntil), notes: input.notes || null,
        lines: { create: v.lines },
      },
      include: SPEC_INCLUDE,
    })
  })
}

/** Tasdiqlash: sotuv yaratiladi (omborni/tannarxni sarflaydi). */
export async function confirmSpec(orgId: string, id: string, actorId: string) {
  const spec = await loadOwn(orgId, id)
  if (spec.status !== 'draft') throw new SavdoError('Spetsifikatsiya allaqachon tasdiqlangan yoki bekor qilingan')

  const sale = await createSale({
    orgId, warehouseId: spec.warehouseId, customerId: spec.customerId,
    saleType: 'invoice', soldById: actorId, specId: spec.id,
    vatRate: spec.vatRate != null ? Number(spec.vatRate) : null,
    notes: `Spetsifikatsiya ${spec.number}${spec.contractNumber ? `, shartnoma ${spec.contractNumber}` : ''}`,
    lines: spec.lines.map((l: any) => ({ productId: l.productId, quantity: qn(l.quantity), unitPrice: Number(l.unitPrice) })),
  })
  await (prisma as any).savdoSpec.update({ where: { id }, data: { status: 'confirmed', saleId: sale.id } })
  return { spec: await loadOwn(orgId, id), sale }
}

/** Admin: tasdiqlangan spetsifikatsiyani qayta ochish — sotuv bekor, spetsifikatsiya draft. */
export async function reopenSpec(orgId: string, id: string, actorId: string) {
  const spec = await loadOwn(orgId, id)
  if (spec.status !== 'confirmed' || !spec.saleId) throw new SavdoError('Faqat tasdiqlangan spetsifikatsiyani qayta ochish mumkin')
  await cancelSale({ orgId, saleId: spec.saleId, cancelledById: actorId, reason: `Spetsifikatsiya ${spec.number} qayta ochildi` })
  return loadOwn(orgId, id)
}

export async function cancelSpec(orgId: string, id: string) {
  const spec = await loadOwn(orgId, id)
  if (spec.status !== 'draft') throw new SavdoError('Tasdiqlangan spetsifikatsiyani avval qayta oching')
  return (prisma as any).savdoSpec.update({ where: { id }, data: { status: 'cancelled' }, include: SPEC_INCLUDE })
}

export function specTotals(spec: { vatRate: any; lines: { quantity: any; unitPrice: any }[] }) {
  const subtotal = Math.round(spec.lines.reduce((s, l) => s + qn(l.quantity) * Number(l.unitPrice), 0) * 100) / 100
  const rate = spec.vatRate != null ? Number(spec.vatRate) : null
  return { subtotal, ...applyVat(subtotal, rate) }
}
