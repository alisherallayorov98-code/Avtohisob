import { Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { prisma } from '../lib/prisma'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

function computeStatus(endDate: Date, currentMileage?: number, mileageLimit?: number | null): string {
  const now = new Date()
  const daysLeft = Math.floor((endDate.getTime() - now.getTime()) / 86400000)

  if (daysLeft < 0) return 'expired'
  if (mileageLimit && currentMileage && currentMileage >= Number(mileageLimit)) return 'expired'
  if (daysLeft <= 30) return 'expiring_soon'
  return 'active'
}

export async function listWarranties(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', partType, vehicleId, status } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const where: any = {}
    if (partType) where.partType = partType
    if (vehicleId) {
      where.vehicleId = vehicleId
    } else if (bv !== undefined) {
      // Restrict to warranties for vehicles in this org, or tire warranties with no vehicle
      where.OR = [{ vehicleId: null }, { vehicle: { branchId: bv } }]
    }

    const [total, items] = await Promise.all([
      (prisma as any).warranty.count({ where }),
      (prisma as any).warranty.findMany({
        where, skip, take: parseInt(limit),
        include: { vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true } } },
        orderBy: { endDate: 'asc' },
      })
    ])

    // compute & optionally filter by status
    let enriched = items.map((w: any) => ({
      ...w,
      computedStatus: computeStatus(new Date(w.endDate), w.vehicle?.mileage ? Number(w.vehicle.mileage) : undefined, w.mileageLimit),
      daysLeft: Math.floor((new Date(w.endDate).getTime() - Date.now()) / 86400000),
    }))

    if (status) enriched = enriched.filter((w: any) => w.computedStatus === status)

    res.json({ data: enriched, meta: { total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function createWarranty(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { partType, partId, partName, vehicleId, startDate, endDate, mileageLimit, coverageType, provider, notes } = req.body

    const warranty = await (prisma as any).warranty.create({
      data: {
        partType, partId, partName,
        vehicleId: vehicleId || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        mileageLimit: mileageLimit ? parseFloat(mileageLimit) : null,
        coverageType: coverageType || 'full',
        provider: provider || null,
        notes: notes || null,
        status: computeStatus(new Date(endDate), undefined, mileageLimit),
      },
      include: { vehicle: { select: { id: true, registrationNumber: true } } }
    })
    res.status(201).json({ data: warranty })
  } catch (err) { next(err) }
}

export async function updateWarranty(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { endDate, mileageLimit, notes, status } = req.body
    const warranty = await (prisma as any).warranty.update({
      where: { id },
      data: {
        ...(endDate && { endDate: new Date(endDate) }),
        ...(mileageLimit !== undefined && { mileageLimit: mileageLimit ? parseFloat(mileageLimit) : null }),
        ...(notes !== undefined && { notes }),
        ...(status && { status }),
      }
    })
    res.json({ data: warranty })
  } catch (err) { next(err) }
}

export async function deleteWarranty(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await (prisma as any).warranty.delete({ where: { id: req.params.id } })
    res.json({ message: 'O\'chirildi' })
  } catch (err) { next(err) }
}

export async function getWarrantyStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const statsWhere: any = bv !== undefined
      ? { OR: [{ vehicleId: null }, { vehicle: { branchId: bv } }] }
      : {}
    const all = await (prisma as any).warranty.findMany({ where: statsWhere })
    const now = Date.now()
    let active = 0, expiringSoon = 0, expired = 0
    for (const w of all) {
      const days = Math.floor((new Date(w.endDate).getTime() - now) / 86400000)
      if (days < 0) expired++
      else if (days <= 30) expiringSoon++
      else active++
    }
    res.json({ data: { total: all.length, active, expiringSoon, expired } })
  } catch (err) { next(err) }
}

// Refresh all warranty statuses (batch — parallel updates)
export async function refreshWarrantyStatuses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const all = await (prisma as any).warranty.findMany({
      include: { vehicle: { select: { mileage: true } } },
    })
    const updates = all
      .map((w: any) => ({
        id: w.id,
        status: computeStatus(new Date(w.endDate), w.vehicle?.mileage ? Number(w.vehicle.mileage) : undefined, w.mileageLimit),
        oldStatus: w.status,
      }))
      .filter((w: any) => w.status !== w.oldStatus)

    await Promise.all(
      updates.map((w: any) => (prisma as any).warranty.update({ where: { id: w.id }, data: { status: w.status } }))
    )
    res.json({ message: `${all.length} ta kafolat tekshirildi, ${updates.length} ta yangilandi` })
  } catch (err) { next(err) }
}
