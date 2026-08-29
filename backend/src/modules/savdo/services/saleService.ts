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
  // POS: sotuv bilan bir vaqtda, BIR XIL tranzaksiyada mijoz nomiga to'liq
  // naqd to'lov yozadi. Alohida ikkinchi so'rov (createSale keyin
  // recordSavdoPayment) ishlatilmaydi — chunki ikkinchisi xato bersa sotuv
  // "completed" holatda qolib, mijoz sezilmasdan qarzdor bo'lib qolar edi.
  autoSettleCustomerId?: string | null
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
      let fifoResult
      try {
        fifoResult = consumeFifoLayers(fifoLayers, qty)
      } catch (e: any) {
        // fifoCost.ts oddiy Error tashlaydi (DB'ga bog'liq emas, pure funksiya) —
        // SavdoError'ga o'raladi, aks holda controller buni tushunarli 409
        // o'rniga umumiy 500 sifatida ko'rsatardi.
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

    const roundedTotal = Math.round(totalAmount * 100) / 100

    const updatedSale = await tx.savdoSale.update({
      where: { id: sale.id },
      data: {
        totalAmount: roundedTotal,
        totalCost: Math.round(totalCost * 100) / 100,
      },
      include: {
        lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
      },
    })

    // POS avtomatik to'lov — SHU tranzaksiya ichida, alohida so'rov emas
    // (yuqoridagi izohga qarang: atomiklik uchun).
    if (input.autoSettleCustomerId && roundedTotal > 0) {
      await tx.savdoPayment.create({
        data: {
          orgId,
          customerId: input.autoSettleCustomerId,
          saleId: sale.id,
          amount: roundedTotal,
          method: 'cash',
          receivedById: input.soldById || input.autoSettleCustomerId,
        },
      })
    }

    return updatedSale
  })

  return result
}

export interface CancelSaleInput {
  orgId: string
  saleId: string
  cancelledById: string
  reason?: string | null
}

/**
 * Sotuvni bekor qilish — joyida o'zgartirmaydi, aksincha teskari harakat
 * qiladi: har bir qator sarflagan aniq FIFO qatlamlarga (eng yangisiga emas)
 * remainingQty qaytariladi, qoldiq oshiriladi, sotuvga bog'langan to'lovlar
 * saleId=null qilib avansga aylantiriladi (yo'qolib qolmasin — mijoz krediti
 * sifatida ko'rinishda qoladi). Sotuv o'zi status='cancelled' bo'ladi,
 * totalAmount/totalCost audit uchun saqlanib qoladi.
 */
export async function cancelSale(input: CancelSaleInput) {
  const { orgId, saleId, cancelledById } = input

  const sale = await (prisma as any).savdoSale.findUnique({
    where: { id: saleId },
    include: { lines: { include: { consumptions: true } } },
  })
  if (!sale || sale.orgId !== orgId) {
    throw new SavdoError('Sotuv topilmadi', 404)
  }
  if (sale.status === 'cancelled') {
    throw new SavdoError('Bu sotuv allaqachon bekor qilingan')
  }

  const result = await prisma.$transaction(async (tx: any) => {
    for (const line of sale.lines) {
      // 1) Har bir sarflangan qatlamga aynan o'shancha miqdorni qaytaramiz
      for (const c of line.consumptions) {
        await tx.savdoCostLayer.update({
          where: { id: c.costLayerId },
          data: { remainingQty: { increment: c.quantity } },
        })
      }
      // 2) Qoldiqni oshiramiz
      await tx.savdoStock.upsert({
        where: { productId_warehouseId: { productId: line.productId, warehouseId: sale.warehouseId } },
        create: { productId: line.productId, warehouseId: sale.warehouseId, quantityOnHand: line.quantity },
        update: { quantityOnHand: { increment: line.quantity } },
      })
    }

    // 3) Shu sotuvga bog'langan to'lovlar — yo'qolib qolmasin, avans (saleId=null)ga aylanadi
    await tx.savdoPayment.updateMany({
      where: { saleId, cancelled: false },
      data: { saleId: null },
    })

    const updated = await tx.savdoSale.update({
      where: { id: saleId },
      data: {
        status: 'cancelled',
        cancelledById,
        cancelledAt: new Date(),
        notes: input.reason ? `${sale.notes ? sale.notes + ' | ' : ''}Bekor qilindi: ${input.reason}` : sale.notes,
      },
    })
    return updated
  })

  return result
}
