import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'

export async function getRegions(req: Request, res: Response, next: NextFunction) {
  try {
    const regions = await (prisma as any).thRegion.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { districts: true } } },
    })
    res.json({ success: true, data: regions })
  } catch (err) { next(err) }
}

export async function createRegion(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body
    if (!name?.trim()) throw new AppError('Viloyat nomi kiritilishi shart', 400)
    const region = await (prisma as any).thRegion.create({ data: { name: name.trim() } })
    res.status(201).json({ success: true, data: region })
  } catch (err) { next(err) }
}

export async function updateRegion(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body
    if (!name?.trim()) throw new AppError('Viloyat nomi kiritilishi shart', 400)
    const region = await (prisma as any).thRegion.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    })
    res.json({ success: true, data: region })
  } catch (err) { next(err) }
}

export async function deleteRegion(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await (prisma as any).thDistrict.count({ where: { regionId: req.params.id } })
    if (count > 0) throw new AppError(`Bu viloyatda ${count} ta tuman bor. Avval tumanlarni o'chiring.`, 400)
    await (prisma as any).thRegion.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
