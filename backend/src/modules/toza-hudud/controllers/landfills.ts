import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'

export async function getLandfills(req: Request, res: Response, next: NextFunction) {
  try {
    const landfills = await (prisma as any).thLandfill.findMany({ orderBy: { name: 'asc' } })
    res.json({ success: true, data: landfills })
  } catch (err) { next(err) }
}

export async function createLandfill(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, location, polygon } = req.body
    if (!name?.trim()) throw new AppError('Poligon nomi kiritilishi shart', 400)
    const landfill = await (prisma as any).thLandfill.create({
      data: { name: name.trim(), location: location?.trim() || null, polygon: polygon || null },
    })
    res.status(201).json({ success: true, data: landfill })
  } catch (err) { next(err) }
}

export async function updateLandfill(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, location, polygon } = req.body
    if (!name?.trim()) throw new AppError('Poligon nomi kiritilishi shart', 400)
    const landfill = await (prisma as any).thLandfill.update({
      where: { id: req.params.id },
      data: {
        name: name.trim(),
        location: location?.trim() || null,
        ...(polygon !== undefined && { polygon: polygon || null }),
      },
    })
    res.json({ success: true, data: landfill })
  } catch (err) { next(err) }
}

export async function deleteLandfill(req: Request, res: Response, next: NextFunction) {
  try {
    await (prisma as any).thLandfill.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
