import { Response } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

async function resolveOrgId(user: NonNullable<AuthRequest['user']>): Promise<string | null> {
  if (user.role === 'super_admin') return null
  if (!user.branchId) return null
  const branch = await (prisma.branch as any).findUnique({
    where: { id: user.branchId },
    select: { organizationId: true },
  })
  return branch?.organizationId ?? user.branchId
}

async function getOrgDefaults(orgId: string | null) {
  if (!orgId) return { oilIntervalKm: 7000, oilWarningKm: 500 }
  const s = await (prisma as any).orgSettings.findUnique({ where: { orgId } })
  return { oilIntervalKm: s?.oilIntervalKm ?? 7000, oilWarningKm: s?.oilWarningKm ?? 500 }
}

/** GET /api/oil-change/settings */
export async function getOrgOilSettings(req: AuthRequest, res: Response) {
  const orgId = await resolveOrgId(req.user!)
  const defaults = await getOrgDefaults(orgId)
  res.json(defaults)
}

/** POST /api/oil-change/settings */
export async function saveOrgOilSettings(req: AuthRequest, res: Response) {
  const { oilIntervalKm, oilWarningKm } = req.body
  const orgId = await resolveOrgId(req.user!)
  if (!orgId) return res.status(403).json({ error: "Ruxsat yo'q" })

  if (!oilIntervalKm || Number(oilIntervalKm) < 1000 || Number(oilIntervalKm) > 50000) {
    return res.status(400).json({ error: "oilIntervalKm 1000-50000 oralig'ida bo'lishi kerak" })
  }

  const settings = await (prisma as any).orgSettings.upsert({
    where: { orgId },
    create: { orgId, oilIntervalKm: Number(oilIntervalKm), oilWarningKm: Number(oilWarningKm ?? 500) },
    update: { oilIntervalKm: Number(oilIntervalKm), oilWarningKm: Number(oilWarningKm ?? 500) },
  })
  res.json(settings)
}

/** GET /api/oil-change/overview */
export async function getOilOverview(req: AuthRequest, res: Response) {
  const filter = await getOrgFilter(req.user!)
  const bv = applyBranchFilter(filter)
  const orgId = await resolveOrgId(req.user!)
  const { oilIntervalKm: defaultIntervalKm, oilWarningKm: defaultWarningKm } = await getOrgDefaults(orgId)

  const where: any = { status: 'active' }
  if (bv !== undefined) where.branchId = bv

  const vehicles = await prisma.vehicle.findMany({
    where,
    select: {
      id: true,
      registrationNumber: true,
      brand: true,
      model: true,
      mileage: true,
      lastGpsSignal: true,
      oilIntervalKm: true,
      fuelType: true,
      serviceIntervals: { where: { serviceType: 'oil_change' }, take: 1 },
      gpsMileageLogs: {
        where: { skipped: false },
        orderBy: { syncedAt: 'asc' },
        take: 1,
      },
    },
    orderBy: { registrationNumber: 'asc' },
  })

  const result = vehicles.map(v => {
    const currentKm = Number(v.mileage)
    const effectiveIntervalKm = v.oilIntervalKm ?? defaultIntervalKm
    const interval = (v.serviceIntervals as any[])[0] ?? null

    let remainingKm: number | null = null
    let percentUsed: number | null = null
    let status = 'no_data'

    if (interval?.nextDueKm != null) {
      remainingKm = interval.nextDueKm - currentKm
      const sinceLastKm = currentKm - (interval.lastServiceKm ?? Math.max(0, currentKm - effectiveIntervalKm))
      percentUsed = Math.min(100, Math.round((sinceLastKm / effectiveIntervalKm) * 100))

      if (currentKm >= interval.nextDueKm) status = 'overdue'
      else if (currentKm >= interval.nextDueKm - defaultWarningKm) status = 'due_soon'
      else status = 'ok'
    }

    const firstLog = (v.gpsMileageLogs as any[])[0]
    const firstGpsKm = firstLog ? Number(firstLog.prevMileageKm) : null

    return {
      id: v.id,
      registrationNumber: v.registrationNumber,
      brand: v.brand,
      model: v.model,
      fuelType: v.fuelType,
      currentKm,
      lastGpsSignal: v.lastGpsSignal,
      oilIntervalKm: v.oilIntervalKm,
      effectiveIntervalKm,
      intervalId: interval?.id ?? null,
      lastServiceKm: interval?.lastServiceKm ?? null,
      lastServiceDate: interval?.lastServiceDate ?? null,
      nextDueKm: interval?.nextDueKm ?? null,
      remainingKm,
      percentUsed,
      status,
      firstGpsKm,
    }
  })

  // Sort: overdue first, then due_soon, then ok, then no_data
  const order: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2, no_data: 3 }
  result.sort((a, b) => {
    const od = order[a.status] - order[b.status]
    if (od !== 0) return od
    if (a.remainingKm !== null && b.remainingKm !== null) return a.remainingKm - b.remainingKm
    return 0
  })

  res.json({
    vehicles: result,
    defaults: { oilIntervalKm: defaultIntervalKm, oilWarningKm: defaultWarningKm },
    summary: {
      total: result.length,
      ok: result.filter(v => v.status === 'ok').length,
      due_soon: result.filter(v => v.status === 'due_soon').length,
      overdue: result.filter(v => v.status === 'overdue').length,
      no_data: result.filter(v => v.status === 'no_data').length,
    },
  })
}

/** POST /api/oil-change/bulk-setup */
export async function bulkOilSetup(req: AuthRequest, res: Response) {
  const { items } = req.body
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items majburiy' })
  }

  const filter = await getOrgFilter(req.user!)
  const orgId = await resolveOrgId(req.user!)
  const { oilIntervalKm: defaultIntervalKm, oilWarningKm: defaultWarningKm } = await getOrgDefaults(orgId)

  let saved = 0

  for (const item of items) {
    const { vehicleId, lastServiceKm, intervalKm } = item
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle || !isBranchAllowed(filter, vehicle.branchId)) continue

    const effectiveIntervalKm = intervalKm ? Number(intervalKm) : defaultIntervalKm
    const currentKm = Number(vehicle.mileage)

    let baseKm: number
    if (lastServiceKm != null && lastServiceKm !== '') {
      baseKm = Number(lastServiceKm)
    } else {
      // GPS dan birinchi qayd km dan hisoblash
      const firstLog = await (prisma as any).gpsMileageLog.findFirst({
        where: { vehicleId, skipped: false },
        orderBy: { syncedAt: 'asc' },
      })
      baseKm = firstLog ? Number(firstLog.prevMileageKm) : currentKm
    }

    const nextDueKm = baseKm + effectiveIntervalKm
    let status: 'ok' | 'due_soon' | 'overdue' = 'ok'
    if (currentKm >= nextDueKm) status = 'overdue'
    else if (currentKm >= nextDueKm - defaultWarningKm) status = 'due_soon'

    try {
      await prisma.serviceInterval.upsert({
        where: { vehicleId_serviceType: { vehicleId, serviceType: 'oil_change' } },
        create: {
          vehicleId,
          serviceType: 'oil_change',
          intervalKm: effectiveIntervalKm,
          intervalDays: 180,
          warningKm: defaultWarningKm,
          lastServiceKm: lastServiceKm != null && lastServiceKm !== '' ? Number(lastServiceKm) : null,
          nextDueKm,
          status,
        },
        update: {
          intervalKm: effectiveIntervalKm,
          lastServiceKm: lastServiceKm != null && lastServiceKm !== '' ? Number(lastServiceKm) : null,
          nextDueKm,
          status,
        },
      })
      // Per-vehicle override faqat tashkilot defaultidan farq qilganda saqlanadi
      if (intervalKm && Number(intervalKm) !== defaultIntervalKm) {
        await prisma.vehicle.update({ where: { id: vehicleId }, data: { oilIntervalKm: Number(intervalKm) } })
      }
      saved++
    } catch (_) { /* continue */ }
  }

  res.json({ saved })
}

/** POST /api/oil-change/record */
export async function recordOilChange(req: AuthRequest, res: Response) {
  const { vehicleId, servicedAtKm, servicedAt, technicianName, notes } = req.body
  if (!vehicleId) return res.status(400).json({ error: 'vehicleId majburiy' })

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' })

  const filter = await getOrgFilter(req.user!)
  if (!isBranchAllowed(filter, vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" })
  }

  const orgId = await resolveOrgId(req.user!)
  const { oilIntervalKm: defaultIntervalKm, oilWarningKm: defaultWarningKm } = await getOrgDefaults(orgId)

  const km = servicedAtKm != null ? Number(servicedAtKm) : Number(vehicle.mileage)
  const date = servicedAt ? new Date(servicedAt) : new Date()
  const intervalKm = vehicle.oilIntervalKm ?? defaultIntervalKm
  const nextDueKm = km + intervalKm

  const interval = await prisma.serviceInterval.upsert({
    where: { vehicleId_serviceType: { vehicleId, serviceType: 'oil_change' } },
    create: {
      vehicleId,
      serviceType: 'oil_change',
      intervalKm,
      intervalDays: 180,
      warningKm: defaultWarningKm,
      lastServiceKm: km,
      lastServiceDate: date,
      nextDueKm,
      nextDueDate: new Date(date.getTime() + 180 * 24 * 60 * 60 * 1000),
      status: 'ok',
    },
    update: {
      lastServiceKm: km,
      lastServiceDate: date,
      nextDueKm,
      nextDueDate: new Date(date.getTime() + 180 * 24 * 60 * 60 * 1000),
      status: 'ok',
      intervalKm,
    },
  })

  await prisma.serviceRecord.create({
    data: {
      vehicleId,
      serviceIntervalId: interval.id,
      serviceType: 'oil_change',
      servicedAtKm: km,
      servicedAt: date,
      cost: 0,
      technicianName: technicianName ?? null,
      notes: notes ?? null,
      nextDueKm,
      createdById: req.user?.id ?? null,
    },
  })

  res.json({ success: true, nextDueKm, intervalKm })
}
