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
import { computeLandedCostGrouped } from '../lib/landedCost'
import { nextImportDocNum } from '../lib/docSeq'
import { writeAudit, requireReason } from '../lib/audit'
import { parseQty, qn } from '../lib/qty'
import { computeLevy, isLevyBasis, LevyResult } from '../lib/levyCalc'

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
  unitWeightKg?: number | null
  levyRateId?: string | null
  levyName?: string | null
  levyBasis?: string | null
  levyPercent?: number | null
  levyAmount?: number
  extraCustoms?: number
  extraOther?: number
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
      unitWeightKg: a.unitWeightKg ?? null, levyRateId: a.levyRateId ?? null, levyName: a.levyName ?? null,
      levyBasis: a.levyBasis ?? null, levyPercent: a.levyPercent ?? null, levyAmount: a.levyAmount ?? 0,
      extraCustoms: a.extraCustoms ?? 0, extraOther: a.extraOther ?? 0,
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

/**
 * Ko'chirish va inventarizatsiya "soya kirim"lari: alohida kirim emas, boshqa amalning
 * qatlami. Ularni kirim sifatida tahrirlash/bekor qilish ko'chirish yoki sanoq tarixini buzadi.
 */
export function isShadowPurchase(p: { notes?: string | null }): boolean {
  const n = p.notes || ''
  return n.startsWith('Omborlararo ko\'chirish') || n.startsWith('Inventarizatsiya')
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
      // Tahrirda almashtirilgan qator 'replaced' (Kirim ro'yxatida ko'rinmaydi, tarix audit jurnalida); bekor qilinganda 'cancelled'
      status: detachDoc ? 'replaced' : 'cancelled', cancelledById, cancelledAt: new Date(),
      ...(detachDoc && { docId: null }),
    },
  })
}

// unitWeightKg — bir birlik og'irligi (kg); levyRateId/levyPercent — yig'im turi va (ixtiyoriy) foizni qo'lda belgilash
export interface DocLineInput {
  productId: string; quantity: number; price: number
  unitWeightKg?: number | string | null
  levyRateId?: string | null
  levyPercent?: number | string | null
}
// mode: total | per_unit; group: customs (bojxona xarajatlari) | other (qo'shimcha: sertifikat, transport, deklarant ...)
export interface DocCostInput { label: string; amount: number; mode?: string; group?: string }
export interface PurchaseDocInput {
  orgId: string
  warehouseId: string
  supplierId?: string | null
  invoiceNumber?: string | null
  currency?: string
  exchangeRate?: number
  allocBy?: 'value' | 'quantity'
  /** Eng kam oylik ish haqi (so'm) — yig'imli qatorlar bo'lsa majburiy; hujjatda snapshot sifatida saqlanadi */
  minWage?: number | null
  isOfficial?: boolean
  notes?: string | null
  /** Tahrirlash sababi — kirim qilingan hujjatni tahrirlashda MAJBURIY (audit jurnaliga yoziladi) */
  reason?: string | null
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
    const w = l.unitWeightKg != null && l.unitWeightKg !== '' ? Number(l.unitWeightKg) : null
    if (w !== null && (!Number.isFinite(w) || w <= 0)) throw new SavdoError(`${i + 1}-qator: og'irlik noto'g'ri`)
    const pct = l.levyPercent != null && l.levyPercent !== '' ? Number(l.levyPercent) : null
    if (pct !== null && (!Number.isFinite(pct) || pct < 0)) throw new SavdoError(`${i + 1}-qator: yig'im foizi noto'g'ri`)
    return { productId: l.productId, quantity, price, unitWeightKg: w, levyRateId: l.levyRateId || null, levyPercent: pct }
  })
  const costs = (input.costs || [])
    .map(c => ({ label: String(c.label || '').trim().slice(0, 80), amount: Number(c.amount), mode: c.mode === 'per_unit' ? 'per_unit' : 'total', group: c.group === 'customs' ? 'customs' : 'other' }))
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
  if (warehouse.isActive === false) throw new SavdoError('Ombor faol emas')
  if (input.supplierId && (!supplier || supplier.orgId !== orgId)) throw new SavdoError('Yetkazib beruvchi topilmadi', 404)
  const okIds = new Set(products.filter((p: any) => p.orgId === orgId).map((p: any) => p.id))
  for (const l of lines) if (!okIds.has(l.productId)) throw new SavdoError('Mahsulot topilmadi', 404)

  // Yig'imlar (utilizatsiya va h.k.): tur katalogdan olinadi (tashkilotga tegishliligi tekshiriladi)
  const minWage = input.minWage != null && Number(input.minWage) > 0 ? Number(input.minWage) : null
  const levyIds = [...new Set(lines.map(l => l.levyRateId).filter((x): x is string => !!x))]
  const rates = levyIds.length
    ? await (prisma as any).savdoLevyRate.findMany({ where: { id: { in: levyIds }, orgId } })
    : []
  const rateMap = new Map<string, any>(rates.map((r: any) => [r.id, r]))
  const levies: (null | (LevyResult & { rateId: string; name: string; basis: string; percent: number }))[] = lines.map((l, i) => {
    if (!l.levyRateId) return null
    const r = rateMap.get(l.levyRateId)
    if (!r) throw new SavdoError(`${i + 1}-qator: yig'im turi topilmadi`, 404)
    if (!isLevyBasis(r.basis)) throw new SavdoError(`${i + 1}-qator: yig'im turi noto'g'ri`)
    const percent = l.levyPercent ?? Number(r.percent)
    try {
      const res = computeLevy({ basis: r.basis, minWage: minWage ?? 0, percent, quantity: l.quantity, unitWeightKg: l.unitWeightKg })
      return { ...res, rateId: r.id, name: r.name, basis: r.basis, percent }
    } catch (e: any) { throw new SavdoError(`${i + 1}-qator (${r.name}): ${e.message}`) }
  })

  return { currency, rate, lines, costs, levies, minWage }
}

/** Bir guruh xarajatlarining umumiy va birlikka qismlari. */
function groupSums(costs: { amount: number; mode: string; group: string }[], group: 'customs' | 'other') {
  const mine = costs.filter(c => c.group === group)
  return {
    total: mine.filter(c => c.mode === 'total').reduce((s, c) => s + c.amount, 0),
    perUnit: mine.filter(c => c.mode === 'per_unit').reduce((s, c) => s + c.amount, 0),
  }
}

async function writeDoc(tx: any, docId: string, input: PurchaseDocInput, v: Awaited<ReturnType<typeof validateDocInput>>) {
  let landed
  try {
    landed = computeLandedCostGrouped(
      v.lines.map((l, i) => ({ quantity: l.quantity, price: l.price, fixedExtra: v.levies[i]?.amount ?? 0 })),
      v.rate,
      { customs: groupSums(v.costs, 'customs'), other: groupSums(v.costs, 'other') },
      input.allocBy || 'value',
    )
  } catch (e: any) { throw new SavdoError(e.message) }

  await tx.savdoPurchaseCost.deleteMany({ where: { docId } })
  if (v.costs.length) {
    await tx.savdoPurchaseCost.createMany({ data: v.costs.map(c => ({ docId, label: c.label, amount: c.amount, mode: c.mode, group: c.group })) })
  }
  for (let i = 0; i < v.lines.length; i++) {
    const l = v.lines[i]
    await createPurchaseLine(tx, {
      orgId: input.orgId, productId: l.productId, warehouseId: input.warehouseId,
      quantity: l.quantity, unitCost: landed[i].unitCost, isOfficial: input.isOfficial !== false,
      supplierId: input.supplierId, invoiceNumber: input.invoiceNumber, notes: input.notes,
      receivedById: input.actorId, docId, foreignPrice: l.price, extraCost: landed[i].extraCost,
      extraCustoms: landed[i].extraCustoms, extraOther: landed[i].extraOther,
      unitWeightKg: l.unitWeightKg,
      levyRateId: v.levies[i]?.rateId ?? null, levyName: v.levies[i]?.name ?? null, levyBasis: v.levies[i]?.basis ?? null,
      levyPercent: v.levies[i]?.percent ?? null, levyAmount: v.levies[i]?.amount ?? 0,
    })
  }
}

export async function createPurchaseDoc(input: PurchaseDocInput) {
  const v = await validateDocInput(input)
  const number = await nextImportDocNum(input.orgId)
  return prisma.$transaction(async (tx: any) => {
    const doc = await tx.savdoPurchaseDoc.create({
      data: {
        orgId: input.orgId, warehouseId: input.warehouseId, supplierId: input.supplierId || null,
        invoiceNumber: input.invoiceNumber || null, currency: v.currency, exchangeRate: v.rate,
        allocBy: input.allocBy || 'value', isOfficial: input.isOfficial !== false, minWage: v.minWage,
        notes: input.notes || null, createdById: input.actorId, number,
      },
    })
    await writeDoc(tx, doc.id, input, v)
    return doc
  }, { timeout: 30000 })
}

/** Admin: hujjatni tahrirlash — eski qatorlar teskari qaytariladi, yangilari ochiladi. */
/** Hujjatning audit uchun holati: sarlavha, qatorlar, xarajatlar va asosiy jamilar. */
async function docSnapshot(tx: any, docId: string) {
  const d = await tx.savdoPurchaseDoc.findUnique({
    where: { id: docId },
    include: {
      costs: true,
      purchases: { where: { status: 'completed' }, include: { product: { select: { name: true, sku: true } } }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!d) return null
  const lines = d.purchases.map((p: any) => ({
    key: p.product.sku, product: p.product.name, quantity: qn(p.quantity),
    price: p.foreignPrice != null ? Number(p.foreignPrice) : null,
    unitWeightKg: p.unitWeightKg != null ? Number(p.unitWeightKg) : null,
    levy: p.levyName ? `${p.levyName} ${Number(p.levyPercent)}%` : null, levyAmount: Number(p.levyAmount),
    extraCustoms: Number(p.extraCustoms), extraOther: Number(p.extraOther), unitCost: Number(p.unitCost),
  }))
  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    number: d.number, invoiceNumber: d.invoiceNumber, supplierId: d.supplierId, currency: d.currency,
    exchangeRate: Number(d.exchangeRate), allocBy: d.allocBy, minWage: d.minWage != null ? Number(d.minWage) : null,
    isOfficial: d.isOfficial, notes: d.notes,
    lines,
    costs: d.costs.map((c: any) => ({ key: `${c.group}:${c.label}`, label: c.label, group: c.group, mode: c.mode, amount: Number(c.amount) })),
    totals: {
      landed: r2(d.purchases.reduce((s: number, p: any) => s + qn(p.quantity) * Number(p.unitCost), 0)),
      customs: r2(lines.reduce((s: number, l: any) => s + l.extraCustoms, 0)),
      other: r2(lines.reduce((s: number, l: any) => s + l.extraOther, 0)),
      levy: r2(lines.reduce((s: number, l: any) => s + l.levyAmount, 0)),
    },
  }
}

/**
 * Admin: kirim qilingan hujjatni tahrirlash — eski qatorlar teskari qaytariladi ('replaced'), yangilari ochiladi.
 * SABAB majburiy; avval/keyin holati audit jurnaliga yoziladi.
 */
export async function updatePurchaseDoc(docId: string, input: PurchaseDocInput) {
  const reason = requireReason(input.reason)
  const doc = await (prisma as any).savdoPurchaseDoc.findUnique({
    where: { id: docId },
    include: { purchases: { where: { status: 'completed' }, include: { costLayer: true } } },
  })
  if (!doc || doc.orgId !== input.orgId) throw new SavdoError('Kirim hujjati topilmadi', 404)
  if (doc.status === 'cancelled') throw new SavdoError('Bekor qilingan hujjatni tahrirlab bo\'lmaydi')
  if (doc.status !== 'completed') throw new SavdoError('Qoralamani "Davom ettirish" orqali tahrirlang va kirim qiling')

  const v = await validateDocInput(input)
  return prisma.$transaction(async (tx: any) => {
    const before = await docSnapshot(tx, docId)
    for (const p of doc.purchases) await reversePurchaseLine(tx, p, input.actorId, true)
    await tx.savdoPurchaseDoc.update({
      where: { id: docId },
      data: {
        warehouseId: input.warehouseId, supplierId: input.supplierId || null,
        invoiceNumber: input.invoiceNumber || null, currency: v.currency, exchangeRate: v.rate,
        allocBy: input.allocBy || 'value', isOfficial: input.isOfficial !== false, notes: input.notes || null,
        minWage: v.minWage,
      },
    })
    await writeDoc(tx, docId, input, v)
    const after = await docSnapshot(tx, docId)
    await writeAudit(tx, {
      orgId: input.orgId, entity: 'purchase_doc', entityId: docId, entityLabel: doc.number || doc.invoiceNumber || null,
      action: 'edit', reason, before, after, userId: input.actorId,
    })
    return tx.savdoPurchaseDoc.findUnique({ where: { id: docId } })
  }, { timeout: 30000 })
}

/** Hujjatni bekor qilish (admin): hammasi sotilmagan bo'lsa; SABAB majburiy, audit jurnaliga yoziladi. */
export async function cancelPurchaseDoc(orgId: string, docId: string, actorId: string, rawReason?: unknown) {
  const reason = requireReason(rawReason)
  const doc = await (prisma as any).savdoPurchaseDoc.findUnique({
    where: { id: docId },
    include: { purchases: { where: { status: 'completed' }, include: { costLayer: true } } },
  })
  if (!doc || doc.orgId !== orgId) throw new SavdoError('Kirim hujjati topilmadi', 404)
  if (doc.status === 'cancelled') throw new SavdoError('Bu hujjat allaqachon bekor qilingan')
  if (doc.status !== 'completed') throw new SavdoError('Qoralamani bekor qilib bo\'lmaydi — uni o\'chiring')
  await prisma.$transaction(async (tx: any) => {
    const before = await docSnapshot(tx, docId)
    for (const p of doc.purchases) await reversePurchaseLine(tx, p, actorId)
    await tx.savdoPurchaseDoc.update({ where: { id: docId }, data: { status: 'cancelled', cancelledAt: new Date() } })
    await writeAudit(tx, {
      orgId, entity: 'purchase_doc', entityId: docId, entityLabel: doc.number || doc.invoiceNumber || null,
      action: 'cancel', reason, before, userId: actorId,
    })
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
  reason?: string | null
  actorId?: string | null
}

/**
 * Admin: bitta kirimni joyida tahrirlash. Izoh/faktura raqami/yetkazib beruvchi/turi
 * har doim o'zgaradi; miqdor yoki narx faqat kirimdan hali hech narsa sarflanmagan
 * bo'lsa (qatlam toza).
 */
export async function updatePurchase(a: UpdatePurchaseArgs) {
  const reason = requireReason(a.reason)
  const p = await (prisma as any).savdoPurchase.findUnique({ where: { id: a.id }, include: { costLayer: true } })
  if (!p || p.orgId !== a.orgId) throw new SavdoError('Kirim topilmadi', 404)
  if (p.status === 'cancelled') throw new SavdoError('Bekor qilingan kirimni tahrirlab bo\'lmaydi')
  if (isShadowPurchase(p)) throw new SavdoError('Bu ko\'chirish/inventarizatsiya natijasida paydo bo\'lgan qatlam — kirim sifatida tahrirlab bo\'lmaydi')

  if (a.supplierId) {
    const s = await (prisma as any).savdoSupplier.findUnique({ where: { id: a.supplierId } })
    if (!s || s.orgId !== a.orgId) throw new SavdoError('Yetkazib beruvchi topilmadi', 404)
  }

  const newQty = a.quantity !== undefined ? parseQty(a.quantity) : qn(p.quantity)
  if (newQty === null) throw new SavdoError('Miqdor musbat son bo\'lishi kerak')
  const newCost = a.unitCost !== undefined ? Number(a.unitCost) : Number(p.unitCost)
  if (!Number.isFinite(newCost) || newCost < 0) throw new SavdoError('Narx noto\'g\'ri')
  const changesStock = newQty !== qn(p.quantity) || newCost !== Number(p.unitCost)
  if (changesStock && p.docId) {
    throw new SavdoError('Bu kirim hujjat tarkibida — miqdor/narxni hujjatni tahrirlab o\'zgartiring (xarajatlar qayta taqsimlanadi)')
  }
  if (changesStock) assertUntouched(p)

  const beforeSnap = {
    quantity: qn(p.quantity), unitCost: Number(p.unitCost), isOfficial: p.isOfficial,
    supplierId: p.supplierId, invoiceNumber: p.invoiceNumber, notes: p.notes,
  }
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
    const updatedPurchase = await tx.savdoPurchase.update({
      where: { id: a.id },
      data: {
        quantity: newQty, unitCost: newCost,
        ...(a.isOfficial !== undefined && { isOfficial: Boolean(a.isOfficial) }),
        ...(a.supplierId !== undefined && { supplierId: a.supplierId || null }),
        ...(a.invoiceNumber !== undefined && { invoiceNumber: a.invoiceNumber || null }),
        ...(a.notes !== undefined && { notes: a.notes || null }),
      },
    })
    const prod = await tx.savdoProduct.findUnique({ where: { id: p.productId }, select: { name: true } })
    await writeAudit(tx, {
      orgId: a.orgId, entity: 'purchase', entityId: a.id, entityLabel: prod?.name ?? null, action: 'edit', reason,
      before: beforeSnap,
      after: {
        quantity: qn(updatedPurchase.quantity), unitCost: Number(updatedPurchase.unitCost), isOfficial: updatedPurchase.isOfficial,
        supplierId: updatedPurchase.supplierId, invoiceNumber: updatedPurchase.invoiceNumber, notes: updatedPurchase.notes,
      },
      userId: a.actorId ?? null,
    })
    return updatedPurchase
  })
}

// ── Qoralama: yarmida to'xtab, keyin davom ettirish ──────────────────────────
// Qoralama OMBORNI O'ZGARTIRMAYDI: forma JSON sifatida saqlanadi. "Kirim qilish" paytida
// to'liq tekshiruv bilan (xuddi yangi hujjatdek) qatorlar, qatlamlar va qoldiq yoziladi.

const MAX_DRAFT_LINES = 500
const MAX_DRAFT_COSTS = 100

export async function saveDocDraft(orgId: string, actorId: string, docId: string | null, raw: any) {
  const lines = Array.isArray(raw?.lines) ? raw.lines.slice(0, MAX_DRAFT_LINES) : []
  const costs = Array.isArray(raw?.costs) ? raw.costs.slice(0, MAX_DRAFT_COSTS) : []
  const payload = {
    warehouseId: raw?.warehouseId || '', supplierId: raw?.supplierId || null,
    invoiceNumber: raw?.invoiceNumber ? String(raw.invoiceNumber).slice(0, 80) : null,
    currency: raw?.currency ? String(raw.currency).slice(0, 8) : 'USD',
    exchangeRate: raw?.exchangeRate ?? null, allocBy: raw?.allocBy === 'quantity' ? 'quantity' : 'value',
    minWage: raw?.minWage ?? null, isOfficial: raw?.isOfficial !== false,
    notes: raw?.notes ? String(raw.notes).slice(0, 500) : null, costs, lines,
  }
  const rate = Number(payload.exchangeRate)
  const data = {
    warehouseId: payload.warehouseId, supplierId: payload.supplierId, invoiceNumber: payload.invoiceNumber,
    currency: payload.currency.toUpperCase(), exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    allocBy: payload.allocBy, isOfficial: payload.isOfficial, notes: payload.notes, draftPayload: payload,
  }
  if (docId) {
    const existing = await (prisma as any).savdoPurchaseDoc.findUnique({ where: { id: docId } })
    if (!existing || existing.orgId !== orgId || existing.status !== 'draft') throw new SavdoError('Qoralama topilmadi', 404)
    return (prisma as any).savdoPurchaseDoc.update({ where: { id: docId }, data })
  }
  return (prisma as any).savdoPurchaseDoc.create({ data: { ...data, orgId, status: 'draft', createdById: actorId } })
}

/** Qoralamani kirim qiladi. Ikki marta bosish ikki kirim bo'lmasligi uchun holat atomik egallanadi. */
export async function postDocDraft(orgId: string, docId: string, actorId: string) {
  const doc = await (prisma as any).savdoPurchaseDoc.findUnique({ where: { id: docId } })
  if (!doc || doc.orgId !== orgId) throw new SavdoError('Qoralama topilmadi', 404)
  if (doc.status !== 'draft' || !doc.draftPayload) throw new SavdoError('Bu hujjat qoralama emas yoki allaqachon kirim qilingan', 409)

  const claim = await (prisma as any).savdoPurchaseDoc.updateMany({ where: { id: docId, orgId, status: 'draft' }, data: { status: 'posting' } })
  if (claim.count === 0) throw new SavdoError('Hujjat hozir kirim qilinmoqda', 409)

  const pl = doc.draftPayload as any
  const input: PurchaseDocInput = {
    orgId, actorId,
    warehouseId: pl.warehouseId, supplierId: pl.supplierId || null, invoiceNumber: pl.invoiceNumber || null,
    currency: pl.currency, exchangeRate: pl.exchangeRate != null ? Number(pl.exchangeRate) : undefined,
    allocBy: pl.allocBy === 'quantity' ? 'quantity' : 'value', minWage: pl.minWage != null ? Number(pl.minWage) : null,
    isOfficial: pl.isOfficial !== false, notes: pl.notes || null,
    // Qoralamadagi bo'sh qator/xarajatlar tashlab yuboriladi
    costs: (pl.costs || []).filter((c: any) => String(c?.label || '').trim() && Number(c?.amount) > 0),
    lines: (pl.lines || []).filter((l: any) => l?.productId && Number(l?.quantity) > 0),
  }
  try {
    const v = await validateDocInput(input)
    const number = await nextImportDocNum(orgId)
    await prisma.$transaction(async (tx: any) => {
      await tx.savdoPurchaseDoc.update({
        where: { id: docId },
        data: {
          warehouseId: input.warehouseId, supplierId: input.supplierId, invoiceNumber: input.invoiceNumber,
          currency: v.currency, exchangeRate: v.rate, allocBy: input.allocBy || 'value',
          isOfficial: input.isOfficial !== false, notes: input.notes, minWage: v.minWage,
          status: 'completed', draftPayload: null, number,
        },
      })
      await writeDoc(tx, docId, input, v)
    }, { timeout: 30000 })
  } catch (e) {
    // Xato bo'lsa qoralama joyida qoladi — to'g'rilab qayta urinish mumkin
    await (prisma as any).savdoPurchaseDoc.updateMany({ where: { id: docId, status: 'posting' }, data: { status: 'draft' } })
    throw e
  }
  return (prisma as any).savdoPurchaseDoc.findUnique({ where: { id: docId } })
}

export async function deleteDocDraft(orgId: string, docId: string) {
  const doc = await (prisma as any).savdoPurchaseDoc.findUnique({ where: { id: docId } })
  if (!doc || doc.orgId !== orgId || doc.status !== 'draft') throw new SavdoError('Qoralama topilmadi', 404)
  await (prisma as any).savdoPurchaseDoc.delete({ where: { id: docId } })
}

/**
 * Kirim qilingan hujjatning MA'LUMOTLARINI tuzatish (invoys raqami, yetkazib beruvchi, izoh, rasmiylik).
 * Ombor, miqdor va tannarxga tegmaydi — shuning uchun tovar sotilgan bo'lsa ham ishlaydi.
 * Miqdor/narx/xarajatni o'zgartirish uchun to'liq tahrir (sotilmagan bo'lsa) kerak.
 */
export async function updateDocMeta(orgId: string, docId: string, m: { invoiceNumber?: string | null; supplierId?: string | null; notes?: string | null; isOfficial?: boolean }, actorId?: string | null, rawReason?: unknown) {
  const reason = requireReason(rawReason)
  const doc = await (prisma as any).savdoPurchaseDoc.findUnique({ where: { id: docId } })
  if (!doc || doc.orgId !== orgId) throw new SavdoError('Kirim hujjati topilmadi', 404)
  if (doc.status !== 'completed') throw new SavdoError('Faqat kirim qilingan hujjat ma\'lumotini tuzatish mumkin')
  if (m.supplierId) {
    const sup = await (prisma as any).savdoSupplier.findUnique({ where: { id: m.supplierId } })
    if (!sup || sup.orgId !== orgId) throw new SavdoError('Yetkazib beruvchi topilmadi', 404)
  }
  const data: any = {}
  if (m.invoiceNumber !== undefined) data.invoiceNumber = m.invoiceNumber ? String(m.invoiceNumber).trim().slice(0, 80) : null
  if (m.supplierId !== undefined) data.supplierId = m.supplierId || null
  if (m.notes !== undefined) data.notes = m.notes ? String(m.notes).trim().slice(0, 500) : null
  if (m.isOfficial !== undefined) data.isOfficial = Boolean(m.isOfficial)
  const pick = (d: any) => ({ invoiceNumber: d.invoiceNumber, supplierId: d.supplierId, notes: d.notes, isOfficial: d.isOfficial })
  await prisma.$transaction(async (tx: any) => {
    await tx.savdoPurchaseDoc.update({ where: { id: docId }, data })
    await tx.savdoPurchase.updateMany({ where: { docId }, data })
    const after = await tx.savdoPurchaseDoc.findUnique({ where: { id: docId } })
    await writeAudit(tx, {
      orgId, entity: 'purchase_doc', entityId: docId, entityLabel: doc.number || doc.invoiceNumber || null,
      action: 'meta', reason, before: pick(doc), after: pick(after), userId: actorId ?? null,
    })
  })
  return (prisma as any).savdoPurchaseDoc.findUnique({ where: { id: docId } })
}
