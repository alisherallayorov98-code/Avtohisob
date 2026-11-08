import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'
import { getEffectiveWarehouseId } from '../lib/warehouse'

const RECENT_DAYS = 365

// Ta'mirlash formasi uchun: mashina filialining skladi, hozirgi km, oxirgi ta'mir sanasi
// va shu mashinaga yaqinda o'rnatilgan qismlar (takroriy qism ogohlantirishi uchun).
export async function getMaintenanceFormContext(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicleId = String(req.query.vehicleId || '')
    if (!vehicleId) throw new AppError('vehicleId kerak', 400)

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        id: true, registrationNumber: true, brand: true, model: true, mileage: true, branchId: true,
        branch: { select: { name: true } },
      },
    })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) throw new AppError("Bu avtomashinaga ruxsat yo'q", 403)

    const warehouseId = await getEffectiveWarehouseId(vehicle.branchId)
    const since = new Date(Date.now() - RECENT_DAYS * 86400000)

    const [warehouse, last, recentItems] = await Promise.all([
      warehouseId ? prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, name: true } }) : null,
      prisma.maintenanceRecord.findFirst({
        where: { vehicleId, status: 'approved' },
        orderBy: { installationDate: 'desc' },
        select: { installationDate: true },
      }),
      prisma.maintenanceItem.findMany({
        where: {
          maintenance: { vehicleId, status: { in: ['approved', 'pending_approval'] }, installationDate: { gte: since } },
        },
        select: {
          sparePartId: true,
          quantityUsed: true,
          maintenance: { select: { installationDate: true, status: true } },
        },
        orderBy: { maintenance: { installationDate: 'desc' } },
      }),
    ])

    // Har qism uchun eng so'nggi o'rnatish
    const recentParts: Record<string, { date: Date; quantity: number; pending: boolean }> = {}
    for (const it of recentItems) {
      if (recentParts[it.sparePartId]) continue
      recentParts[it.sparePartId] = {
        date: it.maintenance.installationDate,
        quantity: it.quantityUsed,
        pending: it.maintenance.status === 'pending_approval',
      }
    }

    res.json(successResponse({
      vehicle: {
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        mileage: Number(vehicle.mileage) || 0,
        branchName: vehicle.branch?.name || null,
      },
      warehouse,
      lastMaintenanceDate: last?.installationDate || null,
      recentParts,
    }))
  } catch (err) { next(err) }
}
