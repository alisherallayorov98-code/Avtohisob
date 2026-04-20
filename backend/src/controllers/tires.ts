import { Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { successResponse } from '../types'
import { getSearchVariants } from '../lib/transliterate'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

const MIN_TREAD_DEPTH = 1.6
const WARN_TREAD_DEPTH = 3.0

function getCondition(treadDepth?: number | null): string {
  if (!treadDepth) return 'unknown'
  if (treadDepth >= 7) return 'excellent'
  if (treadDepth >= 5) return 'good'
  if (treadDepth >= 3) return 'fair'
  if (treadDepth >= 1.6) return 'poor'
  return 'critical'
}

function getDisplayStatus(tire: any): string {
  if (tire.status === 'installed') return 'installed'
  if (tire.status === 'returned') return 'returned'
  if (tire.status === 'written_off') return 'written_off'
  if (tire.status === 'damaged') return 'damaged'
  // in_stock — check tread/warranty
  const tread = Number(tire.currentTreadDepth)
  if (tread > 0 && tread < MIN_TREAD_DEPTH) return 'critical'
  if (tread > 0 && tread < WARN_TREAD_DEPTH) return 'warning'
  if (tire.warrantyEndDate) {
    const daysLeft = Math.floor((new Date(tire.warrantyEndDate).getTime() - Date.now()) / 86400000)
    if (daysLeft <= 30 && daysLeft > 0) return 'warranty_expiring'
  }
  return 'in_stock'
}

async function generateTireUniqueId(): Promise<string> {
  const year = new Date().getFullYear()
  // Race-safe: timestamp + random suffix instead of count+1
  const suffix = Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()
  return `TIRE-${year}-${suffix}`
}

// Tenant-check helper: verifies tire belongs to user's org.
// Legacy null-branchId tires are taken into user's branch (ownership claim).
// Returns the tire record.
async function assertTireAccess(req: AuthRequest, tireId: string): Promise<any> {
  const tire = await (prisma as any).tire.findUnique({ where: { id: tireId } })
  if (!tire) throw new AppError('Avtoshina topilmadi', 404)
  const filter = await getOrgFilter(req.user!)
  if (tire.branchId) {
    if (!isBranchAllowed(filter, tire.branchId))
      throw new AppError("Bu shinaga ruxsat yo'q", 403)
  } else if (req.user!.branchId) {
    // Legacy null branchId: take ownership
    await (prisma as any).tire.update({
      where: { id: tireId },
      data: { branchId: req.user!.branchId },
    })
    tire.branchId = req.user!.branchId
  }
  return tire
}

const TIRE_INCLUDE = {
  vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true } },
  supplier: { select: { id: true, name: true } },
  driver: { select: { id: true, fullName: true } },
}

export async function listTires(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', status, vehicleId, branchId: qBranchId, search } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    const and: any[] = []
    if (vehicleId) and.push({ vehicleId })
    // Force branch filter from org scope; ignore query branchId for non-super_admin.
    // Legacy null branchId shinalari ham ko'rinadi (eski yozuvlar)
    if (bv !== undefined) {
      and.push({ OR: [{ branchId: bv }, { branchId: null }] })
    } else if (qBranchId) {
      and.push({ branchId: qBranchId })
    }
    if (status) {
      // Map display statuses to DB statuses
      if (status === 'in_stock') and.push({ status: 'in_stock' })
      else if (status === 'installed') and.push({ status: 'installed' })
      else if (status === 'returned') and.push({ status: 'returned' })
      else if (status === 'written_off') and.push({ status: 'written_off' })
      else and.push({ status })
    }
    if (search) {
      const variants = getSearchVariants(search)
      and.push({
        OR: variants.flatMap(v => [
          { brand: { contains: v, mode: 'insensitive' } },
          { model: { contains: v, mode: 'insensitive' } },
          { serialCode: { contains: v, mode: 'insensitive' } },
          { serialNumber: { contains: v, mode: 'insensitive' } },
          { uniqueId: { contains: v, mode: 'insensitive' } },
          { size: { contains: v, mode: 'insensitive' } },
        ]),
      })
    }
    const where: any = and.length ? { AND: and } : {}

    const [total, items] = await Promise.all([
      (prisma as any).tire.count({ where }),
      (prisma as any).tire.findMany({
        where, skip, take: parseInt(limit),
        include: { ...TIRE_INCLUDE, tireMaintenances: { orderBy: { date: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
      })
    ])

    const enriched = items.map((t: any) => ({ ...t, displayStatus: getDisplayStatus(t) }))
    res.json({ data: enriched, meta: { total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function getTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tire = await (prisma as any).tire.findUnique({
      where: { id: req.params.id },
      include: {
        ...TIRE_INCLUDE,
        tireMaintenances: { orderBy: { date: 'desc' } },
        tireEvents: { orderBy: { createdAt: 'desc' } },
        tireDeductions: { orderBy: { createdAt: 'desc' } },
      }
    })
    if (!tire) throw new AppError('Topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (tire.branchId) {
      if (!isBranchAllowed(filter, tire.branchId))
        throw new AppError("Bu shinaga kirish huquqingiz yo'q", 403)
    } else if (req.user!.branchId) {
      await (prisma as any).tire.update({ where: { id: tire.id }, data: { branchId: req.user!.branchId } })
      tire.branchId = req.user!.branchId
    }

    const remainingTread = Number(tire.currentTreadDepth || 0) - MIN_TREAD_DEPTH
    // wearRate requires totalMileage > 0 to be meaningful; avoid division by zero / misleading values
    const wearRate = (tire.initialTreadDepth && tire.currentTreadDepth && Number(tire.totalMileage) > 0)
      ? (Number(tire.initialTreadDepth) - Number(tire.currentTreadDepth)) / Number(tire.totalMileage) * 5000
      : null
    const estimatedRemainingKm = wearRate && wearRate > 0 ? Math.round((remainingTread / wearRate) * 5000) : null

    res.json({ data: { ...tire, displayStatus: getDisplayStatus(tire), estimatedRemainingKm, wearRate } })
  } catch (err) { next(err) }
}

export async function createTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const {
      serialCode, serialNumber, brand, model, size, type, dotCode,
      purchaseDate, purchasePrice, supplierId,
      initialTreadDepth, warrantyEndDate, notes, branchId,
      standardMileageKm,
    } = req.body

    if (!serialCode?.trim()) throw new AppError('Zavod seriya kodi (serialCode) majburiy', 400)
    if (branchId) {
      const filter = await getOrgFilter(req.user!)
      if (!isBranchAllowed(filter, branchId))
        throw new AppError("Bu filialga shina qo'shish huquqingiz yo'q", 403)
    }

    // Check uniqueness
    const existing = await (prisma as any).tire.findUnique({ where: { serialCode: serialCode.trim() } })
    if (existing) throw new AppError(`Bu serial kod allaqachon mavjud: ${serialCode}`, 409)

    const uniqueId = await generateTireUniqueId()
    const condition = getCondition(initialTreadDepth ? parseFloat(initialTreadDepth) : null)

    const tire = await (prisma as any).tire.create({
      data: {
        uniqueId,
        serialCode: serialCode.trim(),
        serialNumber: serialNumber || null,
        brand, model, size, type,
        dotCode: dotCode || null,
        purchaseDate: new Date(purchaseDate),
        purchasePrice: parseFloat(purchasePrice),
        supplierId: supplierId || null,
        status: 'in_stock',
        initialTreadDepth: initialTreadDepth ? parseFloat(initialTreadDepth) : null,
        currentTreadDepth: initialTreadDepth ? parseFloat(initialTreadDepth) : null,
        standardMileageKm: standardMileageKm ? parseInt(standardMileageKm) : 40000,
        warrantyEndDate: warrantyEndDate ? new Date(warrantyEndDate) : null,
        notes: notes || null,
        branchId: branchId || null,
        condition,
      },
      include: TIRE_INCLUDE,
    })

    // Log event
    await (prisma as any).tireEvent.create({
      data: { tireId: tire.id, eventType: 'purchased', notes: `Sotib olindi: ${brand} ${model} ${size}`, createdById: req.user!.id }
    })

    // Create warranty record if warrantyEndDate
    if (warrantyEndDate) {
      await (prisma as any).warranty.create({
        data: {
          partType: 'tire', partId: tire.id,
          partName: `${brand} ${model} ${size}`,
          startDate: new Date(purchaseDate),
          endDate: new Date(warrantyEndDate),
          status: 'active',
        }
      })
    }

    res.status(201).json(successResponse(tire, 'Avtoshina qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const allowed = ['currentTreadDepth', 'position', 'notes', 'warrantyEndDate', 'standardMileageKm', 'branchId', 'serialNumber', 'dotCode']
    const data: any = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'currentTreadDepth') {
          data.currentTreadDepth = parseFloat(req.body[key])
          data.condition = getCondition(parseFloat(req.body[key]))
        } else if (key === 'standardMileageKm') {
          data.standardMileageKm = parseInt(req.body[key])
        } else if (key === 'warrantyEndDate') {
          data.warrantyEndDate = req.body[key] ? new Date(req.body[key]) : null
        } else {
          data[key] = req.body[key] || null
        }
      }
    }
    await assertTireAccess(req, id)
    const updated = await (prisma as any).tire.update({ where: { id }, data, include: TIRE_INCLUDE })
    res.json(successResponse(updated))
  } catch (err) { next(err) }
}

// O'rnatish: ombordan avtomobilga
export async function installTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { vehicleId, position, driverId, installedMileageKm, installationDate, notes } = req.body

    const tire = await assertTireAccess(req, id)
    if (tire.status === 'installed') throw new AppError("Avtoshina allaqachon o'rnatilgan", 400)
    if (tire.status === 'written_off') throw new AppError("Hisobdan chiqarilgan avtoshina o'rnatilmaydi", 400)
    if (tire.status === 'damaged') throw new AppError("Shikastlangan avtoshina o'rnatilmaydi", 400)

    const vehicle = await (prisma as any).vehicle.findUnique({ where: { id: vehicleId }, select: { mileage: true } })
    const mileage = installedMileageKm ?? (vehicle ? Number(vehicle.mileage) : 0)

    await (prisma as any).tire.update({
      where: { id },
      data: {
        status: 'installed',
        vehicleId,
        position: position || null,
        driverId: driverId || null,
        installedMileageKm: mileage,
        installationDate: installationDate ? new Date(installationDate) : new Date(),
        removedDate: null,
        removedMileageKm: null,
        actualMileageUsed: null,
      }
    })

    await (prisma as any).tireEvent.create({
      data: {
        tireId: id, eventType: 'installed',
        vehicleId, driverId: driverId || null,
        mileageAtEvent: mileage, position: position || null,
        notes: notes || null, createdById: req.user!.id,
      }
    })

    const updated = await (prisma as any).tire.findUnique({ where: { id }, include: TIRE_INCLUDE })
    res.json(successResponse(updated, 'Avtoshina o\'rnatildi'))
  } catch (err) { next(err) }
}

// Olish: avtomobildan chiqarib olish
export async function removeTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { removedMileageKm, notes, returnedBy } = req.body

    const tire = await assertTireAccess(req, id)
    if (tire.status !== 'installed') throw new AppError("Avtoshina o'rnatilmagan", 400)

    const mileage = removedMileageKm ? parseInt(removedMileageKm) : 0
    const actualKm = tire.installedMileageKm ? mileage - tire.installedMileageKm : mileage

    await (prisma as any).tire.update({
      where: { id },
      data: {
        status: 'returned',
        removedDate: new Date(),
        removedMileageKm: mileage,
        actualMileageUsed: actualKm > 0 ? actualKm : 0,
        totalMileage: Number(tire.totalMileage) + (actualKm > 0 ? actualKm : 0),
        vehicleId: null,
        position: null,
      }
    })

    await (prisma as any).tireEvent.create({
      data: {
        tireId: id, eventType: 'removed',
        vehicleId: tire.vehicleId,
        driverId: tire.driverId,
        mileageAtEvent: mileage,
        notes: notes || null,
        createdById: req.user!.id,
      }
    })

    const updated = await (prisma as any).tire.findUnique({ where: { id }, include: TIRE_INCLUDE })
    res.json(successResponse({ tire: updated, actualMileageUsed: actualKm > 0 ? actualKm : 0 }, 'Avtoshina olib olindi'))
  } catch (err) { next(err) }
}

// Qaytarish tekshiruvi: serial kod bilan solishtirish
export async function verifyReturn(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { serialCode, dotCode } = req.body
    if (!serialCode) throw new AppError('Serial kod kiritilmagan', 400)

    const tire = await (prisma as any).tire.findUnique({
      where: { serialCode: serialCode.trim() },
      include: { ...TIRE_INCLUDE, tireEvents: { orderBy: { createdAt: 'desc' }, take: 5 } }
    })

    if (!tire) throw new AppError(`Serial kod topilmadi: ${serialCode}`, 404)

    const filter = await getOrgFilter(req.user!)
    if (tire.branchId) {
      if (!isBranchAllowed(filter, tire.branchId))
        throw new AppError("Bu shinaga ruxsat yo'q", 403)
    } else if (req.user!.branchId) {
      await (prisma as any).tire.update({ where: { id: tire.id }, data: { branchId: req.user!.branchId } })
    }

    const dotMatch = !dotCode || !tire.dotCode || tire.dotCode === dotCode.trim()
    const isCorrectTire = dotMatch

    res.json(successResponse({
      tire: { ...tire, displayStatus: getDisplayStatus(tire) },
      verified: isCorrectTire,
      dotMatch,
      warning: !isCorrectTire ? 'DOT kod mos kelmaydi — boshqa avtoshina bo\'lishi mumkin!' : null,
    }, isCorrectTire ? 'Avtoshina tasdiqlandi' : 'Diqqat: mos kelmagan ma\'lumotlar'))
  } catch (err) { next(err) }
}

// Hisobdan chiqarish + deduction hisoblash
export async function writeOffTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { reason, disposalMethod, notes, overrideActualKm } = req.body

    const tire = await assertTireAccess(req, id)
    if (tire.status === 'written_off') throw new AppError('Allaqachon hisobdan chiqarilgan', 400)

    const standardKm = tire.standardMileageKm || 40000
    const actualKm = overrideActualKm
      ? parseInt(overrideActualKm)
      : (tire.actualMileageUsed ? Number(tire.actualMileageUsed) : Number(tire.totalMileage))

    const remainingKm = Math.max(0, standardKm - actualKm)
    const price = Number(tire.purchasePrice)
    const deductionPerKm = price / standardKm
    const deductionAmount = remainingKm * deductionPerKm

    await (prisma as any).tire.update({
      where: { id },
      data: {
        status: 'written_off',
        retiredAt: new Date(),
        disposalMethod: disposalMethod || null,
        notes: notes || tire.notes,
        vehicleId: null,
        position: null,
      }
    })

    let deduction = null
    if (remainingKm > 0 && tire.driverId) {
      deduction = await (prisma as any).tireDeduction.create({
        data: {
          tireId: id,
          driverId: tire.driverId,
          vehicleId: tire.vehicleId,
          standardMileageKm: standardKm,
          actualMileageKm: actualKm,
          remainingMileageKm: remainingKm,
          purchasePrice: price,
          deductionPerKm,
          deductionAmount,
          reason: reason || null,
          isSettled: false,
          notes: notes || null,
        }
      })
    }

    await (prisma as any).tireEvent.create({
      data: {
        tireId: id, eventType: 'written_off',
        vehicleId: tire.vehicleId,
        driverId: tire.driverId,
        mileageAtEvent: actualKm,
        notes: `${reason || 'Hisobdan chiqarildi'}. Norma: ${standardKm} km, haqiqiy: ${actualKm} km, ushlab qolish: ${Math.round(deductionAmount).toLocaleString()} UZS`,
        createdById: req.user!.id,
      }
    })

    res.json(successResponse({
      standardKm,
      actualKm,
      remainingKm,
      deductionAmount: Math.round(deductionAmount),
      deductionPerKm: Math.round(deductionPerKm),
      deduction,
      hasDeduction: remainingKm > 0,
    }, 'Avtoshina hisobdan chiqarildi'))
  } catch (err) { next(err) }
}

// Ushlab qolishlar ro'yxati
export async function listDeductions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', isSettled, driverId } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const where: any = {}
    if (isSettled !== undefined) where.isSettled = isSettled === 'true'
    if (driverId) where.driverId = driverId
    // Org isolation: deductions are scoped via the related tire's branchId
    if (bv !== undefined) where.tire = { OR: [{ branchId: bv }, { branchId: null }] }

    const [total, items] = await Promise.all([
      (prisma as any).tireDeduction.count({ where }),
      (prisma as any).tireDeduction.findMany({
        where, skip, take: parseInt(limit),
        include: {
          tire: { select: { serialCode: true, brand: true, model: true, size: true, uniqueId: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    ])

    // Attach driver info manually
    const driverIds = [...new Set(items.map((i: any) => i.driverId).filter(Boolean))]
    const drivers = driverIds.length
      ? await (prisma as any).user.findMany({ where: { id: { in: driverIds } }, select: { id: true, fullName: true } })
      : []
    const driverMap: Record<string, string> = {}
    drivers.forEach((d: any) => { driverMap[d.id] = d.fullName })

    const enriched = items.map((item: any) => ({
      ...item,
      driverName: item.driverId ? driverMap[item.driverId] : null,
    }))

    res.json({ data: enriched, meta: { total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

// Ushlab qolishni to'landi deb belgilash
export async function settleDeduction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { settledNotes } = req.body

    const existing = await (prisma as any).tireDeduction.findUnique({
      where: { id },
      include: { tire: { select: { id: true, branchId: true } } },
    })
    if (!existing) throw new AppError('Ushlab qolish topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (existing.tire?.branchId) {
      if (!isBranchAllowed(filter, existing.tire.branchId))
        throw new AppError("Ruxsat yo'q", 403)
    } else if (existing.tire && req.user!.branchId) {
      await (prisma as any).tire.update({ where: { id: existing.tire.id }, data: { branchId: req.user!.branchId } })
    }

    const updated = await (prisma as any).tireDeduction.update({
      where: { id },
      data: { isSettled: true, settledAt: new Date(), settledNotes: settledNotes || null }
    })

    await (prisma as any).tireEvent.create({
      data: {
        tireId: updated.tireId, eventType: 'deduction_applied',
        driverId: updated.driverId,
        notes: `Ushlab qolish to'landi: ${Number(updated.deductionAmount).toLocaleString()} UZS`,
        createdById: req.user!.id,
      }
    })

    res.json(successResponse(updated, 'Ushlab qolish to\'landi deb belgilandi'))
  } catch (err) { next(err) }
}

// Voqealar tarixi
export async function getTireEvents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await assertTireAccess(req, req.params.id)
    const events = await (prisma as any).tireEvent.findMany({
      where: { tireId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    res.json(successResponse(events))
  } catch (err) { next(err) }
}

export async function addTireMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { tireId } = req.params
    const { type, date, position, cost, notes } = req.body

    await assertTireAccess(req, tireId)

    const maintenance = await (prisma as any).tireMaintenance.create({
      data: {
        tireId, type,
        date: new Date(date),
        position: position || null,
        cost: parseFloat(cost || '0'),
        notes: notes || null,
      }
    })

    if (type === 'rotation' && position) {
      await (prisma as any).tire.update({ where: { id: tireId }, data: { position } })
    }

    res.status(201).json(successResponse(maintenance))
  } catch (err) { next(err) }
}

export async function getTireStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const where: any = bv !== undefined ? { branchId: bv } : {}

    const [total, inStock, installed, returned, writtenOff, pendingDeductions] = await Promise.all([
      (prisma as any).tire.count({ where }),
      (prisma as any).tire.count({ where: { ...where, status: 'in_stock' } }),
      (prisma as any).tire.count({ where: { ...where, status: 'installed' } }),
      (prisma as any).tire.count({ where: { ...where, status: 'returned' } }),
      (prisma as any).tire.count({ where: { ...where, status: 'written_off' } }),
      (prisma as any).tireDeduction.count({ where: { isSettled: false } }),
    ])

    const urgentTires = await (prisma as any).tire.findMany({
      where: { ...where, status: { in: ['in_stock', 'installed'] }, currentTreadDepth: { lt: 3, gt: 0 } },
      include: { vehicle: { select: { registrationNumber: true, brand: true, model: true } } },
      orderBy: { currentTreadDepth: 'asc' },
      take: 10,
    })

    const pendingDeductionsTotal = await (prisma as any).tireDeduction.aggregate({
      where: { isSettled: false },
      _sum: { deductionAmount: true }
    })

    res.json(successResponse({
      total, inStock, installed, returned, writtenOff,
      pendingDeductions,
      pendingDeductionsTotal: Number(pendingDeductionsTotal._sum.deductionAmount || 0),
      urgentTires,
    }))
  } catch (err) { next(err) }
}

// Avtomobil bo'yicha barcha shinalar (joriy + tarix)
export async function getTiresByVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId))
      throw new AppError("Bu avtomobilga ruxsat yo'q", 403)

    // Current tires on this vehicle
    const current = await (prisma as any).tire.findMany({
      where: { vehicleId, status: 'installed' },
      include: { driver: { select: { id: true, fullName: true } }, supplier: { select: { name: true } } },
      orderBy: { installationDate: 'desc' },
    })

    // All historical tires (events tied to this vehicleId)
    const events = await (prisma as any).tireEvent.findMany({
      where: { vehicleId },
      include: { tire: { select: { id: true, serialCode: true, uniqueId: true, brand: true, model: true, size: true, type: true, purchasePrice: true, standardMileageKm: true } } },
      orderBy: { createdAt: 'desc' },
    })

    // Unique tires that have been on this vehicle (from events)
    const tireIdsSeen = new Set<string>()
    const historicalTires: any[] = []
    for (const ev of events) {
      if (!ev.tire) continue
      if (!tireIdsSeen.has(ev.tire.id)) {
        tireIdsSeen.add(ev.tire.id)
        // Get full tire with deductions for this vehicle
        const tire = await (prisma as any).tire.findUnique({
          where: { id: ev.tire.id },
          include: {
            driver: { select: { id: true, fullName: true } },
            supplier: { select: { name: true } },
            tireDeductions: { where: { vehicleId }, orderBy: { createdAt: 'desc' }, take: 1 },
            tireEvents: { where: { vehicleId }, orderBy: { createdAt: 'asc' } },
          }
        })
        if (tire) historicalTires.push(tire)
      }
    }

    // Summary stats
    const totalTires = historicalTires.length
    const totalKm = historicalTires.reduce((s: number, t: any) => s + (Number(t.actualMileageUsed) || 0), 0)
    const totalDeductionAmount = historicalTires.reduce((s: number, t: any) => {
      return s + (t.tireDeductions?.[0] ? Number(t.tireDeductions[0].deductionAmount) : 0)
    }, 0)

    res.json(successResponse({
      current,
      history: historicalTires,
      summary: { totalTires, totalKm, totalDeductionAmount },
    }))
  } catch (err) { next(err) }
}

// Legacy: retireTire (eski mos kelish uchun)
export async function retireTire(req: AuthRequest, res: Response, next: NextFunction) {
  return writeOffTire(req, res, next)
}

// Legacy: replaceTire
export async function replaceTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    await assertTireAccess(req, id)
    await (prisma as any).tire.update({
      where: { id },
      data: { status: 'written_off', retiredAt: new Date(), vehicleId: null, position: null }
    })
    res.json(successResponse({ replacedTireId: id }))
  } catch (err) { next(err) }
}
