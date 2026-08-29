// Savdo — omborlar orasida tovar ko'chirishning YAGONA yadrosi.
//
// Ko'chirish faqat qoldiqni emas, FIFO TANNARX QATLAMINI ham ko'chiradi:
// manba omborda qatlamlar FIFO tartibida sarflanadi (saleService.ts bilan bir xil
// atomik pattern), qabul qiluvchi omborda esa har bir sarflangan qatlam uchun
// AYNAN o'sha unitCost bilan yangi qatlam ochiladi. Shu tufayli keyingi sotuvda
// tannarx to'g'ri chiqadi — o'rtachalashtirilib yubormaydi.
//
// SavdoCostLayer.purchaseId majburiy va unique, shuning uchun har qatlamga
// "soya xarid" (isOfficial:false) yoziladi — inventoryService.ts'dagi
// "Inventarizatsiya ortiqchasi" bilan aynan bir xil pattern (audit izi:
// qatlam qayerdan kelgani ko'rinib turadi).

import { prisma } from '../../../lib/prisma'
import { consumeFifoLayers } from '../lib/fifoCost'
import { SavdoError } from '../lib/savdoError'

export interface CreateTransferInput {
  orgId: string
  fromWarehouseId: string
  toWarehouseId: string
  productId: string
  quantity: number
  transferredById?: string | null
  notes?: string | null
}

export interface CancelTransferInput {
  orgId: string
  transferId: string
  cancelledById?: string | null
}

/** Soya xarid izohi — bekor qilishda shu belgi bo'yicha qatlamlar topiladi. */
function transferNote(transferId: string): string {
  return `Omborlararo ko'chirish (${transferId})`
}

function reverseNote(transferId: string): string {
  return `Omborlararo ko'chirish bekor qilindi (${transferId})`
}

export async function createTransfer(input: CreateTransferInput) {
  const { orgId, fromWarehouseId, toWarehouseId, productId } = input

  if (!fromWarehouseId || !toWarehouseId || !productId) {
    throw new SavdoError('fromWarehouseId, toWarehouseId va productId talab qilinadi')
  }
  if (fromWarehouseId === toWarehouseId) {
    throw new SavdoError('Manba va qabul qiluvchi ombor bir xil bo\'lishi mumkin emas')
  }
  // Int ustunlarga yoziladi — purchases.ts/saleService.ts bilan bir xil qoida
  const qty = Math.round(Number(input.quantity))
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new SavdoError('quantity musbat son bo\'lishi kerak')
  }

  const [fromWarehouse, toWarehouse, product] = await Promise.all([
    (prisma as any).savdoWarehouse.findUnique({ where: { id: fromWarehouseId } }),
    (prisma as any).savdoWarehouse.findUnique({ where: { id: toWarehouseId } }),
    (prisma as any).savdoProduct.findUnique({ where: { id: productId } }),
  ])
  if (!fromWarehouse || fromWarehouse.orgId !== orgId) {
    throw new SavdoError('Manba ombor topilmadi', 404)
  }
  if (!toWarehouse || toWarehouse.orgId !== orgId) {
    throw new SavdoError('Qabul qiluvchi ombor topilmadi', 404)
  }
  if (!product || product.orgId !== orgId) {
    throw new SavdoError('Mahsulot topilmadi', 404)
  }

  return prisma.$transaction(async (tx: any) => {
    const transfer = await tx.savdoTransfer.create({
      data: {
        orgId, fromWarehouseId, toWarehouseId, productId,
        quantity: qty,
        transferredById: input.transferredById || null,
        notes: input.notes || null,
      },
    })

    // 1) Manba ombordan qoldiq ATOMIK kamayadi (race yo'qolgan bo'lsa count===0)
    const stockDown = await tx.savdoStock.updateMany({
      where: { productId, warehouseId: fromWarehouseId, quantityOnHand: { gte: qty } },
      data: { quantityOnHand: { decrement: qty } },
    })
    if (stockDown.count === 0) {
      throw new SavdoError(`"${product.name}" uchun manba omborda yetarli qoldiq yo'q`, 409)
    }

    // 2) Manba omborning FIFO qatlamlari sarflanadi
    const layers = await tx.savdoCostLayer.findMany({
      where: { productId, warehouseId: fromWarehouseId, remainingQty: { gt: 0 } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const fifoLayers = layers.map((l: any) => ({
      id: l.id, unitCost: Number(l.unitCost), remainingQty: l.remainingQty, createdAt: l.createdAt,
    }))
    let fifoResult
    try {
      fifoResult = consumeFifoLayers(fifoLayers, qty)
    } catch (e: any) {
      // fifoCost.ts pure funksiya — oddiy Error tashlaydi, 409'ga o'raladi
      throw new SavdoError(e?.message || 'Tannarx hisoblashda xato', 409)
    }
    const { consumptions, totalCost } = fifoResult

    for (const c of consumptions) {
      const layerUpdate = await tx.savdoCostLayer.updateMany({
        where: { id: c.layerId, remainingQty: { gte: c.quantity } },
        data: { remainingQty: { decrement: c.quantity } },
      })
      if (layerUpdate.count === 0) {
        throw new SavdoError('Tannarx qatlami bo\'yicha poyga aniqlandi, qayta urinib ko\'ring', 409)
      }

      // 3) Qabul qiluvchi omborda AYNAN o'sha tannarx bilan yangi qatlam
      const shadowPurchase = await tx.savdoPurchase.create({
        data: {
          orgId, productId, warehouseId: toWarehouseId,
          quantity: c.quantity, unitCost: c.unitCost, isOfficial: false,
          notes: transferNote(transfer.id),
          receivedById: input.transferredById || null,
        },
      })
      await tx.savdoCostLayer.create({
        data: {
          orgId, purchaseId: shadowPurchase.id, productId, warehouseId: toWarehouseId,
          unitCost: c.unitCost, quantity: c.quantity, remainingQty: c.quantity,
        },
      })
    }

    // 4) Qabul qiluvchi ombor qoldig'i oshadi
    await tx.savdoStock.upsert({
      where: { productId_warehouseId: { productId, warehouseId: toWarehouseId } },
      create: { productId, warehouseId: toWarehouseId, quantityOnHand: qty },
      update: { quantityOnHand: { increment: qty } },
    })

    return tx.savdoTransfer.update({
      where: { id: transfer.id },
      data: { totalCost },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        fromWarehouse: { select: { id: true, name: true } },
        toWarehouse: { select: { id: true, name: true } },
      },
    })
  })
}

/**
 * Ko'chirishni bekor qilish — teskari harakat.
 * Faqat ko'chirish natijasida qabul omborda ochilgan qatlamlardan HALI hech
 * narsa sarflanmagan bo'lsa ruxsat (remainingQty === quantity). Aks holda
 * amalga oshgan sotuvlarning tannarx tarixi buzilardi (cancelPurchase bilan
 * bir xil qoida).
 */
export async function cancelTransfer(input: CancelTransferInput) {
  const { orgId, transferId } = input

  const transfer = await (prisma as any).savdoTransfer.findUnique({
    where: { id: transferId },
    include: { product: { select: { name: true } } },
  })
  if (!transfer || transfer.orgId !== orgId) {
    throw new SavdoError('Ko\'chirish topilmadi', 404)
  }
  if (transfer.status === 'cancelled') {
    throw new SavdoError('Bu ko\'chirish allaqachon bekor qilingan')
  }

  // Ko'chirish paytida yaratilgan soya xaridlar — izohda transfer id bor
  const shadowPurchases = await (prisma as any).savdoPurchase.findMany({
    where: {
      orgId,
      warehouseId: transfer.toWarehouseId,
      productId: transfer.productId,
      status: 'completed',
      notes: { contains: transfer.id },
    },
    include: { costLayer: true },
  })
  if (shadowPurchases.length === 0) {
    throw new SavdoError('Ko\'chirish tannarx qatlamlari topilmadi — bekor qilib bo\'lmaydi', 409)
  }
  for (const p of shadowPurchases) {
    if (!p.costLayer || p.costLayer.remainingQty !== p.costLayer.quantity) {
      throw new SavdoError('Ko\'chirilgan tovardan allaqachon sotilgan — bekor qilib bo\'lmaydi', 409)
    }
  }

  return prisma.$transaction(async (tx: any) => {
    // 1) Qabul ombor qoldig'i atomik kamayadi
    const stockDown = await tx.savdoStock.updateMany({
      where: {
        productId: transfer.productId, warehouseId: transfer.toWarehouseId,
        quantityOnHand: { gte: transfer.quantity },
      },
      data: { quantityOnHand: { decrement: transfer.quantity } },
    })
    if (stockDown.count === 0) {
      throw new SavdoError('Qabul qiluvchi ombor qoldig\'i o\'zgargan, qayta urinib ko\'ring', 409)
    }

    for (const p of shadowPurchases) {
      // 2) Qabul ombordagi qatlam yopiladi (hali sarflanmagani yuqorida tekshirilgan)
      const layerClose = await tx.savdoCostLayer.updateMany({
        where: { id: p.costLayer.id, remainingQty: p.costLayer.quantity },
        data: { remainingQty: 0 },
      })
      if (layerClose.count === 0) {
        throw new SavdoError('Ko\'chirilgan tovardan allaqachon sotilgan — bekor qilib bo\'lmaydi', 409)
      }
      await tx.savdoPurchase.update({
        where: { id: p.id },
        data: { status: 'cancelled', cancelledById: input.cancelledById || null, cancelledAt: new Date() },
      })

      // 3) Manba omborga AYNAN o'sha tannarx bilan qatlam qaytariladi
      //    (createTransfer'ning teskarisi — from/to almashtirilgan)
      const backPurchase = await tx.savdoPurchase.create({
        data: {
          orgId, productId: transfer.productId, warehouseId: transfer.fromWarehouseId,
          quantity: p.costLayer.quantity, unitCost: p.costLayer.unitCost, isOfficial: false,
          notes: reverseNote(transfer.id),
          receivedById: input.cancelledById || null,
        },
      })
      await tx.savdoCostLayer.create({
        data: {
          orgId, purchaseId: backPurchase.id,
          productId: transfer.productId, warehouseId: transfer.fromWarehouseId,
          unitCost: p.costLayer.unitCost,
          quantity: p.costLayer.quantity, remainingQty: p.costLayer.quantity,
        },
      })
    }

    // 4) Manba ombor qoldig'i qaytariladi
    await tx.savdoStock.upsert({
      where: {
        productId_warehouseId: {
          productId: transfer.productId, warehouseId: transfer.fromWarehouseId,
        },
      },
      create: {
        productId: transfer.productId, warehouseId: transfer.fromWarehouseId,
        quantityOnHand: transfer.quantity,
      },
      update: { quantityOnHand: { increment: transfer.quantity } },
    })

    return tx.savdoTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'cancelled',
        cancelledById: input.cancelledById || null,
        cancelledAt: new Date(),
      },
    })
  })
}
