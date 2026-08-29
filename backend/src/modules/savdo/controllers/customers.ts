import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'

export async function listCustomers(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>

    const where: any = { orgId }
    if (q.search) {
      where.OR = [
        { name: { contains: q.search.trim(), mode: 'insensitive' } },
        { phone: { contains: q.search.trim(), mode: 'insensitive' } },
      ]
    }

    const customers = await (prisma as any).savdoCustomer.findMany({
      where,
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: customers })
  } catch (err) { next(err) }
}

export async function createCustomer(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { name, phone, address, priceTier } = req.body

    if (!name || !String(name).trim()) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }
    if (priceTier && priceTier !== 'retail' && priceTier !== 'wholesale') {
      res.status(400).json({ success: false, error: 'priceTier: retail | wholesale' })
      return
    }

    const customer = await (prisma as any).savdoCustomer.create({
      data: {
        orgId,
        name: String(name).trim(),
        phone: phone || null,
        address: address || null,
        priceTier: priceTier || 'retail',
      },
    })
    res.status(201).json({ success: true, data: customer })
  } catch (err) { next(err) }
}

export async function updateCustomer(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params
    const { name, phone, address, priceTier, isActive } = req.body

    const existing = await (prisma as any).savdoCustomer.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Mijoz topilmadi' })
      return
    }
    if (priceTier !== undefined && priceTier !== 'retail' && priceTier !== 'wholesale') {
      res.status(400).json({ success: false, error: 'priceTier: retail | wholesale' })
      return
    }

    const customer = await (prisma as any).savdoCustomer.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(address !== undefined && { address: address || null }),
        ...(priceTier !== undefined && { priceTier }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    })
    res.json({ success: true, data: customer })
  } catch (err) { next(err) }
}
