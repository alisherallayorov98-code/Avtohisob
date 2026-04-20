import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { getSearchVariants } from '../lib/transliterate'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

const VEHICLE_SELECT = { id: true, registrationNumber: true, brand: true, model: true, mileage: true, fuelType: true }
const DRIVER_SELECT  = { id: true, fullName: true, role: true }
const BRANCH_SELECT  = { id: true, name: true, location: true }

/** Auto-generate waybill number: WB-2026-0042 */
async function nextNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const last = await prisma.waybill.findFirst({
    where: { number: { startsWith: `WB-${year}-` } },
    orderBy: { number: 'desc' },
  })
  const seq = last ? parseInt(last.number.split('-')[2]) + 1 : 1
  return `WB-${year}-${String(seq).padStart(4, '0')}`
}

/** GET /waybills */
export async function listWaybills(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    const { page = 1, limit = 20, status, vehicleId, driverId, from, to, branchId, search } = req.query

    const p  = Math.max(1, Number(page))
    const lim = Math.min(100, Number(limit))
    const skip = (p - 1) * lim

    const where: any = {}

    // Branch scoping — use orgFilter to enforce multi-tenancy
    const filter = await getOrgFilter(user)
    const bv = applyBranchFilter(filter)
    if (bv !== undefined) {
      where.branchId = bv
    } else if (branchId) {
      // super_admin can optionally filter by branchId
      where.branchId = branchId
    }

    if (status) where.status = status
    if (vehicleId) where.vehicleId = vehicleId
    if (driverId) where.driverId = driverId
    if (search) {
      const variants = getSearchVariants(search as string)
      where.OR = variants.flatMap(v => [
        { number: { contains: v, mode: 'insensitive' } },
        { destination: { contains: v, mode: 'insensitive' } },
        { vehicle: { registrationNumber: { contains: v, mode: 'insensitive' } } },
        { driver: { fullName: { contains: v, mode: 'insensitive' } } },
      ])
    }
    if (from || to) {
      where.plannedDeparture = {}
      if (from) where.plannedDeparture.gte = new Date(from as string)
      if (to)   where.plannedDeparture.lte = new Date(to as string)
    }

    const [data, total] = await Promise.all([
      prisma.waybill.findMany({
        where, skip, take: lim,
        orderBy: { plannedDeparture: 'desc' },
        include: {
          vehicle: { select: VEHICLE_SELECT },
          driver:  { select: DRIVER_SELECT  },
          branch:  { select: BRANCH_SELECT  },
        },
      }),
      prisma.waybill.count({ where }),
    ])

    res.json({ data, meta: { total, page: p, limit: lim, totalPages: Math.ceil(total / lim) } })
  } catch (err) { next(err) }
}

/** GET /waybills/:id */
export async function getWaybill(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    const { id } = req.params
    const waybill = await prisma.waybill.findUnique({
      where: { id },
      include: {
        vehicle:   { select: VEHICLE_SELECT },
        driver:    { select: DRIVER_SELECT  },
        branch:    { select: BRANCH_SELECT  },
        createdBy: { select: DRIVER_SELECT  },
      },
    })
    if (!waybill) return res.status(404).json({ error: 'Yo\'l varag\'i topilmadi' })
    const filter = await getOrgFilter(user)
    if (!isBranchAllowed(filter, waybill.branchId)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' })
    }
    res.json(waybill)
  } catch (err) { next(err) }
}

/** POST /waybills */
export async function createWaybill(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    const {
      vehicleId, driverId, branchId,
      purpose, destination, routeDescription,
      plannedDeparture, plannedReturn,
      fuelAtDeparture = 0, fuelIssued = 0,
      mechanicName, dispatcherName, notes,
    } = req.body

    if (!vehicleId || !driverId || !purpose || !destination || !plannedDeparture) {
      return res.status(400).json({ error: 'vehicleId, driverId, purpose, destination, plannedDeparture majburiy' })
    }
    if (plannedReturn && new Date(plannedReturn) <= new Date(plannedDeparture)) {
      return res.status(400).json({ error: 'Rejalashtirilgan qaytish vaqti jo\'nash vaqtidan keyin bo\'lishi kerak' })
    }

    let useBranch = branchId || user.branchId
    // For admins with no branchId, fall back to the vehicle's branch
    if (!useBranch && vehicleId) {
      const veh = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
      useBranch = veh?.branchId ?? null
    }
    if (!useBranch) return res.status(400).json({ error: 'Filial aniqlanmadi' })

    const createFilter = await getOrgFilter(user)

    // Verify vehicle belongs to user's org
    const veh = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
    if (!veh) return res.status(404).json({ error: 'Avtomobil topilmadi' })
    if (!isBranchAllowed(createFilter, veh.branchId)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q: bu avtomobil sizning tashkilotingizga tegishli emas' })
    }

    // Verify driver belongs to user's org (driver branchId may be null for legacy users)
    const driver = await prisma.user.findUnique({ where: { id: driverId }, select: { branchId: true } })
    if (!driver) return res.status(404).json({ error: 'Haydovchi topilmadi' })
    if (driver.branchId && !isBranchAllowed(createFilter, driver.branchId)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q: bu haydovchi sizning tashkilotingizga tegishli emas' })
    }

    // Race-safe number allocation: retry on unique-conflict (P2002 on number)
    let waybill: any = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const number = await nextNumber()
        waybill = await prisma.waybill.create({
          data: {
            number,
            branchId: useBranch,
            vehicleId,
            driverId,
            status: 'draft',
            purpose,
            destination,
            routeDescription: routeDescription || null,
            plannedDeparture: new Date(plannedDeparture),
            plannedReturn: plannedReturn ? new Date(plannedReturn) : null,
            fuelAtDeparture,
            fuelIssued,
            mechanicName: mechanicName || null,
            dispatcherName: dispatcherName || null,
            notes: notes || null,
            createdById: user.id,
          },
          include: {
            vehicle: { select: VEHICLE_SELECT },
            driver:  { select: DRIVER_SELECT  },
            branch:  { select: BRANCH_SELECT  },
          },
        })
        break
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 4) continue
        throw err
      }
    }

    res.status(201).json(waybill)
  } catch (err) { next(err) }
}

/** PATCH /waybills/:id */
export async function updateWaybill(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    const { id } = req.params
    const waybill = await prisma.waybill.findUnique({ where: { id } })
    if (!waybill) return res.status(404).json({ error: 'Yo\'l varag\'i topilmadi' })
    const updateFilter = await getOrgFilter(user)
    if (!isBranchAllowed(updateFilter, waybill.branchId)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' })
    }
    if (waybill.status === 'completed' || waybill.status === 'cancelled') {
      return res.status(400).json({ error: 'Tugallangan yoki bekor qilingan yo\'l varag\'ini tahrirlash mumkin emas' })
    }

    const {
      purpose, destination, routeDescription,
      plannedDeparture, plannedReturn,
      departureOdometer, returnOdometer,
      fuelAtDeparture, fuelIssued, fuelAtReturn,
      mechanicName, mechanicApproved, dispatcherName, notes,
    } = req.body

    // Auto-calculate distances and fuel consumed
    const depOdo = departureOdometer ?? waybill.departureOdometer
    const retOdo = returnOdometer   ?? waybill.returnOdometer
    const distanceTraveled = (depOdo !== null && retOdo !== null) ? Math.max(0, retOdo - depOdo) : waybill.distanceTraveled

    const toNum = (v: any, fallback: any) => { const n = Number(v); return isNaN(n) ? Number(fallback) || 0 : n }
    const fuelDep = fuelAtDeparture !== undefined ? toNum(fuelAtDeparture, waybill.fuelAtDeparture) : Number(waybill.fuelAtDeparture) || 0
    const fuelIss = fuelIssued      !== undefined ? toNum(fuelIssued, waybill.fuelIssued)           : Number(waybill.fuelIssued) || 0
    const fuelRet = fuelAtReturn    !== undefined ? toNum(fuelAtReturn, waybill.fuelAtReturn)        : Number(waybill.fuelAtReturn) || 0
    const fuelConsumed = Math.max(0, fuelDep + fuelIss - fuelRet)

    const updated = await prisma.waybill.update({
      where: { id },
      data: {
        purpose:          purpose          ?? waybill.purpose,
        destination:      destination      ?? waybill.destination,
        routeDescription: routeDescription ?? waybill.routeDescription,
        plannedDeparture: plannedDeparture ? new Date(plannedDeparture) : waybill.plannedDeparture,
        plannedReturn:    plannedReturn    ? new Date(plannedReturn)    : waybill.plannedReturn,
        departureOdometer: depOdo,
        returnOdometer:    retOdo,
        distanceTraveled,
        fuelAtDeparture: fuelDep,
        fuelIssued:      fuelIss,
        fuelAtReturn:    fuelRet,
        fuelConsumed:    Math.max(0, fuelConsumed),
        mechanicName:     mechanicName     ?? waybill.mechanicName,
        mechanicApproved: mechanicApproved ?? waybill.mechanicApproved,
        dispatcherName:   dispatcherName   ?? waybill.dispatcherName,
        notes:            notes            ?? waybill.notes,
      },
      include: {
        vehicle: { select: VEHICLE_SELECT },
        driver:  { select: DRIVER_SELECT  },
        branch:  { select: BRANCH_SELECT  },
      },
    })

    res.json(updated)
  } catch (err) { next(err) }
}

/** POST /waybills/:id/activate — jo'nash boshlandi */
export async function activateWaybill(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    const { id } = req.params
    const { departureOdometer, actualDeparture } = req.body

    const waybill = await prisma.waybill.findUnique({ where: { id } })
    if (!waybill) return res.status(404).json({ error: 'Yo\'l varag\'i topilmadi' })
    const activateFilter = await getOrgFilter(user)
    if (!isBranchAllowed(activateFilter, waybill.branchId)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' })
    }
    if (waybill.status !== 'draft') return res.status(400).json({ error: 'Faqat draft statusdagi yo\'l varag\'ini aktivlashtirish mumkin' })

    const vehicle = await prisma.vehicle.findUnique({ where: { id: waybill.vehicleId }, select: { status: true } })
    if (vehicle?.status === 'inactive') return res.status(400).json({ error: 'Nofaol avtomobil uchun yo\'l varaqasi aktivlashtirilmaydi' })

    const updated = await prisma.waybill.update({
      where: { id },
      data: {
        status: 'active',
        actualDeparture: actualDeparture ? new Date(actualDeparture) : new Date(),
        departureOdometer: departureOdometer ?? null,
      },
      include: {
        vehicle: { select: VEHICLE_SELECT },
        driver:  { select: DRIVER_SELECT  },
      },
    })

    res.json(updated)
  } catch (err) { next(err) }
}

/** POST /waybills/:id/complete — qaytish */
export async function completeWaybill(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    const { id } = req.params
    const { returnOdometer, fuelAtReturn, actualReturn, notes } = req.body

    const waybill = await prisma.waybill.findUnique({
      where: { id },
      include: { vehicle: true },
    })
    if (!waybill) return res.status(404).json({ error: 'Yo\'l varag\'i topilmadi' })
    const completeFilter = await getOrgFilter(user)
    if (!isBranchAllowed(completeFilter, waybill.branchId)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' })
    }
    if (waybill.status !== 'active') return res.status(400).json({ error: 'Faqat aktiv yo\'l varag\'ini yakunlash mumkin' })

    const retOdo = returnOdometer ?? null
    if (retOdo !== null && waybill.departureOdometer !== null && Number(retOdo) < Number(waybill.departureOdometer)) {
      return res.status(400).json({ error: 'Qaytish odometri jo\'nash odometridan kam bo\'lishi mumkin emas' })
    }
    const distanceTraveled = (waybill.departureOdometer !== null && retOdo !== null)
      ? Math.max(0, retOdo - waybill.departureOdometer)
      : waybill.distanceTraveled

    const fuelRet = fuelAtReturn !== undefined ? Number(fuelAtReturn) : Number(waybill.fuelAtReturn)
    const maxFuel = Number(waybill.fuelAtDeparture) + Number(waybill.fuelIssued)
    if (fuelRet > maxFuel) {
      return res.status(400).json({ error: `Qaytigidagi yoqilg'i (${fuelRet}L) jo'nashdagi (${Number(waybill.fuelAtDeparture)}L) + berilgan (${Number(waybill.fuelIssued)}L) dan ko'p bo'lishi mumkin emas` })
    }
    const fuelConsumed = maxFuel - fuelRet

    // Atomik: waybill + vehicle.mileage bir transactionda
    const shouldBumpMileage = retOdo !== null && Number(waybill.vehicle.mileage) < Number(retOdo)
    const [updated] = await prisma.$transaction([
      prisma.waybill.update({
        where: { id },
        data: {
          status: 'completed',
          actualReturn: actualReturn ? new Date(actualReturn) : new Date(),
          returnOdometer: retOdo,
          distanceTraveled,
          fuelAtReturn: fuelRet,
          fuelConsumed,
          notes: notes ?? waybill.notes,
        },
        include: {
          vehicle: { select: VEHICLE_SELECT },
          driver:  { select: DRIVER_SELECT  },
          branch:  { select: BRANCH_SELECT  },
        },
      }),
      ...(shouldBumpMileage
        ? [prisma.vehicle.update({ where: { id: waybill.vehicleId }, data: { mileage: Number(retOdo) } })]
        : []),
    ])

    res.json(updated)
  } catch (err) { next(err) }
}

/** POST /waybills/:id/cancel */
export async function cancelWaybill(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    const { id } = req.params
    const waybill = await prisma.waybill.findUnique({ where: { id } })
    if (!waybill) return res.status(404).json({ error: 'Yo\'l varag\'i topilmadi' })
    const cancelFilter = await getOrgFilter(user)
    if (!isBranchAllowed(cancelFilter, waybill.branchId)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' })
    }
    if (waybill.status === 'completed') return res.status(400).json({ error: 'Tugallangan yo\'l varag\'ini bekor qilib bo\'lmaydi' })

    const updated = await prisma.waybill.update({
      where: { id },
      data: { status: 'cancelled' },
    })
    res.json(updated)
  } catch (err) { next(err) }
}

/** DELETE /waybills/:id */
export async function deleteWaybill(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    const { id } = req.params
    const waybill = await prisma.waybill.findUnique({ where: { id } })
    if (!waybill) return res.status(404).json({ error: 'Yo\'l varag\'i topilmadi' })
    const deleteFilter = await getOrgFilter(user)
    if (!isBranchAllowed(deleteFilter, waybill.branchId)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' })
    }
    if (waybill.status === 'active') return res.status(400).json({ error: 'Aktiv yo\'l varag\'ini o\'chirib bo\'lmaydi' })

    await prisma.waybill.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) { next(err) }
}
