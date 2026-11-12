// Savdo — kirim (xarid/import) yadrosi.
//
// 1) Bitta qatorli oddiy kirim: purchases.ts (eski yo'l) createPurchaseLine'dan foydalanadi.
// 2) Kirim HUJJATI (import): ko'p qator, valyuta+kurs, qo'lda kiritilgan qo'shimcha
//    xarajatlar (bojxona, transport ...). Xarajatlar landedCost.ts bilan qatorlarga
//    taqsimlanadi, har qator so'mdagi TO'LIQ tannarx bilan FIFO qatlam ochadi.
// 3) Tahrirlash/bekor qilish — faqat shu kirimdan HALI hech narsa sarflanmagan bo'lsa
//    (qatlam remainingQty === quantity). Aks holda sotuv tannarx tarixi buzilardi.

import { prisma } from '../../../lib/prisma'
import { SavdoError } from '../lib/savdoError'
import { computeLandedCost } from '../lib/landedCost'
import { parseQty, qn } from '../lib/qty'

export interface PurchaseLineArgs {
  orgId: string
  productId: string
  warehouseId: string
  quantity: number
  unitCost: number
  isOfficial: boolean
  supplierId?: string | null
  invoiceNumber?: string | null
  notes?: string | null
  receivedById?: string | null
  docId?: string | null
  foreignPrice?: number | null
  extraCost?: number
}

/** Bitta kirim qatori: Purchase + CostLayer + Stock (tranzaksiya ichida chaqiriladi). */
export async function createPurchaseLine(tx: any, a: PurchaseLineArgs) {
  const purchase = await tx.savdoPurchase.create({
    data: {
      orgId: a.orgId, productId: a.productId, warehouseId: a.warehouseId,
      quantity: a.quantity, unitCost: a.unitCost, isOfficial: a.isOfficial,
      supplierId: a.supplierId || null, invoiceNumber: a.invoiceNumber || null,
      notes: a.notes || null, receivedById: a.receivedById || null,
      docId: a.docId || null, foreignPrice: a.foreignPrice ?? null, extraCost: a.extraCost ?? 0,
    },
  })
  await tx.savdoCostLayer.create({
    data: {
      orgId: a.orgId, purchaseId: purchase.id, productId: a.productId, warehouseId: a.warehouseId,
      unitCost: a.unitCost, quantity: a.quantity, remainingQty: a.quantity,
    },
  })
  await tx.savdoStock.upsert({
    where: { productId_warehouseId: { productId: a.productId, warehouseId: a.warehouseId } },
    create: { productId: a.productId, warehouseId: a.warehouseId, quantityOnHand: a.quantity },
    update: { quantityOnHand: { increment: a.quantity } },
  })
  return purchase
}

/** Kirimdan hech narsa sarflanmaganini tekshiradi (layer include qilingan bo'lishi kerak). */
export function assertUntouched(purchase: any): void {
  if (!purchase.costLayer || qn(purchase.costLayer.remainingQty) !== qn(purchase.costLayer.quantity)) {
    throw new SavdoError(
      'Bu kirimdan allaqachon sotilgan (yoki ko\'chirilgan/inventarizatsiyada sarflangan) — o\'zgartirib bo\'lmaydi', 409,
    )
  }
}

/** Kirim qatorini teskari qaytaradi: qoldiq kamayadi, qatlam yopiladi, status=cancelled. */
export async function reversePurchaseLine(tx: any, purchase: any, cancelledById: string | null, detachDoc = false) {
  assertUntouched(purchase)
  const stockUpdate = await tx.savdoStock.updateMany({
    where: { productId: purchase.productId, warehouseId: purchase.warehouseId, quantityOnHand: { gte: purchase.quantity } },
    data: { quantityOnHand: { decrement: purchase.quantity } },
  })
  if (stockUpdate.count === 0) {
    throw new SavdoError('Qoldiq boshqa amal bilan o\'zgargan, qayta urinib ko\'ring', 409)
  }
  const layerClose = await tx.savdoCostLayer.updateMany({
    where: { id: purchase.costLayer.id, remainingQty: purchase.costLayer.quantity },
    data: { remainingQty: 0 },
  })
  if (layerClose.count === 0) throw new SavdoError('Tannarx qatlami o\'zgargan, qayta urinib ko\'ring', 409)
  await tx.savdoPurchase.update({
    where: { id: purchase.id },
    data: {
      status: 'cancelled', cancelledById, cancelledAt: new Date(),
      ...(detachDoc && { docId: null }),
    },
  })
}

export interface DocLineInput { productId: string; quantity: number; price: number }
export interface DocCostInput { label: string; amount: number }
export interface PurchaseDocInput {
  orgId: string
  warehouseId: string
  supplierId?: string | null
  invoiceNumber?: string | null
  currency?: string
  exchangeRate?: number
  allocBy?: 'value' | 'quantity'
  isOfficial?: boolean
  notes?: string | null
  costs?: DocCostInput[]
  lines: DocLineInput[]
  actorId: string
}

async function validateDocInput(input: PurchaseDocInput) {
  const { orgId } = input
  if (!input.lines || input.lines.length === 0) throw new SavdoError('Kamida bitta qator kerak')

  const currency = (input.currency || 'UZS').toUpperCase().trim().slice(0, 8)
  const rate = currency === 'UZS' ? 1 : Number(input.exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) throw new SavdoError('Valyuta kursini kiriting (1 ' + currency + ' = necha so\'m)')

  const lines = input.lines.map((l, i) => {
    const quantity = parseQty(l.quantity)
    const price = Number(l.price)
    if (!l.productId) throw new SavdoError(`${i + 1}-qator: mahsulot tanlanmagan`)
    if (quantity === null) throw new SavdoError(`${i + 1}-qator: miqdor musbat son bo'lishi kerak`)
    if (!Number.isFinite(price) || price < 0) throw new SavdoError(`${i + 1}-qator: narx noto'g'ri`)
    return { productId: l.productId, quantity, price }
  })
  const costs = (input.costs || [])
    .map(c => ({ label: String(c.label || '').trim().slice(0, 80), amount: Number(c.amount) }))
    .filter(c => c.label || c.amount)
  for (const c of costs) {
    if (!c.label) throw new SavdoError('Xarajat nomini kiriting')
    if (!Number.isFinite(c.amount) || c.amount < 0) throw new SavdoError(`"${c.label}" xarajat summasi noto'g'ri`)
  }

  const [warehouse, supplier, products] = await Promise.all([
    (prisma as any).savdoWarehouse.findUnique({ where: { id: input.warehouseId } }),
    input.supplierId ? (prisma as any).savdoSupplier.findUnique({ where: { id: input.supplierId } }) : Promise.resolve(null),
    (prisma as any).savdoProduct.findMany({ where: { id: { in: [...new Set(lines.map(l => l.productId))] } }, select: { id: true, orgId: true } }),
  ])
  if (!warehouse || warehouse.orgId !== orgId) throw new SavdoError('Ombor topilmadi', 404)
  if (input.supplierId && (!supplier || supplier.orgId !== orgId)) throw new SavdoError('Yetkazib beruvchi topilmadi', 404)
  const okIds = new Set(products.filter((p: any) => p.orgId === orgId).map((p: any) => p.id))
  for (const l of lines) if (!okIds.has(l.productId)) throw new SavdoError('Mahsulot topilmadi', 404)

  return { currency, rate, lines, costs }
}

async function writeDoc(tx: any, docId: string, input: PurchaseDocInput, v: Awaited<ReturnType<typeof validateDocInput>>) {
  const extraTotal = v.costs.reduce((s, c) => s + c.amount, 0)
  let landed
  try {
    landed = computeLandedCost(v.lines.map(l => ({ quantity: l.quantity, price: l.price })), v.rate, extraTotal, input.allocBy || 'value')
  } catch (e: any) { throw new SavdoError(e.message) }

  await tx.savdoPurchaseCost.deleteMany({ where: { docId } })
  if (v.costs.length) {
    await tx.savdoPurchaseCost.createMany({ data: v.costs.map(c => ({ docId, label: c.label, amount: c.amount })) })
  }
  for (let i = 0; i < v.lines.length; i++) {
    const l = v.lines[i]
    await createPurchaseLine(tx, {
      orgId: input.orgId, productId: l.productId, warehouseId: input.warehouseId,
      quantity: l.quantity, unitCost: landed[i].unitCost, isOfficial: input.isOfficial !== false,
      supplierId: input.supplierId, invoiceNumber: input.invoiceNumber, notes: input.notes,
      receivedById: input.actorId, docId, foreignPrice: l.price, extraCost: landed[i].extraCost,
    })
  }
}

export async function createPurchaseDoc(input: PurchaseDocInput) {
  const v = await validateDocInput(input)
  return prisma.$transaction(async (tx: any) => {
    const doc = await tx.savdoPurchaseDoc.create({
      data: {
        orgId: input.orgId, warehouseId: input.warehouseId, supplierId: input.supplierId || null,
        invoiceNumber: input.invoiceNumber || null, currency: v.currency, exchangeRate: v.rate,
        allocBy: input.allocBy || 'value', isOfficial: input.isOfficial !== false,
        notes: input.notes || null, createdById: input.actorId,
      },
    })
    await writeDoc(tx, doc.id, input, v)
    return doc
  }, { timeout: 30000 })
}

/** Admin: hujjatni tahrirlash — eski qatorlar teskari qaytariladi, yangilari ochiladi. */
export async function updatePurchaseDoc(docId: string, input: PurchaseDocInput) {
  const doc = await (prisma as any).savdoPurchaseDoc.findUnique({
    where: { id: docId },
    include: { purchases: { where: { status: 'completed' }, include: { costLayer: true } } },
  })
  if (!doc || doc.orgId !== input.orgId) throw new SavdoError('Kirim hujjati topilmadi', 404)
  if (doc.status === 'cancelled') throw new SavdoError('Bekor qilingan hujjatni tahrirlab bo\'lmaydi')

  const v = await validateDocInput(input)
  return prisma.$transaction(async (tx: any) => {
    for (const p of doc.purchases) await reversePurchaseLine(tx, p, input.actorId, true)
    await tx.savdoPurchaseDoc.update({
      where: { id: docId },
      data: {
        warehouseId: input.warehouseId, supplierId: input.supplierId || null,
        invoiceNumber: input.invoiceNumber || null, currency: v.currency, exchangeRate: v.rate,
        allocBy: input.allocBy || 'value', isOfficial: input.isOfficial !== false, notes: input.notes || null,
      },
    })
    await writeDoc(tx, docId, input, v)
    return tx.savdoPurchaseDoc.findUnique({ where: { id: docId } })
  }, { timeout: 30000 })
}

export async function cancelPurchaseDoc(orgId: string, docId: string, actorId: string) {
  const doc = await (prisma as any).savdoPurchaseDoc.findUnique({
    where: { id: docId },
    include: { purchases: { where: { status: 'completed' }, include: { costLayer: true } } },
  })
  if (!doc || doc.orgId !== orgId) throw new SavdoError('Kirim hujjati topilmadi', 404)
  if (doc.status === 'cancelled') throw new SavdoError('Bu hujjat allaqachon bekor qilingan')
  await prisma.$transaction(async (tx: any) => {
    for (const p of doc.purchases) await reversePurchaseLine(tx, p, actorId)
    await tx.savdoPurchaseDoc.update({ where: { id: docId }, data: { status: 'cancelled', cancelledAt: new Date() } })
  }, { timeout: 30000 })
}

export interface UpdatePurchaseArgs {
  orgId: string
  id: string
  quantity?: number
  unitCost?: number
  isOfficial?: boolean
  supplierId?: string | null
  invoiceNumber?: string | null
  notes?: string | null
}

/**
 * Admin: bitta kirimni joyida tahrirlash. Izoh/faktura raqami/yetkazib beruvchi/turi
 * har doim o'zgaradi; miqdor yoki narx faqat kirimdan hali hech narsa sarflanmagan
 * bo'lsa (qatlam toza).
 */
export async function updatePurchase(a: UpdatePurchaseArgs) {
  const p = await (prisma as any).savdoPurchase.findUnique({ where: { id: a.id }, include: { costLayer: true } })
  if (!p || p.orgId !== a.orgId) throw new SavdoError('Kirim topilmadi', 404)
  if (p.status === 'cancelled') throw new SavdoError('Bekor qilingan kirimni tahrirlab bo\'lmaydi')

  if (a.supplierId) {
    const s = await (prisma as any).savdoSupplier.findUnique({ where: { id: a.supplierId } })
    if (!s || s.orgId !== a.orgId) throw new SavdoError('Yetkazib beruvchi topilmadi', 404)
  }

  const newQty = a.quantity !== undefined ? parseQty(a.quantity) : qn(p.quantity)
  if (newQty === null) throw new SavdoError('Miqdor musbat son bo\'lishi kerak')
  const newCost = a.unitCost !== undefined ? Number(a.unitCost) : Number(p.unitCost)
  if (!Number.isFinite(newCost) || newCost < 0) throw new SavdoError('Narx noto\'g\'ri')
  const changesStock = newQty !== qn(p.quantity) || newCost !== Number(p.unitCost)
  if (changesStock) assertUntouched(p)

  return prisma.$transaction(async (tx: any) => {
    if (changesStock) {
      const delta = newQty - qn(p.quantity)
      if (delta !== 0) {
        const upd = await tx.savdoStock.updateMany({
          where: {
            productId: p.productId, warehouseId: p.warehouseId,
            ...(delta < 0 && { quantityOnHand: { gte: -delta } }),
          },
          data: { quantityOnHand: delta > 0 ? { increment: delta } : { decrement: -delta } },
        })
        if (upd.count === 0) throw new SavdoError('Qoldiq boshqa amal bilan o\'zgargan, qayta urinib ko\'ring', 409)
      }
      const lay = await tx.savdoCostLayer.updateMany({
        where: { id: p.costLayer.id, remainingQty: p.costLayer.quantity },
        data: { quantity: newQty, remainingQty: newQty, unitCost: newCost },
      })
      if (lay.count === 0) throw new SavdoError('Tannarx qatlami o\'zgargan, qayta urinib ko\'ring', 409)
    }
    return tx.savdoPurchase.update({
      where: { id: a.id },
      data: {
        quantity: newQty, unitCost: newCost,
        ...(a.isOfficial !== undefined && { isOfficial: Boolean(a.isOfficial) }),
        ...(a.supplierId !== undefined && { supplierId: a.supplierId || null }),
        ...(a.invoiceNumber !== undefined && { invoiceNumber: a.invoiceNumber || null }),
        ...(a.notes !== undefined && { notes: a.notes || null }),
      },
    })
  })
}
