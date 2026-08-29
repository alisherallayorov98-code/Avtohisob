import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { computeExpectedBalance, computeDiscrepancy } from '../lib/kassaSmena'

export async function getCurrentSmena(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { warehouseId } = req.query as Record<string, string>
    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }

    const smena = await (prisma as any).savdoKassaSmena.findFirst({
      where: { orgId, warehouseId, status: 'open' },
      orderBy: { openedAt: 'desc' },
    })
    res.json({ success: true, data: smena })
  } catch (err) { next(err) }
}

export async function listSmenas(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const where: any = { orgId }
    if (q.warehouseId) where.warehouseId = q.warehouseId

    const smenas = await (prisma as any).savdoKassaSmena.findMany({
      where,
      include: { warehouse: { select: { id: true, name: true } } },
      orderBy: { openedAt: 'desc' },
      take: 100,
    })
    res.json({ success: true, data: smenas })
  } catch (err) { next(err) }
}

export async function openSmena(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const { warehouseId, openingBalance } = req.body

    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }
    const warehouse = await (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } })
    if (!warehouse || warehouse.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Ombor topilmadi' })
      return
    }

    const existing = await (prisma as any).savdoKassaSmena.findFirst({
      where: { orgId, warehouseId, status: 'open' },
    })
    if (existing) {
      res.status(409).json({ success: false, error: 'Bu omborda allaqachon ochiq smena bor' })
      return
    }

    const openedById = await ensureSavdoActor(actor)
    try {
      const smena = await (prisma as any).savdoKassaSmena.create({
        data: {
          orgId, warehouseId, openedById,
          openingBalance: Number(openingBalance) || 0,
        },
      })
      res.status(201).json({ success: true, data: smena, message: 'Smena ochildi' })
    } catch (createErr: any) {
      // DB'dagi qisman unique indeks (bitta omborga bitta ochiq smena) —
      // yuqoridagi findFirst tekshiruvi bilan poyga holatida ikkalasi ham
      // "yo'q" ko'rib qolishi mumkin edi, shu yerda DB darajasida ushlanadi.
      if (createErr?.code === 'P2002' || /unique/i.test(String(createErr?.message))) {
        res.status(409).json({ success: false, error: 'Bu omborda allaqachon ochiq smena bor' })
        return
      }
      throw createErr
    }
  } catch (err) { next(err) }
}

export async function closeSmena(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const { id } = req.params
    const { closingBalance } = req.body

    const smena = await (prisma as any).savdoKassaSmena.findUnique({ where: { id } })
    if (!smena || smena.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Smena topilmadi' })
      return
    }
    if (smena.status !== 'open') {
      res.status(409).json({ success: false, error: 'Smena allaqachon yopilgan' })
      return
    }
    if (closingBalance === undefined || !Number.isFinite(Number(closingBalance))) {
      res.status(400).json({ success: false, error: 'closingBalance talab qilinadi' })
      return
    }

    const sales = await (prisma as any).savdoSale.findMany({
      where: { kassaSmenaId: id, status: 'completed' },
      select: { totalAmount: true },
    })
    const expectedBalance = computeExpectedBalance(
      Number(smena.openingBalance),
      sales.map((s: any) => Number(s.totalAmount)),
    )
    const discrepancy = computeDiscrepancy(Number(closingBalance), expectedBalance)
    const closedById = await ensureSavdoActor(actor)

    const updated = await (prisma as any).savdoKassaSmena.update({
      where: { id },
      data: {
        status: 'closed',
        closingBalance: Number(closingBalance),
        expectedBalance,
        discrepancy,
        closedById,
        closedAt: new Date(),
      },
    })
    res.json({ success: true, data: updated, message: 'Smena yopildi' })
  } catch (err) { next(err) }
}
