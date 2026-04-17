import { Response } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getOrgFilter, applyNarrowedBranchFilter, isBranchAllowed } from '../lib/orgFilter'
import { getVehicleIntervalKm } from '../services/wialonService'

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
  const { branchId } = req.query as any
  const filter = await getOrgFilter(req.user!)
  const narrowed = applyNarrowedBranchFilter(filter, branchId || undefined)
  const orgId = await resolveOrgId(req.user!)
  const { oilIntervalKm: defaultIntervalKm, oilWarningKm: defaultWarningKm } = await getOrgDefaults(orgId)

  const where: any = { status: 'active' }
  if (narrowed !== undefined) where.branchId = narrowed

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

    // currentKm = 0 bo'lsa odometr noma'lum — hisob-kitob noto'g'ri bo'ladi, ko'rsatmaymiz
    if (interval?.nextDueKm != null && currentKm > 0) {
      remainingKm = interval.nextDueKm - currentKm
      // lastServiceKm null bo'lsa — sinceLastKm = remainingKm orqali teskari hisoblaymiz
      const sinceLastKm = interval.lastServiceKm != null
        ? Math.max(0, currentKm - interval.lastServiceKm)
        : Math.max(0, effectiveIntervalKm - (interval.nextDueKm - currentKm))
      percentUsed = Math.min(100, Math.round((sinceLastKm / effectiveIntervalKm) * 100))

      if (currentKm >= interval.nextDueKm) status = 'overdue'
      else if (currentKm >= interval.nextDueKm - defaultWarningKm) status = 'due_soon'
      else status = 'ok'
    } else if (interval?.nextDueKm != null && currentKm === 0) {
      // Interval sozlangan lekin odometr nol — GPS sinxronlashini kutmoqda
      status = 'no_data'
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
    const { vehicleId, lastServiceKm, intervalKm, estimatedCurrentKm, lastServiceDate } = item
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle || !isBranchAllowed(filter, vehicle.branchId)) continue

    const rawIntervalKm = intervalKm ? Number(intervalKm) : null
    // Xato interval qiymatlarini rad etamiz (odometr vs interval adashuvi oldini olish)
    if (rawIntervalKm !== null && (rawIntervalKm < 500 || rawIntervalKm > 50000)) continue
    const effectiveIntervalKm = rawIntervalKm ?? defaultIntervalKm

    // GPS interval usulida estimatedCurrentKm kelishi mumkin (moy km + GPS yurgan)
    // Aks holda vehicle.mileage ni ishlatamiz
    const estKm = estimatedCurrentKm ? Number(estimatedCurrentKm) : 0
    const currentKm = estKm > Number(vehicle.mileage) ? estKm : Number(vehicle.mileage)

    let baseKm: number
    if (lastServiceKm != null && lastServiceKm !== '') {
      baseKm = Number(lastServiceKm)
    } else {
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
      const serviceKmVal = lastServiceKm != null && lastServiceKm !== '' ? Number(lastServiceKm) : null
      const serviceDateVal = serviceKmVal != null
        ? (lastServiceDate ? new Date(lastServiceDate) : new Date())
        : null

      await prisma.serviceInterval.upsert({
        where: { vehicleId_serviceType: { vehicleId, serviceType: 'oil_change' } },
        create: {
          vehicleId, serviceType: 'oil_change',
          intervalKm: effectiveIntervalKm, intervalDays: 180, warningKm: defaultWarningKm,
          lastServiceKm: serviceKmVal,
          lastServiceDate: serviceDateVal,
          nextDueKm, status,
        },
        update: {
          intervalKm: effectiveIntervalKm,
          lastServiceKm: serviceKmVal,
          lastServiceDate: serviceDateVal,
          nextDueKm, status,
        },
      })
      // vehicle.mileage ni eng yuqori ma'lum km ga yangilash
      if (currentKm > Number(vehicle.mileage)) {
        await prisma.vehicle.update({ where: { id: vehicleId }, data: { mileage: currentKm } })
      }
      // vehicle.oilIntervalKm — har doim yangilanadi (null = org default)
      await prisma.vehicle.update({ where: { id: vehicleId }, data: { oilIntervalKm: rawIntervalKm } })
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

  const km = servicedAtKm != null && Number(servicedAtKm) > 0
    ? Number(servicedAtKm)
    : Number(vehicle.mileage)
  if (km <= 0) return res.status(400).json({ error: 'Moy almashilgan km kiritilishi shart' })

  const date = servicedAt ? new Date(servicedAt) : new Date()
  const intervalKm = vehicle.oilIntervalKm ?? defaultIntervalKm
  const nextDueKm = km + intervalKm

  // vehicle.mileage ni eng yuqori ma'lum km ga yangilash (GPS tracking uchun to'g'ri baza)
  if (km > Number(vehicle.mileage)) {
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { mileage: km } })
  }

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

/**
 * GET /api/oil-change/km-at-date?vehicleId=&date=
 * GPS loglaridan berilgan sanaga eng yaqin km ni topadi.
 * Natija: o'sha sana km, bugungi km, yurgan km (farq).
 */
export async function getKmAtDate(req: AuthRequest, res: Response) {
  const { vehicleId, date } = req.query as { vehicleId: string; date: string }
  if (!vehicleId || !date) return res.status(400).json({ error: 'vehicleId va date majburiy' })

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' })

  const filter = await getOrgFilter(req.user!)
  if (!isBranchAllowed(filter, vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" })
  }

  const targetDate = new Date(date)
  // Berilgan sanaga eng yaqin log (oldidagi yoki o'sha kuni)
  const logBefore = await (prisma as any).gpsMileageLog.findFirst({
    where: { vehicleId, skipped: false, syncedAt: { lte: new Date(targetDate.getTime() + 24 * 3600000) } },
    orderBy: { syncedAt: 'desc' },
  })

  const currentKm = Number(vehicle.mileage)

  if (!logBefore) {
    const hasGpsLink = !!(vehicle as any).gpsUnitName || !!(vehicle as any).lastGpsSignal

    // GPS ulangan bo'lsa — Wialon messages API orqali interval masofasini hisoblaymiz
    if (hasGpsLink) {
      const branch = await (prisma as any).branch.findUnique({
        where: { id: vehicle.branchId },
        select: { organizationId: true },
      })
      const orgId = branch?.organizationId ?? vehicle.branchId
      const cred = await (prisma as any).gpsCredential.findUnique({
        where: { orgId },
        select: { id: true, isActive: true },
      })

      if (cred?.isActive) {
        const lookupKey = ((vehicle as any).gpsUnitName || vehicle.registrationNumber).trim()
        const { km: intervalKm, unitFound } = await getVehicleIntervalKm(
          cred.id, lookupKey, targetDate, new Date()
        )

        if (unitFound && intervalKm > 0) {
          return res.json({
            found: true,
            kmAtDate: Math.max(0, currentKm - intervalKm),
            logDate: date,
            currentKm,
            kmTraveled: Math.round(intervalKm),
            note: `GPS xabarlaridan hisoblandi (${targetDate.toLocaleDateString('uz')} – bugun)`,
            gpsLinked: true,
            skipReason: null,
          })
        }

        if (unitFound && intervalKm === 0) {
          return res.json({
            found: false,
            kmAtDate: currentKm,
            logDate: null,
            currentKm,
            kmTraveled: 0,
            note: 'GPS ulangan, lekin bu davrda harakat aniqlanmadi. Mashina turgan bo\'lishi mumkin.',
            gpsLinked: true,
            skipReason: null,
          })
        }
      }
    }

    // GPS ulanmagan yoki credentials yo'q
    return res.json({
      found: false,
      kmAtDate: currentKm,
      logDate: null,
      currentKm,
      kmTraveled: 0,
      note: hasGpsLink
        ? "Bu sana uchun GPS km tarixi yo'q. Hozirgi km ishlatiladi."
        : "GPS ulanmagan. Sozlamalar → GPS sahifasidan ulang.",
      gpsLinked: hasGpsLink,
      skipReason: null,
    })
  }

  const kmAtDate = Number(logBefore.gpsMileageKm)
  const kmTraveled = Math.max(0, currentKm - kmAtDate)

  res.json({
    found: true,
    kmAtDate,
    logDate: logBefore.syncedAt,
    currentKm,
    kmTraveled,
    note: null,
  })
}

/**
 * GET /api/gps/vehicle-mileage-report?vehicleId=&from=&to=
 * Berilgan sana oralig'ida har bir GPS sync da yurgan km hisoboti.
 */
export async function getVehicleMileageReport(req: AuthRequest, res: Response) {
  const { vehicleId, from, to } = req.query as { vehicleId: string; from: string; to: string }
  if (!vehicleId || !from || !to) return res.status(400).json({ error: 'vehicleId, from, to majburiy' })

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' })

  const filter = await getOrgFilter(req.user!)
  if (!isBranchAllowed(filter, vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" })
  }

  const fromDate = new Date(from)
  const toDate = new Date(to)
  toDate.setHours(23, 59, 59, 999)

  const logs = await (prisma as any).gpsMileageLog.findMany({
    where: {
      vehicleId,
      skipped: false,
      syncedAt: { gte: fromDate, lte: toDate },
    },
    orderBy: { syncedAt: 'asc' },
  })

  // Kunlik yig'indi: km yurgan (gpsMileageKm - prevMileageKm)
  const dailyMap: Record<string, number> = {}
  for (const log of logs) {
    const day = new Date(log.syncedAt).toISOString().slice(0, 10)
    const delta = Math.max(0, Number(log.gpsMileageKm) - Number(log.prevMileageKm))
    dailyMap[day] = (dailyMap[day] ?? 0) + delta
  }

  const dailyRows = Object.entries(dailyMap).map(([date, km]) => ({ date, km: Math.round(km) }))
  const totalKm = dailyRows.reduce((s, r) => s + r.km, 0)

  // Boshlang'ich va oxirgi km
  const startKm = logs.length > 0 ? Number(logs[0].prevMileageKm) : null
  const endKm = logs.length > 0 ? Number(logs[logs.length - 1].gpsMileageKm) : null

  res.json({
    vehicleId,
    registrationNumber: vehicle.registrationNumber,
    from: fromDate,
    to: toDate,
    totalKm,
    startKm,
    endKm,
    days: dailyRows,
    syncCount: logs.length,
  })
}
