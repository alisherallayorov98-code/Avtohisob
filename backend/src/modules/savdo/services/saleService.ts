// Savdo — sotuv yaratishning YAGONA yadrosi. Faktura (invoice) va kelajakda
// kassa/POS ikkalasi ham shu funksiyani chaqiradi (bitta "canonical sale" yo'li,
// ikki nusxa mantiq bo'lmasligi uchun — CLAUDE.md talabi bilan bir xil qoida
// EkoHisob'ning recordEkoPayment'i uchun ham amal qiladi).
//
// Har bir qator: narx pricing.ts orqali (qo'lda berilmasa mijoz optom/chakana
// toifasidan), tannarx FIFO qatlamlaridan (fifoCost.ts) hisoblanadi. Qoldiq va
// qatlam sarfi ATOMIK updateMany bilan kamayadi (WHERE ...>=kerak), race
// yo'qolgan bo'lsa xato — maintenanceApproval.ts'dagi bilan bir xil pattern.

import { prisma } from '../../../lib/prisma'
import { consumeFifoLayers } from '../lib/fifoCost'
import { resolveUnitPrice } from '../lib/pricing'
import { nextSaleDocNum } from '../lib/docSeq'
import { SavdoError } from '../lib/savdoError'

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
}

export async function createSale(input: CreateSaleInput) {
  const { orgId, warehouseId, lines } = input

  if (!lines || lines.length === 0) {
    throw new SavdoError('Kamida bitta qator kerak')
  }
  for (const line of lines) {
    if (!line.productId) throw new SavdoError('productId talab qilinadi')
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new SavdoError('quantity musbat son bo\'lishi kerak')
    }
  }

  const warehouse = await (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse || warehouse.orgId !== orgId) {
    throw new SavdoError('Ombor topilmadi', 404)
  }

  let customer: any = null
  if (input.customerId) {
    customer = await (prisma as any).savdoCustomer.findUnique({ where: { id: input.customerId } })
    if (!customer || customer.orgId !== orgId) {
      throw new SavdoError('Mijoz topilmadi', 404)
    }
  }

  const productIds = [...new Set(lines.map(l => l.productId))]
  const products = await (prisma as any).savdoProduct.findMany({ where: { id: { in: productIds } } })
  const productMap = new Map(products.map((p: any) => [p.id, p]))
  for (const id of productIds) {
    const p: any = productMap.get(id)
    if (!p || p.orgId !== orgId) throw new SavdoError('Mahsulot topilmadi', 404)
  }

  // Hujjat raqami tranzaksiyadan OLDIN — o'z ichida atomik, uzoq tranzaksiyani
  // navbatda ushlab turmaydi (ekohisob nextReceiptNum bilan bir xil sabab).
  const documentNumber = await nextSaleDocNum(orgId)

  const result = await prisma.$transaction(async (tx: any) => {
    const sale = await tx.savdoSale.create({
      data: {
        orgId,
        documentNumber,
        customerId: input.customerId || null,
        warehouseId,
        saleType: input.saleType || 'invoice',
        kassaSmenaId: input.kassaSmenaId || null,
        soldById: input.soldById || null,
        notes: input.notes || null,
      },
    })

    let totalAmount = 0
    let totalCost = 0

    for (const line of lines) {
      const product: any = productMap.get(line.productId)
      const qty = Math.round(line.quantity)

      // 1) Qoldiqni atomik kamaytirish — race yo'qolgan bo'lsa 0 qaytadi
      const stockUpdate = await tx.savdoStock.updateMany({
        where: { productId: line.productId, warehouseId, quantityOnHand: { gte: qty } },
        data: { quantityOnHand: { decrement: qty } },
      })
      if (stockUpdate.count === 0) {
        throw new SavdoError(`"${product.name}" uchun omborda yetarli qoldiq yo'q`, 409)
      }

      // 2) FIFO qatlamlarni tanlash va sarflash
      const layers = await tx.savdoCostLayer.findMany({
        where: { productId: line.productId, warehouseId, remainingQty: { gt: 0 } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      const fifoLayers = layers.map((l: any) => ({
        id: l.id, unitCost: Number(l.unitCost), remainingQty: l.remainingQty, createdAt: l.createdAt,
      }))
      const { consumptions, totalCost: lineCost, avgUnitCost } = consumeFifoLayers(fifoLayers, qty)

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
        data: {
          saleId: sale.id,
          productId: line.productId,
          quantity: qty,
          unitPrice,
          unitCost: avgUnitCost,
          lineTotal,
          lineCost,
        },
      })

      if (consumptions.length > 0) {
        await tx.savdoCostConsumption.createMany({
          data: consumptions.map(c => ({
            saleLineId: saleLine.id,
            costLayerId: c.layerId,
            quantity: c.quantity,
            unitCost: c.unitCost,
          })),
        })
      }

      totalAmount += lineTotal
      totalCost += lineCost
    }

    const updatedSale = await tx.savdoSale.update({
      where: { id: sale.id },
      data: {
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
      },
      include: {
        lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
      },
    })

    return updatedSale
  })

  return result
}
