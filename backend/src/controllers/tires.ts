import { Response, NextFunction } from 'express'
import { AuthRequest } from '../middleware/auth'
import { prisma } from '../lib/prisma'

const MIN_TREAD_DEPTH = 1.6  // mm legal minimum
const WARN_TREAD_DEPTH = 3.0 // mm warning threshold
const MAX_TIRE_AGE_YEARS = 6

function getCondition(treadDepth?: number | null): string {
  if (!treadDepth) return 'unknown'
  if (treadDepth >= 7) return 'excellent'
  if (treadDepth >= 5) return 'good'
  if (treadDepth >= 3) return 'fair'
  if (treadDepth >= 1.6) return 'poor'
  return 'critical'
}

function getStatus(tire: any): string {
  if (tire.status !== 'active') return tire.status
  const tread = Number(tire.currentTreadDepth)
  if (tread > 0 && tread < MIN_TREAD_DEPTH) return 'critical'
  if (tread > 0 && tread < WARN_TREAD_DEPTH) return 'warning'
  if (tire.warrantyEndDate) {
    const daysLeft = Math.floor((new Date(tire.warrantyEndDate).getTime() - Date.now()) / 86400000)
    if (daysLeft <= 30 && daysLeft > 0) return 'warranty_expiring'
  }
  return 'active'
}

// Generate unique tire ID
async function generateTireUniqueId(): Promise<string> {
  const year = new Date().getFullYear()
  const count = await (prisma as any).tire.count()
  return `TIRE-${year}-${String(count + 1).padStart(3, '0')}`
}

export async function listTires(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', status, vehicleId, branchId, search } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const where: any = {}
    if (status) where.status = status
    if (vehicleId) where.vehicleId = vehicleId
    if (branchId) where.branchId = branchId
    if (search) {
      where.OR = [
        { brand: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { uniqueId: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { size: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [total, items] = await Promise.all([
      (prisma as any).tire.count({ where }),
      (prisma as any).tire.findMany({
        where, skip, take: parseInt(limit),
        include: {
          vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
          supplier: { select: { id: true, name: true } },
          tireMaintenances: { orderBy: { date: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      })
    ])

    // Attach computed status
    const enriched = items.map((t: any) => ({ ...t, computedStatus: getStatus(t) }))

    res.json({ data: enriched, meta: { total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function getTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tire = await (prisma as any).tire.findUnique({
      where: { id: req.params.id },
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true } },
        supplier: { select: { id: true, name: true, phone: true } },
        tireMaintenances: { orderBy: { date: 'desc' } },
      }
    })
    if (!tire) return res.status(404).json({ error: 'Topilmadi' })

    const remainingTread = Number(tire.currentTreadDepth || 0) - MIN_TREAD_DEPTH
    const wearRate = tire.initialTreadDepth && tire.currentTreadDepth
      ? (Number(tire.initialTreadDepth) - Number(tire.currentTreadDepth)) / Math.max(Number(tire.totalMileage), 1) * 5000
      : null

    const estimatedRemainingKm = wearRate && wearRate > 0
      ? Math.round((remainingTread / wearRate) * 5000)
      : null

    res.json({ data: { ...tire, computedStatus: getStatus(tire), estimatedRemainingKm, wearRate } })
  } catch (err) { next(err) }
}

export async function createTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const {
      serialNumber, brand, model, size, type, dotCode,
      purchaseDate, purchasePrice, supplierId,
      vehicleId, installationDate, position,
      initialTreadDepth, currentTreadDepth,
      warrantyEndDate, notes, branchId,
    } = req.body

    const uniqueId = await generateTireUniqueId()
    const condition = getCondition(currentTreadDepth || initialTreadDepth)

    const tire = await (prisma as any).tire.create({
      data: {
        uniqueId, serialNumber, brand, model, size, type, dotCode,
        purchaseDate: new Date(purchaseDate),
        purchasePrice: parseFloat(purchasePrice),
        supplierId: supplierId || null,
        vehicleId: vehicleId || null,
        installationDate: installationDate ? new Date(installationDate) : null,
        position: position || null,
        initialTreadDepth: initialTreadDepth ? parseFloat(initialTreadDepth) : null,
        currentTreadDepth: currentTreadDepth ? parseFloat(currentTreadDepth) : (initialTreadDepth ? parseFloat(initialTreadDepth) : null),
        warrantyEndDate: warrantyEndDate ? new Date(warrantyEndDate) : null,
        notes, branchId: branchId || null, condition,
      },
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
        supplier: { select: { id: true, name: true } },
      }
    })

    // Create warranty record if warrantyEndDate provided
    if (warrantyEndDate) {
      await (prisma as any).warranty.create({
        data: {
          partType: 'tire',
          partId: tire.id,
          partName: `${brand} ${model} ${size}`,
          vehicleId: vehicleId || null,
          startDate: new Date(purchaseDate),
          endDate: new Date(warrantyEndDate),
          provider: supplierId ? undefined : undefined,
          status: 'active',
        }
      })
    }

    res.status(201).json({ data: tire })
  } catch (err) { next(err) }
}

export async function updateTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const {
      currentTreadDepth, totalMileage, position, vehicleId,
      installationDate, status, notes, condition,
    } = req.body

    const updated = await (prisma as any).tire.update({
      where: { id },
      data: {
        ...(currentTreadDepth !== undefined && { currentTreadDepth: parseFloat(currentTreadDepth), condition: getCondition(currentTreadDepth) }),
        ...(totalMileage !== undefined && { totalMileage: parseFloat(totalMileage) }),
        ...(position !== undefined && { position }),
        ...(vehicleId !== undefined && { vehicleId: vehicleId || null }),
        ...(installationDate !== undefined && { installationDate: installationDate ? new Date(installationDate) : null }),
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes }),
        ...(condition !== undefined && { condition }),
      },
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
        supplier: { select: { id: true, name: true } },
      }
    })
    res.json({ data: updated })
  } catch (err) { next(err) }
}

export async function retireTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { disposalMethod, notes } = req.body

    const tire = await (prisma as any).tire.update({
      where: { id },
      data: { status: 'retired', retiredAt: new Date(), disposalMethod, notes, vehicleId: null, position: null }
    })
    res.json({ data: tire })
  } catch (err) { next(err) }
}

export async function replaceTire(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { newTireData } = req.body

    // Mark old tire as replaced
    await (prisma as any).tire.update({
      where: { id },
      data: { status: 'replaced', replacedAt: new Date(), vehicleId: null, position: null }
    })

    // Create new tire with same vehicle/position
    if (newTireData) {
      const uniqueId = await generateTireUniqueId()
      const newTire = await (prisma as any).tire.create({
        data: {
          uniqueId,
          ...newTireData,
          purchaseDate: new Date(newTireData.purchaseDate),
          purchasePrice: parseFloat(newTireData.purchasePrice),
          installationDate: newTireData.installationDate ? new Date(newTireData.installationDate) : new Date(),
          initialTreadDepth: newTireData.initialTreadDepth ? parseFloat(newTireData.initialTreadDepth) : null,
          currentTreadDepth: newTireData.initialTreadDepth ? parseFloat(newTireData.initialTreadDepth) : null,
          condition: getCondition(newTireData.initialTreadDepth),
        }
      })
      return res.json({ data: { replacedTireId: id, newTire } })
    }

    res.json({ data: { replacedTireId: id } })
  } catch (err) { next(err) }
}

export async function addTireMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { tireId } = req.params
    const { type, date, position, cost, notes } = req.body

    const maintenance = await (prisma as any).tireMaintenance.create({
      data: {
        tireId, type,
        date: new Date(date),
        position: position || null,
        cost: parseFloat(cost || '0'),
        notes: notes || null,
      }
    })

    // If rotation, update tire position
    if (type === 'rotation' && position) {
      await (prisma as any).tire.update({ where: { id: tireId }, data: { position } })
    }

    res.status(201).json({ data: maintenance })
  } catch (err) { next(err) }
}

export async function getTireStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [total, active, needsReplacement, replaced, retired, critical] = await Promise.all([
      (prisma as any).tire.count(),
      (prisma as any).tire.count({ where: { status: 'active' } }),
      (prisma as any).tire.count({ where: { status: 'active', currentTreadDepth: { lt: 3, gt: 0 } } }),
      (prisma as any).tire.count({ where: { status: 'replaced' } }),
      (prisma as any).tire.count({ where: { status: 'retired' } }),
      (prisma as any).tire.count({ where: { status: 'active', currentTreadDepth: { lt: 1.6, gt: 0 } } }),
    ])

    // Tires needing replacement (tread < 3mm or age > 6 years)
    const urgentTires = await (prisma as any).tire.findMany({
      where: {
        status: 'active',
        OR: [
          { currentTreadDepth: { lt: 3, gt: 0 } },
        ]
      },
      include: {
        vehicle: { select: { registrationNumber: true, brand: true, model: true } }
      },
      orderBy: { currentTreadDepth: 'asc' },
      take: 10,
    })

    res.json({ data: { total, active, needsReplacement, replaced, retired, critical, urgentTires } })
  } catch (err) { next(err) }
}
