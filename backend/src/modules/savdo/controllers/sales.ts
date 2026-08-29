import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { createSale, CreateSaleLineInput } from '../services/saleService'
import { SavdoError } from '../lib/savdoError'

function normalizeSaleLines(lines: any[]): CreateSaleLineInput[] {
  return lines.map((l: any) => ({
    productId: l.productId,
    quantity: Number(l.quantity),
    unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
  }))
}

export async function listSales(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>

    const where: any = { orgId }
    if (q.customerId) where.customerId = q.customerId
    if (q.warehouseId) where.warehouseId = q.warehouseId

    const sales = await (prisma as any).savdoSale.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        lines: { select: { id: true, quantity: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json({ success: true, data: sales })
  } catch (err) { next(err) }
}

export async function getSale(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params

    const sale = await (prisma as any).savdoSale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        warehouse: { select: { id: true, name: true } },
        lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    })
    if (!sale || sale.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Sotuv topilmadi' })
      return
    }
    res.json({ success: true, data: sale })
  } catch (err) { next(err) }
}

export async function createSaleHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { warehouseId, customerId, lines, notes } = req.body

    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ success: false, error: 'Kamida bitta qator kerak' })
      return
    }

    const soldById = await ensureSavdoActor(actor)

    const sale = await createSale({
      orgId: actor.orgId,
      warehouseId,
      customerId: customerId || null,
      saleType: 'invoice',
      soldById,
      notes: notes || null,
      lines: normalizeSaleLines(lines),
    })

    res.status(201).json({ success: true, data: sale, message: `Faktura ${sale.documentNumber} yaratildi` })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

// Kassa/POS — tezkor sotish. POS sotuvi darhol to'liq naqd to'langan deb
// hisoblanadi (kassa smena hisob-kitobi shunga tayanadi). Ochiq smena
// bo'lishi shart. Mijoz ko'rsatilsa to'lov yozuvi createSale bilan BIR XIL
// tranzaksiyada yoziladi (autoSettleCustomerId) — sotuv "completed" bo'lib,
// to'lov yozish keyin muvaffaqiyatsiz bo'lib qolishining oldini oladi.
export async function createPosSaleHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { warehouseId, customerId, lines } = req.body

    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ success: false, error: 'Kamida bitta qator kerak' })
      return
    }

    const smena = await (prisma as any).savdoKassaSmena.findFirst({
      where: { orgId: actor.orgId, warehouseId, status: 'open' },
    })
    if (!smena) {
      res.status(409).json({ success: false, error: 'Bu omborda ochiq kassa smenasi yo\'q — avval smenani oching' })
      return
    }

    const soldById = await ensureSavdoActor(actor)

    const sale = await createSale({
      orgId: actor.orgId,
      warehouseId,
      customerId: customerId || null,
      saleType: 'pos',
      kassaSmenaId: smena.id,
      soldById,
      autoSettleCustomerId: customerId || null,
      lines: normalizeSaleLines(lines),
    })

    res.status(201).json({ success: true, data: sale, message: `Sotuv ${sale.documentNumber} yakunlandi` })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}
