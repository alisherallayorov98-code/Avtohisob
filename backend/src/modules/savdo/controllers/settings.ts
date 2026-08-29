import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'

export async function getSettings(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const settings = await (prisma as any).savdoOrgSettings.findUnique({ where: { orgId } })
    res.json({ success: true, data: settings || { orgId } })
  } catch (err) { next(err) }
}

export async function updateSettings(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { companyName, stir, address, phone, bankAccount, bankName, director, accountant } = req.body

    const data = {
      companyName: companyName || null, stir: stir || null, address: address || null,
      phone: phone || null, bankAccount: bankAccount || null, bankName: bankName || null,
      director: director || null, accountant: accountant || null,
    }

    const settings = await (prisma as any).savdoOrgSettings.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    })
    res.json({ success: true, data: settings, message: 'Sozlamalar saqlandi' })
  } catch (err) { next(err) }
}
