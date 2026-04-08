import { Response, NextFunction } from 'express'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'

export async function listPromoCodes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const codes = await (prisma as any).promoCode.findMany({ orderBy: { createdAt: 'desc' } })
    res.json({ success: true, data: codes })
  } catch (err) { next(err) }
}

export async function createPromoCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { code, discountPercent, maxUses, expiresAt, description } = req.body
    const existing = await (prisma as any).promoCode.findUnique({ where: { code: code.toUpperCase() } })
    if (existing) return res.status(400).json({ success: false, error: 'Bu kod allaqachon mavjud' })
    const promo = await (prisma as any).promoCode.create({
      data: {
        code: code.toUpperCase(),
        discountPercent: parseInt(discountPercent),
        maxUses: maxUses ? parseInt(maxUses) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        description,
      },
    })
    res.json({ success: true, data: promo })
  } catch (err) { next(err) }
}

export async function updatePromoCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { isActive, maxUses, expiresAt, description } = req.body
    const promo = await (prisma as any).promoCode.update({
      where: { id: req.params.id },
      data: {
        isActive,
        maxUses: maxUses ? parseInt(maxUses) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        description,
      },
    })
    res.json({ success: true, data: promo })
  } catch (err) { next(err) }
}

export async function deletePromoCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await (prisma as any).promoCode.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { next(err) }
}
