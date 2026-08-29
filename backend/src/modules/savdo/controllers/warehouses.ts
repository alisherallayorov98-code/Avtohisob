import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { paginate, paginatedResponse } from '../../../types'

export async function listWarehouses(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { page, limit, skip } = paginate(req.query)
    const where = { orgId }

    const [total, warehouses] = await Promise.all([
      (prisma as any).savdoWarehouse.count({ where }),
      (prisma as any).savdoWarehouse.findMany({
        where, skip, take: limit,
        orderBy: { name: 'asc' },
      }),
    ])
    res.json(paginatedResponse(warehouses, total, page, limit))
  } catch (err) { next(err) }
}

// Dropdown/tanlov uchun yengil ro'yxat — sahifalanmagan.
export async function listWarehouseOptions(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const warehouses = await (prisma as any).savdoWarehouse.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, location: true },
      orderBy: { name: 'asc' },
      take: 500,
    })
    res.json({ success: true, data: warehouses })
  } catch (err) { next(err) }
}

export async function createWarehouse(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { name, location } = req.body

    if (!name || !String(name).trim()) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }

    const warehouse = await (prisma as any).savdoWarehouse.create({
      data: { orgId, name: String(name).trim(), location: location || null },
    })
    res.status(201).json({ success: true, data: warehouse })
  } catch (err) { next(err) }
}

export async function updateWarehouse(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params
    const { name, location, isActive } = req.body

    const existing = await (prisma as any).savdoWarehouse.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Ombor topilmadi' })
      return
    }

    const warehouse = await (prisma as any).savdoWarehouse.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(location !== undefined && { location: location || null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    })
    res.json({ success: true, data: warehouse })
  } catch (err) { next(err) }
}
