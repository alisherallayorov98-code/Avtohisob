import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { resolveOrgId } from '../lib/orgFilter'

// GET /gas-stations — org zonalari
export async function listGasStations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)
    const stations = await (prisma as any).gasStation.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
    })
    res.json(successResponse(stations))
  } catch (err) { next(err) }
}

function validateCoords(lat: any, lon: any, radiusM: any) {
  const la = Number(lat), lo = Number(lon), r = Number(radiusM)
  if (!isFinite(la) || la < -90 || la > 90) throw new AppError('Latitude noto\'g\'ri', 400)
  if (!isFinite(lo) || lo < -180 || lo > 180) throw new AppError('Longitude noto\'g\'ri', 400)
  if (!isFinite(r) || r < 20 || r > 2000) throw new AppError('Radius 20-2000 metr oralig\'ida bo\'lishi kerak', 400)
  return { la, lo, r: Math.round(r) }
}

// POST /gas-stations
export async function createGasStation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)
    const { name, lat, lon, radiusM } = req.body
    if (!name || !String(name).trim()) throw new AppError('Nomi majburiy', 400)
    const { la, lo, r } = validateCoords(lat, lon, radiusM ?? 150)
    const station = await (prisma as any).gasStation.create({
      data: { orgId, name: String(name).trim(), lat: la, lon: lo, radiusM: r },
    })
    res.status(201).json(successResponse(station, 'Gaz stansiyasi qo\'shildi'))
  } catch (err) { next(err) }
}

// PUT /gas-stations/:id
export async function updateGasStation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)
    const existing = await (prisma as any).gasStation.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.orgId !== orgId) throw new AppError('Stansiya topilmadi', 404)
    const { name, lat, lon, radiusM, isActive } = req.body
    const data: any = {}
    if (name !== undefined) { if (!String(name).trim()) throw new AppError('Nomi bo\'sh', 400); data.name = String(name).trim() }
    if (lat !== undefined || lon !== undefined || radiusM !== undefined) {
      const { la, lo, r } = validateCoords(lat ?? existing.lat, lon ?? existing.lon, radiusM ?? existing.radiusM)
      data.lat = la; data.lon = lo; data.radiusM = r
    }
    if (isActive !== undefined) data.isActive = !!isActive
    const station = await (prisma as any).gasStation.update({ where: { id: req.params.id }, data })
    res.json(successResponse(station, 'Saqlandi'))
  } catch (err) { next(err) }
}

// DELETE /gas-stations/:id
export async function deleteGasStation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)
    const existing = await (prisma as any).gasStation.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.orgId !== orgId) throw new AppError('Stansiya topilmadi', 404)
    await (prisma as any).gasStation.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'O\'chirildi'))
  } catch (err) { next(err) }
}
