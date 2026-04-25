import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'

export async function getStreets(req: Request, res: Response, next: NextFunction) {
  try {
    const { mfyId, page = '1', limit = '50' } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const where: any = {}
    if (mfyId) where.mfyId = mfyId

    const [total, streets] = await Promise.all([
      (prisma as any).thStreet.count({ where }),
      (prisma as any).thStreet.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: { mfy: { select: { id: true, name: true, district: { select: { id: true, name: true } } } } },
      }),
    ])
    res.json({ success: true, data: streets, meta: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function createStreet(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, mfyId, linestring } = req.body
    if (!name?.trim()) throw new AppError('Ko\'cha nomi kiritilishi shart', 400)
    if (!mfyId) throw new AppError('MFY tanlanishi shart', 400)
    const street = await (prisma as any).thStreet.create({
      data: { name: name.trim(), mfyId, linestring: linestring || null },
      include: { mfy: { select: { id: true, name: true } } },
    })
    res.status(201).json({ success: true, data: street })
  } catch (err) { next(err) }
}

export async function updateStreet(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, mfyId, linestring } = req.body
    if (!name?.trim()) throw new AppError('Ko\'cha nomi kiritilishi shart', 400)
    const street = await (prisma as any).thStreet.update({
      where: { id: req.params.id },
      data: {
        name: name.trim(),
        ...(mfyId && { mfyId }),
        ...(linestring !== undefined && { linestring: linestring || null }),
      },
      include: { mfy: { select: { id: true, name: true } } },
    })
    res.json({ success: true, data: street })
  } catch (err) { next(err) }
}

export async function deleteStreet(req: Request, res: Response, next: NextFunction) {
  try {
    await (prisma as any).thStreet.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
