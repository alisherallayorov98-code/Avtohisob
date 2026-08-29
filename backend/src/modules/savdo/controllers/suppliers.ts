import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'

export async function listSuppliers(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const suppliers = await (prisma as any).savdoSupplier.findMany({
      where: { orgId },
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: suppliers })
  } catch (err) { next(err) }
}

export async function createSupplier(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { name, contactPerson, phone, address } = req.body

    if (!name || !String(name).trim()) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }

    const supplier = await (prisma as any).savdoSupplier.create({
      data: {
        orgId,
        name: String(name).trim(),
        contactPerson: contactPerson || null,
        phone: phone || null,
        address: address || null,
      },
    })
    res.status(201).json({ success: true, data: supplier })
  } catch (err) { next(err) }
}

export async function updateSupplier(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params
    const { name, contactPerson, phone, address, isActive } = req.body

    const existing = await (prisma as any).savdoSupplier.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Yetkazib beruvchi topilmadi' })
      return
    }

    const supplier = await (prisma as any).savdoSupplier.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(contactPerson !== undefined && { contactPerson: contactPerson || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(address !== undefined && { address: address || null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    })
    res.json({ success: true, data: supplier })
  } catch (err) { next(err) }
}
