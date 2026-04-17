import { Response } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getOrgFilter, applyNarrowedBranchFilter } from '../lib/orgFilter'

/**
 * GET /api/fuel-analytics/gps-check
 * Yoqilg'i quyish yozuvlari va GPS km ni solishtirish.
 * Agar GPS km dan odometr km 20%+ farq qilsa — anomaliya belgisi.
 */
export async function getFuelGpsCheck(req: AuthRequest, res: Response) {
  const { branchId, from, to } = req.query as Record<string, string>
  const filter = await getOrgFilter(req.user!)
  const narrowed = applyNarrowedBranchFilter(filter, branchId || undefined)

  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000)
  const toDate = to ? new Date(to) : new Date()
  toDate.setHours(23, 59, 59, 999)

  const vehicleWhere: any = { status: 'active' }
  if (narrowed !== undefined) vehicleWhere.branchId = narrowed

  const vehicles = await prisma.vehicle.findMany({
    where: vehicleWhere,
    select: {
      id: true,
      registrationNumber: true,
      brand: true,
      model: true,
      mileage: true,
      lastGpsSignal: true,
      fuelRecords: {
        where: { refuelDate: { gte: fromDate, lte: toDate } },
        orderBy: { refuelDate: 'asc' },
        select: { id: true, amountLiters: true, cost: true, odometerReading: true, refuelDate: true },
      },
      gpsMileageLogs: {
        where: { skipped: false, syncedAt: { gte: fromDate, lte: toDate } },
        orderBy: { syncedAt: 'asc' },
        select: { syncedAt: true, gpsMileageKm: true, prevMileageKm: true },
      },
    },
  })

  const result = vehicles.map(v => {
    const fuels = v.fuelRecords as any[]
    const gpsLogs = v.gpsMileageLogs as any[]

    if (fuels.length < 2) {
      return {
        id: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand,
        model: v.model,
        status: 'insufficient_data',
        message: 'Taqqoslash uchun kamida 2 ta yoqilg\'i yozuvi kerak',
        fuelCount: fuels.length,
        gpsLogCount: gpsLogs.length,
        details: null,
      }
    }

    // Yoqilg'i yozuvlaridagi odometr oralig'i
    const firstOdo = Number(fuels[0].odometerReading)
    const lastOdo = Number(fuels[fuels.length - 1].odometerReading)
    const odoKm = lastOdo - firstOdo

    // GPS da o'sha davrdagi km o'zgarishi
    const gpsKm = gpsLogs.reduce((s: number, l: any) => {
      return s + Math.max(0, Number(l.gpsMileageKm) - Number(l.prevMileageKm))
    }, 0)

    // Jami yoqilg'i va l/100km
    const totalLiters = fuels.slice(1).reduce((s: number, f: any) => s + Number(f.amountLiters), 0)
    const totalCost = fuels.reduce((s: number, f: any) => s + Number(f.cost), 0)

    const odoConsumption = odoKm > 10 ? Math.round((totalLiters / odoKm) * 100 * 10) / 10 : null
    const gpsConsumption = gpsKm > 10 ? Math.round((totalLiters / gpsKm) * 100 * 10) / 10 : null

    // Farq foizi (odometr va GPS o'rtasida)
    let kmDeviation: number | null = null
    let deviationStatus = 'ok'
    let anomalyFlags: string[] = []

    if (odoKm > 0 && gpsKm > 0) {
      kmDeviation = Math.round(((odoKm - gpsKm) / gpsKm) * 100)
      if (Math.abs(kmDeviation) > 30) {
        deviationStatus = 'critical'
        anomalyFlags.push(`Odometr/GPS farqi ${kmDeviation > 0 ? '+' : ''}${kmDeviation}% — yoqilg'i hisobini tekshiring`)
      } else if (Math.abs(kmDeviation) > 15) {
        deviationStatus = 'warning'
        anomalyFlags.push(`Odometr/GPS farqi ${kmDeviation > 0 ? '+' : ''}${kmDeviation}%`)
      }
    }

    if (odoConsumption !== null && odoConsumption > 20) {
      deviationStatus = deviationStatus === 'ok' ? 'warning' : deviationStatus
      anomalyFlags.push(`Sarfi juda yuqori: ${odoConsumption} l/100km`)
    }

    if (gpsLogs.length === 0) {
      deviationStatus = 'no_gps'
      anomalyFlags.push("GPS ma'lumoti yo'q")
    }

    return {
      id: v.id,
      registrationNumber: v.registrationNumber,
      brand: v.brand,
      model: v.model,
      status: deviationStatus,
      fuelCount: fuels.length,
      gpsLogCount: gpsLogs.length,
      details: {
        odoKm: Math.round(odoKm),
        gpsKm: Math.round(gpsKm),
        kmDeviation,
        totalLiters: Math.round(totalLiters * 10) / 10,
        totalCost: Math.round(totalCost),
        odoConsumption,
        gpsConsumption,
        anomalyFlags,
      },
    }
  })

  // Tartiblash: avval kritik, keyin warning
  const order: Record<string, number> = { critical: 0, warning: 1, no_gps: 2, ok: 3, insufficient_data: 4 }
  result.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5))

  res.json({
    vehicles: result,
    period: { from: fromDate, to: toDate },
    summary: {
      total: result.length,
      critical: result.filter(v => v.status === 'critical').length,
      warning: result.filter(v => v.status === 'warning').length,
      ok: result.filter(v => v.status === 'ok').length,
      no_gps: result.filter(v => v.status === 'no_gps').length,
    },
  })
}
