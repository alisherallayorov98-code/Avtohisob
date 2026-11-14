// Savdo — sotuv yaratishning YAGONA yadrosi. Faktura (invoice), kassa/POS va
// spetsifikatsiya ikkalasi ham shu funksiyani chaqiradi (bitta "canonical sale"
// yo'li, ikki nusxa mantiq bo'lmasligi uchun).
//
// Har bir qator: narx pricing.ts orqali (qo'lda berilmasa mijoz optom/chakana
// toifasidan), tannarx FIFO qatlamlaridan (fifoCost.ts) hisoblanadi. Qoldiq va
// qatlam sarfi ATOMIK updateMany bilan kamayadi (WHERE ...>=kerak), race
// yo'qolgan bo'lsa xato.
//
// Miqdor kasr bo'lishi mumkin (Decimal 14,3). QQS ixtiyoriy: qator narxlari
// QQSsiz, vatRate berilsa totalAmount = jami + QQS, vatAmount alohida saqlanadi
// (daromad hisobida QQS ayriladi).
//
// Tahrirlash (updateSale) — faqat admin: eski sarfni teskari qaytarib, yangi
// qatorlarni shu hujjat raqami ostida qayta qo'llaydi (BIR tranzaksiyada).

import { prisma } from '../../../lib/prisma'
import { consumeFifoLayers } from '../lib/fifoCost'
import { resolveUnitPrice } from '../lib/pricing'
import { nextSaleDocNum, nextSpecDocNum } from '../lib/docSeq'
import { SavdoError } from '../lib/savdoError'
import { parseQty, qn } from '../lib/qty'
import { applyVat, normalizeVatRate } from '../lib/vatMath'
import { writeAudit, requireReason } from '../lib/audit'

// To'lov turi: cash — naqd (darhol to'langan), transfer — perechisleniya (bank o'tkazmasi,
// pul keyin/oldin keladi, bank to'lovi sifatida yoziladi), credit — qarzga (muddat bilan).
export const SALE_PAYMENT_TYPES = ['cash', 'transfer', 'credit'] as const
export type SalePaymentType = typeof SALE_PAYMENT_TYPES[number]

/** Naqd sotuvning avtomatik to'lovi shu groupId bilan belgilanadi (tahrir/bekor qilishda topiladi). */
export const autoPayGroup = (saleId: string): string => `auto:${saleId}`

export function resolvePaymentType(raw: unknown, hasCustomer: boolean, fallback: SalePaymentType): SalePaymentType {
  const t = (raw === undefined || raw === null || raw === '') ? fallback : String(raw)
  if (!(SALE_PAYMENT_TYPES as readonly string[]).includes(t)) {
    throw new SavdoError("To'lov turi: cash (naqd) | transfer (perechisleniya) | credit (qarz)")
  }
  if (t !== 'cash' && !hasCustomer) {
    throw new SavdoError('Perechisleniya yoki qarzga sotish uchun mijozni tanlang')
  }
  return t as SalePaymentType
}

function parseDue(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) throw new SavdoError("To'lov muddati noto'g'ri")
  return d
}

export interface CreateSaleLineInput {
  productId: string
  quantity: number
  unitPrice?: number | null
}

export interface CreateSaleInput {
  orgId: string
  warehouseId: string
  customerId?: string | null
  saleType?: 'invoice' | 'pos'
  kassaSmenaId?: string | null
  soldById?: string | null
  notes?: string | null
  lines: CreateSaleLineInput[]
  vatRate?: number | null
  specId?: string | null
  paymentType?: SalePaymentType | string | null
  dueDate?: string | Date | null
}

interface PreparedLine { productId: string; qty: number; unitPrice: number | null }

function validateLines(lines: CreateSaleLineInput[]): PreparedLine[] {
  if (!lines || lines.length === 0) throw new SavdoError('Kamida bitta qator kerak')
  return lines.map(line => {
    if (!line.productId) throw new SavdoError('productId talab qilinadi')
    const qty = parseQty(line.quantity)
    if (qty === null) throw new SavdoError('quantity musbat son bo\'lishi kerak')
    const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : null
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      throw new SavdoError("Narx noto'g'ri (manfiy yoki son emas)")
    }
    return { productId: line.productId, qty, unitPrice }
  })
}

function parseVat(v: unknown): number | null {
  try { return normalizeVatRate(v) } catch (e: any) { throw new SavdoError(e.message) }
}

async function loadProducts(orgId: string, prepared: PreparedLine[], requireActive = true) {
  const productIds = [...new Set(prepared.map(l => l.productId))]
  const products = await (prisma as any).savdoProduct.findMany({ where: { id: { in: productIds } } })
  const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]))
  for (const id of productIds) {
    const p = productMap.get(id)
    if (!p || p.orgId !== orgId) throw new SavdoError('Mahsulot topilmadi', 404)
    if (requireActive && p.isActive === false) throw new SavdoError(`"${p.name}" faol emas — sotib bo'lmaydi`)
  }
  return productMap
}

/** Qatorlarni qo'llaydi: qoldiq+FIFO sarfi, SaleLine, Consumption. Jami summa/tannarxni qaytaradi. */
async function applyLines(
  tx: any, saleId: string, warehouseId: string, prepared: PreparedLine[],
  productMap: Map<string, any>, customer: any,
): Promise<{ subtotal: number; totalCost: number }> {
  let subtotal = 0
  let totalCost = 0

  for (const line of prepared) {
    const product = productMap.get(line.productId)
    const qty = line.qty

    const stockUpdate = await tx.savdoStock.updateMany({
      where: { productId: line.productId, warehouseId, quantityOnHand: { gte: qty } },
      data: { quantityOnHand: { decrement: qty } },
    })
    if (stockUpdate.count === 0) {
      throw new SavdoError(`"${product.name}" uchun omborda yetarli qoldiq yo'q`, 409)
    }

    const layers = await tx.savdoCostLayer.findMany({
      where: { productId: line.productId, warehouseId, remainingQty: { gt: 0 } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const fifoLayers = layers.map((l: any) => ({
      id: l.id, unitCost: Number(l.unitCost), remainingQty: qn(l.remainingQty), createdAt: l.createdAt,
    }))
    let fifoResult
    try {
      fifoResult = consumeFifoLayers(fifoLayers, qty)
    } catch (e: any) {
      throw new SavdoError(e?.message || 'Tannarx hisoblashda xato', 409)
    }
    const { consumptions, totalCost: lineCost, avgUnitCost } = fifoResult

    for (const c of consumptions) {
      const layerUpdate = await tx.savdoCostLayer.updateMany({
        where: { id: c.layerId, remainingQty: { gte: c.quantity } },
        data: { remainingQty: { decrement: c.quantity } },
      })
      if (layerUpdate.count === 0) {
        throw new SavdoError('Tannarx qatlami bo\'yicha poyga aniqlandi, qayta urinib ko\'ring', 409)
      }
    }

    const unitPrice = resolveUnitPrice({
      wholesalePrice: Number(product.wholesalePrice),
      retailPrice: Number(product.retailPrice),
      customerPriceTier: customer?.priceTier ?? null,
      manualPrice: line.unitPrice ?? null,
    })
    const lineTotal = Math.round(unitPrice * qty * 100) / 100

    const saleLine = await tx.savdoSaleLine.create({
      data: { saleId, productId: line.productId, quantity: qty, unitPrice, unitCost: avgUnitCost, lineTotal, lineCost },
    })
    if (consumptions.length > 0) {
      await tx.savdoCostConsumption.createMany({
        data: consumptions.map(c => ({
          saleLineId: saleLine.id, costLayerId: c.layerId, quantity: c.quantity, unitCost: c.unitCost,
        })),
      })
    }
    subtotal += lineTotal
    totalCost += lineCost
  }
  return { subtotal: Math.round(subtotal * 100) / 100, totalCost: Math.round(totalCost * 100) / 100 }
}

/** Yuridik mijoz: kartochkada "yuridik shaxs" belgilangan yoki STIR kiritilgan. */
export function isLegalCustomer(c: any): boolean {
  return Boolean(c && (c.isLegal || (c.stir && String(c.stir).trim())))
}

interface AutoSpecParams {
  orgId: string; number: string; saleId: string; documentNumber: string; warehouseId: string
  customer: any; paymentType: string; dueDate: Date | null; vatRate: number | null
  actorId: string | null; createdAt?: Date
}

/**
 * Faktura-sotuvdan spetsifikatsiya hujjatini yaratadi (darhol "Tasdiqlangan").
 * Qatorlar sotuvning haqiqiy narxlari bilan; shartnoma ma'lumoti mijoz kartochkasidan.
 */
async function writeAutoSpec(tx: any, p: AutoSpecParams): Promise<string> {
  const lines = await tx.savdoSaleLine.findMany({ where: { saleId: p.saleId }, select: { productId: true, quantity: true, unitPrice: true } })
  const spec = await tx.savdoSpec.create({
    data: {
      orgId: p.orgId, number: p.number, customerId: p.customer.id, warehouseId: p.warehouseId,
      contractNumber: p.customer.contractNumber || null, contractDate: p.customer.contractDate || null,
      vatRate: p.vatRate, paymentType: p.paymentType, dueDate: p.dueDate,
      status: 'confirmed', saleId: p.saleId, autoFromSale: true, createdById: p.actorId,
      notes: `Faktura ${p.documentNumber} asosida avtomatik`,
      ...(p.createdAt && { createdAt: p.createdAt }),
      lines: { create: lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })) },
    },
  })
  return spec.id
}

/** Sotuv tahrirlanganda bog'langan spetsifikatsiyani sotuvga moslaydi (qatorlar, mijoz, QQS, to'lov). */
async function syncSpecFromSale(tx: any, specId: string, saleId: string, d: { customerId: string; vatRate: number | null; paymentType: string; dueDate: Date | null }) {
  const lines = await tx.savdoSaleLine.findMany({ where: { saleId }, select: { productId: true, quantity: true, unitPrice: true } })
  await tx.savdoSpecLine.deleteMany({ where: { specId } })
  await tx.savdoSpec.update({
    where: { id: specId },
    data: {
      customerId: d.customerId, vatRate: d.vatRate, paymentType: d.paymentType, dueDate: d.dueDate,
      lines: { create: lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })) },
    },
  })
}

/** Audit uchun sotuv holati. */
function saleSnapshot(s: any) {
  return {
    documentNumber: s.documentNumber, customerId: s.customerId, paymentType: s.paymentType,
    dueDate: s.dueDate ?? null, vatRate: s.vatRate != null ? Number(s.vatRate) : null,
    totalAmount: Number(s.totalAmount), totalCost: Number(s.totalCost), notes: s.notes ?? null,
    lines: s.lines.map((l: any) => ({
      key: l.product?.sku ?? l.productId, product: l.product?.name ?? '', quantity: qn(l.quantity),
      unitPrice: Number(l.unitPrice), lineTotal: Number(l.lineTotal),
    })),
  }
}

const SALE_INCLUDE = {
  lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
}

export async function createSale(input: CreateSaleInput) {
  const { orgId, warehouseId } = input
  const prepared = validateLines(input.lines)
  const vatRate = parseVat(input.vatRate)

  const warehouse = await (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse || warehouse.orgId !== orgId) throw new SavdoError('Ombor topilmadi', 404)
  if (warehouse.isActive === false) throw new SavdoError('Ombor faol emas')

  let customer: any = null
  if (input.customerId) {
    customer = await (prisma as any).savdoCustomer.findUnique({ where: { id: input.customerId } })
    if (!customer || customer.orgId !== orgId) throw new SavdoError('Mijoz topilmadi', 404)
    if (customer.isActive === false) throw new SavdoError('Mijoz faol emas')
  }
  const productMap = await loadProducts(orgId, prepared)
  // POS doim naqd; faktura: mijoz bo'lsa qarz (eski xatti-harakat), bo'lmasa naqd
  const paymentType = input.saleType === 'pos'
    ? 'cash'
    : resolvePaymentType(input.paymentType, Boolean(input.customerId), input.customerId ? 'credit' : 'cash')
  const dueDate = paymentType === 'cash' ? null : parseDue(input.dueDate)
  // Naqd faktura ham omborning ochiq kassa smenasiga tushadi (aks holda smena kutilgan
  // qoldig'i naqd fakturani hisobga olmasdi va kassa "ortiqcha" ko'rinardi)
  let kassaSmenaId: string | null = input.kassaSmenaId || null
  if (!kassaSmenaId && paymentType === 'cash') {
    const open = await (prisma as any).savdoKassaSmena.findFirst({ where: { orgId, warehouseId, status: 'open' }, select: { id: true } })
    kassaSmenaId = open?.id ?? null
  }

  // Hujjat raqami tranzaksiyadan OLDIN (atomik, uzoq tranzaksiyani ushlab turmaydi)
  const documentNumber = await nextSaleDocNum(orgId)
  // Yuridik mijozga faktura — spetsifikatsiya hujjati avtomatik (spetsifikatsiyadan kelgan sotuvdan tashqari)
  const autoSpecNumber = (input.saleType || 'invoice') === 'invoice' && !input.specId && isLegalCustomer(customer)
    ? await nextSpecDocNum(orgId) : null

  return prisma.$transaction(async (tx: any) => {
    const sale = await tx.savdoSale.create({
      data: {
        orgId, documentNumber,
        customerId: input.customerId || null,
        warehouseId,
        saleType: input.saleType || 'invoice',
        kassaSmenaId,
        soldById: input.soldById || null,
        notes: input.notes || null,
        specId: input.specId || null,
        paymentType, dueDate,
      },
    })

    const { subtotal, totalCost } = await applyLines(tx, sale.id, warehouseId, prepared, productMap, customer)
    const { vatAmount, total } = applyVat(subtotal, vatRate)

    const autoSpecId = autoSpecNumber
      ? await writeAutoSpec(tx, {
        orgId, number: autoSpecNumber, saleId: sale.id, documentNumber, warehouseId, customer,
        paymentType, dueDate, vatRate, actorId: input.soldById || null,
      })
      : null

    const updatedSale = await tx.savdoSale.update({
      where: { id: sale.id },
      data: { totalAmount: total, totalCost, vatRate, vatAmount, ...(autoSpecId && { specId: autoSpecId }) },
      include: SALE_INCLUDE,
    })

    // Naqd sotuv + mijoz: to'lov SHU tranzaksiyada yoziladi (sotuv "completed" bo'lib,
    // to'lov yozish keyin muvaffaqiyatsiz bo'lib qolmasin). Mijozsiz naqd — to'lov yozuvi yo'q,
    // hisobotda to'langan hisoblanadi.
    if (paymentType === 'cash' && input.customerId && total > 0) {
      await tx.savdoPayment.create({
        data: {
          orgId, customerId: input.customerId, saleId: sale.id,
          amount: total, method: 'cash', groupId: autoPayGroup(sale.id),
          receivedById: input.soldById || input.customerId,
        },
      })
    }
    return updatedSale
  })
}

/** Sotuvning FIFO sarfi va qoldiqni teskari qaytaradi (cancel va update uchun umumiy). */
async function reverseSaleEffects(tx: any, sale: any): Promise<void> {
  for (const line of sale.lines) {
    for (const c of line.consumptions) {
      await tx.savdoCostLayer.update({
        where: { id: c.costLayerId },
        data: { remainingQty: { increment: c.quantity } },
      })
    }
    await tx.savdoStock.upsert({
      where: { productId_warehouseId: { productId: line.productId, warehouseId: sale.warehouseId } },
      create: { productId: line.productId, warehouseId: sale.warehouseId, quantityOnHand: line.quantity },
      update: { quantityOnHand: { increment: line.quantity } },
    })
  }
}

export interface CancelSaleInput {
  orgId: string
  saleId: string
  cancelledById: string
  reason?: string | null
}

/**
 * Sotuvni bekor qilish — teskari harakat: har bir qator sarflagan aniq FIFO
 * qatlamlarga remainingQty qaytariladi, qoldiq oshiriladi, sotuvga bog'langan
 * to'lovlar saleId=null qilib avansga aylantiriladi. Sotuv status='cancelled'.
 */
export async function cancelSale(input: CancelSaleInput) {
  const { orgId, saleId, cancelledById } = input

  const sale = await (prisma as any).savdoSale.findUnique({
    where: { id: saleId },
    include: { lines: { include: { consumptions: true, product: { select: { name: true, sku: true } } } } },
  })
  if (!sale || sale.orgId !== orgId) throw new SavdoError('Sotuv topilmadi', 404)
  if (sale.status === 'cancelled') throw new SavdoError('Bu sotuv allaqachon bekor qilingan')

  return prisma.$transaction(async (tx: any) => {
    await reverseSaleEffects(tx, sale)
    // Naqd sotuvning avtomatik to'lovi sotuv bilan birga bekor bo'ladi (pul qaytdi);
    // qolgan to'lovlar yo'qolmasin — avansga aylanadi
    await tx.savdoPayment.updateMany({
      where: { saleId, cancelled: false, groupId: autoPayGroup(saleId) },
      data: { cancelled: true, cancelledById, cancelledAt: new Date() },
    })
    await tx.savdoPayment.updateMany({ where: { saleId, cancelled: false }, data: { saleId: null } })
    // Spetsifikatsiyadan yaratilgan bo'lsa — spetsifikatsiya qoralamaga qaytadi;
    // sotuvdan avtomatik yaratilgan spetsifikatsiya esa sotuv bilan birga bekor bo'ladi
    if (sale.specId) {
      await tx.savdoSpec.updateMany({
        where: { id: sale.specId, saleId, autoFromSale: true },
        data: { status: 'cancelled' },
      })
      await tx.savdoSpec.updateMany({
        where: { id: sale.specId, saleId, autoFromSale: false },
        data: { status: 'draft', saleId: null },
      })
    }
    // Zakazdan yaratilgan bo'lsa — zakaz "yig'ildi" holatiga qaytadi (qayta sotish mumkin)
    await tx.savdoOrder.updateMany({ where: { orgId, saleId }, data: { status: 'picked', saleId: null } })
    const cancelled = await tx.savdoSale.update({
      where: { id: saleId },
      data: {
        status: 'cancelled', cancelledById, cancelledAt: new Date(),
        notes: input.reason ? `${sale.notes ? sale.notes + ' | ' : ''}Bekor qilindi: ${input.reason}` : sale.notes,
      },
    })
    await writeAudit(tx, {
      orgId, entity: 'sale', entityId: saleId, entityLabel: sale.documentNumber, action: 'cancel',
      reason: String(input.reason || '').trim() || 'Sabab ko\'rsatilmagan', before: saleSnapshot(sale), userId: cancelledById,
    })
    return cancelled
  })
}

export interface UpdateSaleInput {
  orgId: string
  saleId: string
  /** Tahrirlash sababi — MAJBURIY (audit jurnaliga yoziladi) */
  reason?: string | null
  actorId?: string | null
  customerId?: string | null
  notes?: string | null
  lines?: CreateSaleLineInput[]
  vatRate?: number | null
  paymentType?: SalePaymentType | string | null
  dueDate?: string | Date | null
}

/**
 * Sotuvni tahrirlash (faqat admin chaqiradi). Faqat bekor qilinmagan "invoice"
 * turi: POS sotuvi kassa smenasi va avto-to'lov bilan bog'langan, uni tahrirlab
 * bo'lmaydi (bekor qilib qayta soting). Hujjat raqami o'zgarmaydi.
 */
export async function updateSale(input: UpdateSaleInput) {
  const { orgId, saleId } = input
  const reason = requireReason(input.reason)
  const sale = await (prisma as any).savdoSale.findUnique({
    where: { id: saleId },
    include: { lines: { include: { consumptions: true, product: { select: { name: true, sku: true } } } } },
  })
  if (!sale || sale.orgId !== orgId) throw new SavdoError('Sotuv topilmadi', 404)
  if (sale.status === 'cancelled') throw new SavdoError('Bekor qilingan sotuvni tahrirlab bo\'lmaydi')
  if (sale.saleType === 'pos') throw new SavdoError('Kassa (POS) sotuvini tahrirlab bo\'lmaydi — bekor qilib qayta soting')

  let customer: any = null
  const customerId = input.customerId !== undefined ? (input.customerId || null) : sale.customerId
  if (customerId) {
    customer = await (prisma as any).savdoCustomer.findUnique({ where: { id: customerId } })
    if (!customer || customer.orgId !== orgId) throw new SavdoError('Mijoz topilmadi', 404)
  }

  const vatRate = input.vatRate !== undefined ? parseVat(input.vatRate) : (sale.vatRate != null ? Number(sale.vatRate) : null)

  // Qatorlar berilmasa — mavjud qatorlar (narxlari bilan) qayta qo'llanadi
  const srcLines: CreateSaleLineInput[] = input.lines ?? sale.lines.map((l: any) => ({
    productId: l.productId, quantity: qn(l.quantity), unitPrice: Number(l.unitPrice),
  }))
  const prepared = validateLines(srcLines)
  const productMap = await loadProducts(orgId, prepared, input.lines !== undefined)
  const paymentType = resolvePaymentType(input.paymentType, Boolean(customerId), sale.paymentType)
  const dueDate = paymentType === 'cash' ? null
    : input.dueDate !== undefined ? parseDue(input.dueDate) : sale.dueDate
  const linkedSpec = sale.specId
    ? await (prisma as any).savdoSpec.findUnique({ where: { id: sale.specId }, select: { id: true, status: true, autoFromSale: true, saleId: true } })
    : null
  const specActive = Boolean(linkedSpec && linkedSpec.saleId === saleId && linkedSpec.status === 'confirmed')
  const autoSpecNumber = !specActive && isLegalCustomer(customer) ? await nextSpecDocNum(orgId) : null

  return prisma.$transaction(async (tx: any) => {
    await reverseSaleEffects(tx, sale)
    await tx.savdoSaleLine.deleteMany({ where: { saleId } }) // consumptions cascade

    const { subtotal, totalCost } = await applyLines(tx, saleId, sale.warehouseId, prepared, productMap, customer)
    const { vatAmount, total } = applyVat(subtotal, vatRate)

    // Kassa smenasi: naqddan chiqsa (smena ochiq bo'lsa) ajratiladi, naqdga o'tsa ochiq smenaga qo'shiladi
    let kassaSmenaId: string | null = sale.kassaSmenaId
    if (paymentType !== 'cash' && kassaSmenaId) {
      const sm = await tx.savdoKassaSmena.findUnique({ where: { id: kassaSmenaId }, select: { status: true } })
      if (sm?.status === 'open') kassaSmenaId = null
    } else if (paymentType === 'cash' && !kassaSmenaId) {
      const open = await tx.savdoKassaSmena.findFirst({ where: { orgId, warehouseId: sale.warehouseId, status: 'open' }, select: { id: true } })
      kassaSmenaId = open?.id ?? null
    }

    // Naqd to'lovni yangi jami/mijoz/tur bilan moslash
    const autoWhere = { saleId, groupId: autoPayGroup(saleId), cancelled: false }
    const autoPay = await tx.savdoPayment.findFirst({ where: autoWhere })
    if (paymentType === 'cash' && customerId && total > 0) {
      if (autoPay) {
        await tx.savdoPayment.update({ where: { id: autoPay.id }, data: { amount: total, customerId } })
      } else {
        await tx.savdoPayment.create({
          data: {
            orgId, customerId, saleId, amount: total, method: 'cash', groupId: autoPayGroup(saleId),
            receivedById: sale.soldById || customerId,
          },
        })
      }
    } else if (autoPay) {
      // Naqddan boshqa turga o'tdi (yoki jami 0) — avtomatik to'lov bekor qilinadi
      await tx.savdoPayment.update({ where: { id: autoPay.id }, data: { cancelled: true, cancelledAt: new Date() } })
    }

    // Bog'langan spetsifikatsiyani sotuvga moslash (yoki yuridik mijozga o'tgan bo'lsa yaratish)
    let specId: string | null = sale.specId
    if (specActive) {
      if (customerId) await syncSpecFromSale(tx, linkedSpec.id, saleId, { customerId, vatRate, paymentType, dueDate })
      else if (linkedSpec.autoFromSale) await tx.savdoSpec.update({ where: { id: linkedSpec.id }, data: { status: 'cancelled' } })
    } else if (autoSpecNumber) {
      specId = await writeAutoSpec(tx, {
        orgId, number: autoSpecNumber, saleId, documentNumber: sale.documentNumber, warehouseId: sale.warehouseId,
        customer, paymentType, dueDate, vatRate, actorId: input.actorId ?? null,
      })
    }

    const updated = await tx.savdoSale.update({
      where: { id: saleId },
      data: {
        specId, customerId, paymentType, dueDate, kassaSmenaId, totalAmount: total, totalCost, vatRate, vatAmount,
        ...(input.notes !== undefined && { notes: input.notes || null }),
      },
      include: SALE_INCLUDE,
    })
    await writeAudit(tx, {
      orgId, entity: 'sale', entityId: saleId, entityLabel: sale.documentNumber, action: 'edit', reason,
      before: saleSnapshot(sale), after: saleSnapshot(updated), userId: input.actorId ?? null,
    })
    return updated
  })
}

/**
 * O'tgan faktura-sotuvlar uchun spetsifikatsiya yaratish (yuridik mijoz, spetsifikatsiyasiz,
 * bekor qilinmagan). Sana sotuv sanasi bilan. Yaratilganlar sonini qaytaradi.
 */
export async function backfillAutoSpecs(orgId: string, actorId: string | null): Promise<number> {
  const sales = await (prisma as any).savdoSale.findMany({
    where: {
      orgId, status: 'completed', saleType: 'invoice', specId: null,
      customer: { OR: [{ isLegal: true }, { stir: { not: null } }] },
    },
    include: { customer: true },
    orderBy: { createdAt: 'asc' },
    take: 2000,
  })
  let created = 0
  for (const sale of sales) {
    if (!isLegalCustomer(sale.customer)) continue
    const number = await nextSpecDocNum(orgId)
    await prisma.$transaction(async (tx: any) => {
      const specId = await writeAutoSpec(tx, {
        orgId, number, saleId: sale.id, documentNumber: sale.documentNumber, warehouseId: sale.warehouseId,
        customer: sale.customer, paymentType: sale.paymentType, dueDate: sale.dueDate,
        vatRate: sale.vatRate != null ? Number(sale.vatRate) : null, actorId, createdAt: sale.createdAt,
      })
      await tx.savdoSale.update({ where: { id: sale.id }, data: { specId } })
    })
    created++
  }
  return created
}
