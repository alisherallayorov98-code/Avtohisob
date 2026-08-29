// Inventarizatsiya — joriy holat hisoboti va jismoniy sanashni tasdiqlash
// (qoldiq+tannarx qatlamini bitta tranzaksiyada tuzatish) yagona joyi.

import { prisma } from '../../../lib/prisma'
import { consumeFifoLayers } from '../lib/fifoCost'
import { computeAverageCost, computeCountDiff } from '../lib/inventoryAdjust'
import { SavdoError } from '../lib/savdoError'

export interface InventoryReportRow {
  productId: string
  productName: string
  sku: string
  unit: string
  warehouseId: string
  warehouseName: string
  quantityOnHand: number
  unitCost: number
  value: number
}

export interface InventoryReportWarehouseGroup {
  warehouseId: string
  warehouseName: string
  totalQty: number
  totalValue: number
  items: InventoryReportRow[]
}

/** Joriy holat hisoboti — yuklamasdan ham to'liq (Inventory.getStocktake bilan bir xil g'oya) */
export async function getInventoryReport(orgId: string, warehouseId?: string | null) {
  const stockWhere: any = { product: { orgId } }
  if (warehouseId) stockWhere.warehouseId = warehouseId

  const [stock, costLayers] = await Promise.all([
    (prisma as any).savdoStock.findMany({
      where: stockWhere,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: [{ warehouse: { name: 'asc' } }, { product: { name: 'asc' } }],
    }),
    (prisma as any).savdoCostLayer.findMany({
      where: { orgId, remainingQty: { gt: 0 }, ...(warehouseId && { warehouseId }) },
      select: { productId: true, warehouseId: true, unitCost: true, remainingQty: true },
    }),
  ])

  const layersByKey = new Map<string, { unitCost: number; remainingQty: number }[]>()
  for (const l of costLayers) {
    const key = `${l.productId}:${l.warehouseId}`
    const arr = layersByKey.get(key) || []
    arr.push({ unitCost: Number(l.unitCost), remainingQty: l.remainingQty })
    layersByKey.set(key, arr)
  }

  const byWarehouse = new Map<string, InventoryReportWarehouseGroup>()
  for (const s of stock) {
    const key = `${s.productId}:${s.warehouseId}`
    const layers = layersByKey.get(key) || []
    const unitCost = computeAverageCost(layers)
    const value = Math.round(s.quantityOnHand * unitCost * 100) / 100

    if (!byWarehouse.has(s.warehouseId)) {
      byWarehouse.set(s.warehouseId, {
        warehouseId: s.warehouseId, warehouseName: s.warehouse.name,
        totalQty: 0, totalValue: 0, items: [],
      })
    }
    const group = byWarehouse.get(s.warehouseId)!
    group.items.push({
      productId: s.productId, productName: s.product.name, sku: s.product.sku, unit: s.product.unit,
      warehouseId: s.warehouseId, warehouseName: s.warehouse.name,
      quantityOnHand: s.quantityOnHand, unitCost, value,
    })
    group.totalQty += s.quantityOnHand
    group.totalValue = Math.round((group.totalValue + value) * 100) / 100
  }

  const warehouses = [...byWarehouse.values()]
  const grandTotal = Math.round(warehouses.reduce((s, w) => s + w.totalValue, 0) * 100) / 100
  const grandQty = warehouses.reduce((s, w) => s + w.totalQty, 0)

  return { warehouses, grandTotal, grandQty, asOf: new Date().toISOString() }
}

export interface CountLineInput {
  productId: string
  countedQty: number
}

export interface PreviewLine {
  productId: string
  productName: string
  sku: string
  unit: string
  systemQty: number
  countedQty: number
  diffQty: number
  unitCost: number
  diffValue: number
}

/** Yuklangan/qo'lda kiritilgan miqdorlarni joriy qoldiq bilan solishtiradi — SAQLAMAYDI. */
export async function previewInventoryCount(orgId: string, warehouseId: string, lines: CountLineInput[]): Promise<PreviewLine[]> {
  const productIds = [...new Set(lines.map(l => l.productId))]
  const [products, stocks, costLayers] = await Promise.all([
    (prisma as any).savdoProduct.findMany({ where: { id: { in: productIds }, orgId } }),
    (prisma as any).savdoStock.findMany({ where: { productId: { in: productIds }, warehouseId } }),
    (prisma as any).savdoCostLayer.findMany({
      where: { productId: { in: productIds }, warehouseId, remainingQty: { gt: 0 } },
      select: { productId: true, unitCost: true, remainingQty: true },
    }),
  ])
  const productMap = new Map(products.map((p: any) => [p.id, p]))
  const stockMap = new Map(stocks.map((s: any) => [s.productId, s.quantityOnHand]))
  const layersByProduct = new Map<string, { unitCost: number; remainingQty: number }[]>()
  for (const l of costLayers) {
    const arr = layersByProduct.get(l.productId) || []
    arr.push({ unitCost: Number(l.unitCost), remainingQty: l.remainingQty })
    layersByProduct.set(l.productId, arr)
  }

  return lines.map(line => {
    const product: any = productMap.get(line.productId)
    if (!product) throw new SavdoError(`Mahsulot topilmadi: ${line.productId}`, 404)
    const systemQty = Number(stockMap.get(line.productId) ?? 0)
    const layers = layersByProduct.get(line.productId) || []
    const { diffQty, unitCost, diffValue } = computeCountDiff(systemQty, line.countedQty, layers)
    return {
      productId: product.id, productName: product.name, sku: product.sku, unit: product.unit,
      systemQty, countedQty: Math.round(line.countedQty), diffQty, unitCost, diffValue,
    }
  })
}

export interface ConfirmCountInput {
  orgId: string
  warehouseId: string
  countedById: string
  notes?: string | null
  lines: CountLineInput[]
}

/**
 * Sanov natijasini saqlaydi VA bitta tranzaksiyada qoldiqni tuzatadi:
 * kamomad — FIFO qatlamlardan atomik sarflanadi (saleService bilan bir xil
 * race-xavfsiz pattern); ortiqcha — joriy o'rtacha tannarxda yangi qatlam
 * qo'shiladi. Diff=0 qatorlar hech narsani o'zgartirmaydi, faqat tarixga yoziladi.
 */
export async function confirmInventoryCount(input: ConfirmCountInput) {
  const { orgId, warehouseId, countedById, lines } = input
  if (!lines || lines.length === 0) {
    throw new SavdoError('Kamida bitta qator kerak')
  }

  const warehouse = await (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse || warehouse.orgId !== orgId) {
    throw new SavdoError('Ombor topilmadi', 404)
  }

  const preview = await previewInventoryCount(orgId, warehouseId, lines)

  const result = await prisma.$transaction(async (tx: any) => {
    const count = await tx.savdoInventoryCount.create({
      data: { orgId, warehouseId, countedById, notes: input.notes || null },
    })

    for (const p of preview) {
      await tx.savdoInventoryCountLine.create({
        data: {
          countId: count.id, productId: p.productId,
          systemQty: p.systemQty, countedQty: p.countedQty,
          diffQty: p.diffQty, unitCost: p.unitCost, diffValue: p.diffValue,
        },
      })

      if (p.diffQty === 0) continue

      if (p.diffQty < 0) {
        // Kamomad — FIFO qatlamlardan sarflanadi, qoldiq kamayadi
        const shortage = Math.abs(p.diffQty)
        const layers = await tx.savdoCostLayer.findMany({
          where: { productId: p.productId, warehouseId, remainingQty: { gt: 0 } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
        const fifoLayers = layers.map((l: any) => ({
          id: l.id, unitCost: Number(l.unitCost), remainingQty: l.remainingQty, createdAt: l.createdAt,
        }))
        let consumptions
        try {
          consumptions = consumeFifoLayers(fifoLayers, shortage).consumptions
        } catch (e: any) {
          throw new SavdoError(`"${p.productName}": ${e?.message || 'tannarx hisoblashda xato'}`, 409)
        }
        for (const c of consumptions) {
          const upd = await tx.savdoCostLayer.updateMany({
            where: { id: c.layerId, remainingQty: { gte: c.quantity } },
            data: { remainingQty: { decrement: c.quantity } },
          })
          if (upd.count === 0) {
            throw new SavdoError('Tannarx qatlami bo\'yicha poyga aniqlandi, qayta urinib ko\'ring', 409)
          }
        }
        const stockUpd = await tx.savdoStock.updateMany({
          where: { productId: p.productId, warehouseId, quantityOnHand: { gte: shortage } },
          data: { quantityOnHand: { decrement: shortage } },
        })
        if (stockUpd.count === 0) {
          throw new SavdoError(`"${p.productName}" uchun qoldiq poyga tufayli yetarli emas, qayta urinib ko'ring`, 409)
        }
      } else {
        // Ortiqcha — joriy o'rtacha tannarxda yangi qatlam qo'shiladi
        const surplus = p.diffQty
        // "purchaseId" majburiy va unique — inventarizatsiya uchun soya xarid yozuvi yaratiladi
        // (audit iz: bu qatlam qayerdan kelgani ko'rinib turadi).
        const shadowPurchase = await tx.savdoPurchase.create({
          data: {
            orgId, productId: p.productId, warehouseId,
            quantity: surplus, unitCost: p.unitCost, isOfficial: false,
            notes: `Inventarizatsiya ortiqchasi (${count.id})`,
            receivedById: countedById,
          },
        })
        await tx.savdoCostLayer.create({
          data: {
            orgId, purchaseId: shadowPurchase.id, productId: p.productId, warehouseId,
            unitCost: p.unitCost, quantity: surplus, remainingQty: surplus,
          },
        })
        await tx.savdoStock.upsert({
          where: { productId_warehouseId: { productId: p.productId, warehouseId } },
          create: { productId: p.productId, warehouseId, quantityOnHand: surplus },
          update: { quantityOnHand: { increment: surplus } },
        })
      }
    }

    return tx.savdoInventoryCount.findUnique({
      where: { id: count.id },
      include: {
        warehouse: { select: { id: true, name: true } },
        lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    })
  })

  return result
}
