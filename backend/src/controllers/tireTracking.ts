import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyNarrowedBranchFilter, isBranchAllowed } from '../lib/orgFilter'

// Belgilangan sanadan bugunga qadar GPSdan yurgan km (xato bo'lsa 0)
async function calcGpsKmSince(vehicleId: string, installDate: Date, currentMileage: number): Promise<number> {
  try {
    const firstLog = await prisma.gpsMileageLog.findFirst({
      where: { vehicleId, syncedAt: { gte: installDate }, skipped: false },
      orderBy: { syncedAt: 'asc' },
    })
    if (!firstLog) return 0
    return Math.max(0, currentMileage - Number(firstLog.prevMileageKm))
  } catch {
    return 0
  }
}

// Barcha mashinalar ro'yxati — shina nazorati sozlamasi bilan
export async function getVehiclesForTracking(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const requestedBranchId = req.query.branchId as string | undefined
    const branchFilter = applyNarrowedBranchFilter(filter, requestedBranchId)

    const vehicles = await prisma.vehicle.findMany({
      where: branchFilter !== undefined ? { branchId: branchFilter } : {},
      select: {
        id: true,
        registrationNumber: true,
        brand: true,
        model: true,
        year: true,
        mileage: true,
        gpsUnitName: true,
        status: true,
        branch: { select: { name: true } },
        tireTrackings: { select: { id: true, slotNumber: true } },
      },
      orderBy: { registrationNumber: 'asc' },
    })

    res.json(successResponse(vehicles))
  } catch (err) { next(err) }
}

// Bitta mashina uchun shina uyalari + GPS hisob
export async function getVehicleTracking(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params

    const filter = await getOrgFilter(req.user!)

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        id: true,
        registrationNumber: true,
        brand: true,
        model: true,
        mileage: true,
        gpsUnitName: true,
        branchId: true,
        tireTrackings: {
          orderBy: { slotNumber: 'asc' },
        },
      },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)
    if (vehicle.branchId && !isBranchAllowed(filter, vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)

    const currentMileage = Number(vehicle.mileage)

    // GPS km — har biri alohida, xato bo'lsa 0 (Promise.allSettled o'rniga)
    const slots = await Promise.all(
      vehicle.tireTrackings.map(async (slot) => {
        const usedKm = await calcGpsKmSince(vehicleId, slot.installDate, currentMileage)
        const pct = Math.min(100, Math.round((usedKm / slot.normKm) * 100))
        return {
          ...slot,
          usedKm,
          remainingKm: Math.max(0, slot.normKm - usedKm),
          pct,
          status: pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : 'ok',
        }
      })
    )

    res.json(successResponse({ ...vehicle, slots }))
  } catch (err) { next(err) }
}

// Bitta sana bo'yicha GPS km hisoblash (sozlash formasi uchun preview)
export async function getSlotGpsKm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    const { installDate } = req.query as { installDate?: string }
    if (!installDate) throw new AppError('installDate majburiy', 400)

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { mileage: true, branchId: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)

    const filter = await getOrgFilter(req.user!)
    if (vehicle.branchId && !isBranchAllowed(filter, vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)

    const currentMileage = Number(vehicle.mileage)
    const usedKm = await calcGpsKmSince(vehicleId, new Date(installDate), currentMileage)

    res.json(successResponse({ usedKm, currentMileage }))
  } catch (err) { next(err) }
}

// Barcha sozlangan shinalar — GPS km bilan (jadval ko'rinishi uchun)
export async function getAllSlots(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const requestedBranchId = req.query.branchId as string | undefined
    const branchFilter = applyNarrowedBranchFilter(filter, requestedBranchId)

    const vehicles = await prisma.vehicle.findMany({
      where: branchFilter !== undefined ? { branchId: branchFilter } : {},
      select: {
        id: true,
        registrationNumber: true,
        brand: true,
        model: true,
        mileage: true,
        gpsUnitName: true,
        branch: { select: { name: true } },
        tireTrackings: { orderBy: { slotNumber: 'asc' } },
      },
      orderBy: { registrationNumber: 'asc' },
    })

    const withTires = vehicles.filter(v => v.tireTrackings.length > 0)
    if (withTires.length === 0) return res.json(successResponse([]))

    const vehicleIds = withTires.map(v => v.id)

    // BITTA so'rovda barcha mashinalar uchun mileage log larini yuklaymiz
    const allLogs = await prisma.gpsMileageLog.findMany({
      where: { vehicleId: { in: vehicleIds }, skipped: false },
      select: { vehicleId: true, prevMileageKm: true, syncedAt: true },
      orderBy: { syncedAt: 'asc' },
    })

    // vehicleId → log[] (sana bo'yicha o'sish tartibida)
    const logsByVehicle = new Map<string, Array<{ prevMileageKm: any; syncedAt: Date }>>()
    for (const log of allLogs) {
      if (!logsByVehicle.has(log.vehicleId)) logsByVehicle.set(log.vehicleId, [])
      logsByVehicle.get(log.vehicleId)!.push(log)
    }

    const result: any[] = []

    for (const vehicle of withTires) {
      const currentMileage = Number(vehicle.mileage)
      const vehicleLogs = logsByVehicle.get(vehicle.id) ?? []

      for (const slot of vehicle.tireTrackings) {
        const installTs = new Date(slot.installDate).getTime()
        // O'rnatilgan sanadan keyingi birinchi log
        const firstLog = vehicleLogs.find(l => l.syncedAt.getTime() >= installTs)
        const usedKm = firstLog ? Math.max(0, currentMileage - Number(firstLog.prevMileageKm)) : 0
        const pct = Math.min(100, Math.round((usedKm / slot.normKm) * 100))

        result.push({
          vehicleId: vehicle.id,
          registrationNumber: vehicle.registrationNumber,
          brand: vehicle.brand,
          model: vehicle.model,
          branchName: vehicle.branch?.name ?? null,
          hasGps: !!vehicle.gpsUnitName,
          slotNumber: slot.slotNumber,
          label: slot.label,
          serialCode: slot.serialCode,
          installDate: slot.installDate,
          normKm: slot.normKm,
          notes: slot.notes,
          usedKm,
          remainingKm: Math.max(0, slot.normKm - usedKm),
          pct,
          status: pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : 'ok',
        })
      }
    }

    // Critical → warning → ok; bir xil holat ichida pct bo'yicha kamayish
    const order: Record<string, number> = { critical: 0, warning: 1, ok: 2 }
    result.sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
      return b.pct - a.pct
    })

    res.json(successResponse(result))
  } catch (err) { next(err) }
}

// Mashina uchun shina uyalarini saqlash (to'liq replace)
export async function saveVehicleTracking(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    const { slots } = req.body as {
      slots: { slotNumber: number; label?: string; serialCode?: string; installDate: string; normKm: number; notes?: string }[]
    }

    if (!slots?.length) throw new AppError('Kamida bitta shina uyasi kiriting', 400)

    const saveFilter = await getOrgFilter(req.user!)
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, branchId: true } })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)
    if (vehicle.branchId && !isBranchAllowed(saveFilter, vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)

    await prisma.$transaction(
      slots.map(slot =>
        prisma.tireTracking.upsert({
          where: { vehicleId_slotNumber: { vehicleId, slotNumber: slot.slotNumber } },
          update: {
            label: slot.label || null,
            serialCode: slot.serialCode || null,
            installDate: new Date(slot.installDate),
            normKm: Number(slot.normKm) || 50000,
            notes: slot.notes || null,
          },
          create: {
            vehicleId,
            slotNumber: slot.slotNumber,
            label: slot.label || null,
            serialCode: slot.serialCode || null,
            installDate: new Date(slot.installDate),
            normKm: Number(slot.normKm) || 50000,
            notes: slot.notes || null,
          },
        })
      )
    )

    const slotNumbers = slots.map(s => s.slotNumber)
    await prisma.tireTracking.deleteMany({
      where: { vehicleId, slotNumber: { notIn: slotNumbers } },
    })

    res.json(successResponse(null, 'Saqlandi'))
  } catch (err) { next(err) }
}
