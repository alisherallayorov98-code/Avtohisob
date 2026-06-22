import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getOrgFilter, applyNarrowedBranchFilter, applyBranchFilter, isBranchAllowed, resolveOrgId } from '../lib/orgFilter'
import { getVehicleIntervalKm, getVehicleDailyMileage } from '../services/wialonService'
import { AppError } from '../middleware/errorHandler'

async function getOrgDefaults(orgId: string | null) {
  if (!orgId) return { oilIntervalKm: 7000, oilWarningKm: 500 }
  const s = await (prisma as any).orgSettings.findUnique({ where: { orgId } })
  return { oilIntervalKm: s?.oilIntervalKm ?? 7000, oilWarningKm: s?.oilWarningKm ?? 500 }
}

// Qo'llab-quvvatlanadigan xizmat turlari va ularning standart intervallari.
// oil_change uchun org sozlamasi (OrgSettings) ustun; qolganlar uchun shu standart.
export const OIL_SERVICE_TYPES = ['oil_change', 'oil_filter', 'air_filter', 'fuel_filter'] as const
const TYPE_DEFAULT_INTERVAL: Record<string, number> = {
  oil_change: 7000, oil_filter: 7000, air_filter: 15000, fuel_filter: 20000,
}

// So'rovdan xizmat turini xavfsiz o'qish (faqat ruxsat etilgan turlar, default oil_change)
function resolveServiceType(raw: any): string {
  const t = String(raw || '').trim()
  return (OIL_SERVICE_TYPES as readonly string[]).includes(t) ? t : 'oil_change'
}

// Tur bo'yicha standart interval/ogohlantirish. oil_change → org sozlamasi.
async function getTypeDefaults(orgId: string | null, serviceType: string) {
  if (serviceType === 'oil_change') {
    const d = await getOrgDefaults(orgId)
    return { intervalKm: d.oilIntervalKm, warningKm: d.oilWarningKm }
  }
  return { intervalKm: TYPE_DEFAULT_INTERVAL[serviceType] ?? 10000, warningKm: 1000 }
}

/** GET /api/oil-change/settings */
export async function getOrgOilSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const defaults = await getOrgDefaults(orgId)
    res.json(defaults)
  } catch (err) { next(err) }
}

/** POST /api/oil-change/settings */
export async function saveOrgOilSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { oilIntervalKm, oilWarningKm } = req.body
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError("Ruxsat yo'q", 403)

    if (!oilIntervalKm || Number(oilIntervalKm) < 1000 || Number(oilIntervalKm) > 50000) {
      throw new AppError("oilIntervalKm 1000-50000 oralig'ida bo'lishi kerak", 400)
    }

    const newInterval = Number(oilIntervalKm)
    const newWarning = Number(oilWarningKm ?? 500)

    const settings = await (prisma as any).orgSettings.upsert({
      where: { orgId },
      create: { orgId, oilIntervalKm: newInterval, oilWarningKm: newWarning },
      update: { oilIntervalKm: newInterval, oilWarningKm: newWarning },
    })

    // Org standarti o'zgargach — shaxsiy override'i YO'Q mashinalarning saqlangan
    // nextDueKm/status qiymatlarini yangi interval bo'yicha qayta hisoblaymiz.
    // (override'li mashinalar o'z intervalida qoladi.) lastServiceKm ma'lum bo'lganlarni
    // yangilaymiz — cron va boshqa o'qiydigan joylar to'g'ri ko'rsatsin.
    const orgBranches = await prisma.branch.findMany({ where: { organizationId: orgId }, select: { id: true } })
    const branchIds = orgBranches.map(b => b.id)
    if (branchIds.length > 0) {
      const intervals = await prisma.serviceInterval.findMany({
        where: {
          serviceType: 'oil_change',
          lastServiceKm: { not: null },
          vehicle: { branchId: { in: branchIds }, oilIntervalKm: null },
        },
        select: { id: true, lastServiceKm: true, vehicle: { select: { mileage: true } } },
      })
      for (const it of intervals) {
        const lastKm = Number(it.lastServiceKm)
        const nextDueKm = lastKm + newInterval
        const currentKm = Number(it.vehicle.mileage)
        let status: 'ok' | 'due_soon' | 'overdue' = 'ok'
        if (currentKm >= nextDueKm) status = 'overdue'
        else if (currentKm >= nextDueKm - newWarning) status = 'due_soon'
        await prisma.serviceInterval.update({
          where: { id: it.id },
          data: { intervalKm: newInterval, warningKm: newWarning, nextDueKm, status },
        }).catch(() => {})
      }
    }

    res.json(settings)
  } catch (err) { next(err) }
}

// Overview hisob-kitobi — handler va Excel eksport o'rtasida qayta ishlatiladi
async function computeOilOverview(req: AuthRequest) {
    const { branchId } = req.query as any
    const serviceType = resolveServiceType((req.query as any).serviceType)
    const filter = await getOrgFilter(req.user!)
    const narrowed = applyNarrowedBranchFilter(filter, branchId || undefined)
    const orgId = await resolveOrgId(req.user!)
    const { intervalKm: defaultIntervalKm, warningKm: defaultWarningKm } = await getTypeDefaults(orgId, serviceType)

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
        serviceIntervals: { where: { serviceType }, take: 1 },
        gpsMileageLogs: {
          where: { skipped: false },
          orderBy: { syncedAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { registrationNumber: 'asc' },
    })

    // ─── Kunlik o'rtacha km (bashorat uchun) ────────────────────────────────────
    // Oxirgi 30 kunlik GPS loglardan: (maxKm − minKm) / kun farqi. Bitta groupBy
    // so'rovi — N+1 yo'q. Monotonik probeg tufayli min/max = birinchi/oxirgi.
    const vehicleIds = vehicles.map(v => v.id)
    const since = new Date(Date.now() - 30 * 86400000)
    const grp: any[] = vehicleIds.length
      ? await (prisma as any).gpsMileageLog.groupBy({
          by: ['vehicleId'],
          where: { vehicleId: { in: vehicleIds }, skipped: false, syncedAt: { gte: since } },
          _min: { gpsMileageKm: true, syncedAt: true },
          _max: { gpsMileageKm: true, syncedAt: true },
        }).catch(() => [])
      : []
    const avgDailyMap = new Map<string, number>()
    for (const g of grp) {
      const kmSpan = Number(g._max?.gpsMileageKm ?? 0) - Number(g._min?.gpsMileageKm ?? 0)
      const daySpan = (new Date(g._max?.syncedAt).getTime() - new Date(g._min?.syncedAt).getTime()) / 86400000
      if (daySpan >= 1 && kmSpan > 0) avgDailyMap.set(g.vehicleId, kmSpan / daySpan)
    }

    const result = vehicles.map(v => {
      const currentKm = Number(v.mileage)
      const interval = (v.serviceIntervals as any[])[0] ?? null
      // Per-vehicle override: oil_change uchun Vehicle.oilIntervalKm, boshqa turlar uchun
      // ServiceInterval.intervalKm (alohida ustun yo'q)
      const perVehicleOverride = serviceType === 'oil_change'
        ? v.oilIntervalKm
        : (interval?.intervalKm ?? null)
      const effectiveIntervalKm = perVehicleOverride ?? defaultIntervalKm

      let remainingKm: number | null = null
      let percentUsed: number | null = null
      let status = 'no_data'

      // nextDueKm ni JONLI hisoblaymiz: lastServiceKm + hozirgi effektiv interval.
      // Saqlangan interval.nextDueKm eski interval bilan muzlatilgan bo'lishi mumkin
      // (masalan org standarti 7000→10000 ga o'zgartirilgan). lastServiceKm ma'lum
      // bo'lsa undan hisoblaymiz; aks holda saqlangan qiymatga qaytamiz.
      const effectiveNextDueKm = interval?.lastServiceKm != null
        ? interval.lastServiceKm + effectiveIntervalKm
        : interval?.nextDueKm ?? null

      // currentKm = 0 bo'lsa odometr noma'lum — hisob-kitob noto'g'ri bo'ladi, ko'rsatmaymiz
      if (effectiveNextDueKm != null && currentKm > 0) {
        remainingKm = effectiveNextDueKm - currentKm
        // lastServiceKm null bo'lsa — sinceLastKm = remainingKm orqali teskari hisoblaymiz
        const sinceLastKm = interval.lastServiceKm != null
          ? Math.max(0, currentKm - interval.lastServiceKm)
          : Math.max(0, effectiveIntervalKm - (effectiveNextDueKm - currentKm))
        percentUsed = Math.min(100, Math.round((sinceLastKm / effectiveIntervalKm) * 100))

        if (currentKm >= effectiveNextDueKm) status = 'overdue'
        else if (currentKm >= effectiveNextDueKm - defaultWarningKm) status = 'due_soon'
        else status = 'ok'
      } else if (effectiveNextDueKm != null && currentKm === 0) {
        // Interval sozlangan lekin odometr nol — GPS sinxronlashini kutmoqda
        status = 'no_data'
      }

      const firstLog = (v.gpsMileageLogs as any[])[0]
      const firstGpsKm = firstLog ? Number(firstLog.prevMileageKm) : null

      // ─── Bashorat: qolgan km / kunlik o'rtacha = necha kun qoldi ──────────────
      const avgDailyKm = avgDailyMap.get(v.id) ?? null
      let daysUntilDue: number | null = null
      let predictedDueDate: Date | null = null
      if (remainingKm != null && remainingKm > 0 && avgDailyKm && avgDailyKm > 0) {
        daysUntilDue = Math.round(remainingKm / avgDailyKm)
        predictedDueDate = new Date(Date.now() + daysUntilDue * 86400000)
      } else if (remainingKm != null && remainingKm <= 0) {
        daysUntilDue = 0  // allaqachon o'tib ketgan
      }

      // ─── Ishonchlilik: ma'lumot manbasi + GPS signal yoshi ───────────────────
      const signalAgeDays = v.lastGpsSignal
        ? Math.floor((Date.now() - new Date(v.lastGpsSignal).getTime()) / 86400000)
        : null
      let dataSource: 'gps_live' | 'gps_stale' | 'manual' | 'no_data'
      if (currentKm <= 0) dataSource = 'no_data'
      else if (!v.lastGpsSignal) dataSource = 'manual'
      else if (signalAgeDays != null && signalAgeDays <= 3) dataSource = 'gps_live'
      else dataSource = 'gps_stale'

      return {
        id: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand,
        model: v.model,
        fuelType: v.fuelType,
        currentKm,
        lastGpsSignal: v.lastGpsSignal,
        oilIntervalKm: perVehicleOverride,
        effectiveIntervalKm,
        intervalId: interval?.id ?? null,
        lastServiceKm: interval?.lastServiceKm ?? null,
        lastServiceDate: interval?.lastServiceDate ?? null,
        nextDueKm: effectiveNextDueKm,
        remainingKm,
        percentUsed,
        status,
        firstGpsKm,
        avgDailyKm: avgDailyKm != null ? Math.round(avgDailyKm) : null,
        daysUntilDue,
        predictedDueDate,
        signalAgeDays,
        dataSource,
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

    return {
      serviceType,
      vehicles: result,
      defaults: { oilIntervalKm: defaultIntervalKm, oilWarningKm: defaultWarningKm },
      summary: {
        total: result.length,
        ok: result.filter(v => v.status === 'ok').length,
        due_soon: result.filter(v => v.status === 'due_soon').length,
        overdue: result.filter(v => v.status === 'overdue').length,
        no_data: result.filter(v => v.status === 'no_data').length,
      },
    }
}

/** GET /api/oil-change/overview */
export async function getOilOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await computeOilOverview(req)
    res.json(data)
  } catch (err) { next(err) }
}

/** GET /api/oil-change/overview/excel — overview jadvalini Excel'ga eksport */
export async function exportOilOverviewExcel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicles, defaults } = await computeOilOverview(req)

    const statusLabel: Record<string, string> = {
      ok: 'Yaxshi', due_soon: 'Yaqinlashdi', overdue: 'Kechikkan', no_data: "Ma'lumot yo'q",
    }
    const statusColor: Record<string, string> = {
      ok: 'FFD1FAE5', due_soon: 'FFFEF3C7', overdue: 'FFFEE2E2', no_data: 'FFF1F5F9',
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Moy almashtirish')

    ws.columns = [
      { header: 'Mashina', key: 'reg', width: 16 },
      { header: 'Marka/Model', key: 'model', width: 20 },
      { header: 'Hozirgi km', key: 'currentKm', width: 14 },
      { header: 'Oxirgi moy sana', key: 'lastDate', width: 16 },
      { header: 'Sanadagi odometr (km)', key: 'lastKm', width: 20 },
      { header: 'Interval (km)', key: 'interval', width: 14 },
      { header: 'Keyingi moy (km)', key: 'nextDue', width: 16 },
      { header: 'Qolgan (km)', key: 'remaining', width: 14 },
      { header: 'Foiz (%)', key: 'percent', width: 10 },
      { header: "Kunlik o'rt. (km)", key: 'avgDaily', width: 14 },
      { header: 'Taxminiy sana', key: 'predicted', width: 16 },
      { header: 'Holat', key: 'status', width: 14 },
    ]

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } }
    ws.getRow(1).height = 22

    for (const v of vehicles) {
      const row = ws.addRow({
        reg: v.registrationNumber,
        model: `${v.brand ?? ''} ${v.model ?? ''}`.trim(),
        currentKm: v.currentKm || 0,
        lastDate: v.lastServiceDate ? new Date(v.lastServiceDate).toLocaleDateString('uz-UZ') : '—',
        lastKm: v.lastServiceKm ?? '—',
        interval: v.effectiveIntervalKm,
        nextDue: v.nextDueKm ?? '—',
        remaining: v.remainingKm ?? '—',
        percent: v.percentUsed ?? '—',
        avgDaily: v.avgDailyKm ?? '—',
        predicted: v.predictedDueDate ? new Date(v.predictedDueDate).toLocaleDateString('uz-UZ') : '—',
        status: statusLabel[v.status] ?? v.status,
      })
      row.getCell('status').fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor[v.status] ?? 'FFFFFFFF' },
      }
    }

    ws.autoFilter = { from: 'A1', to: 'L1' }

    // Sarlavha izoh sifatida org standartini qo'shamiz
    ws.addRow({})
    ws.addRow({ reg: 'Org standarti:', model: `${defaults.oilIntervalKm} km / ogohlantirish ${defaults.oilWarningKm} km` })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="moy-almashtirish-${new Date().toISOString().slice(0, 10)}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

/** bulk-setup va Excel import uchun umumiy yadro — items ni qo'llab, saqlangan sonni qaytaradi */
async function applyOilBulkSetup(req: AuthRequest, items: any[], serviceType = 'oil_change'): Promise<number> {
    const filter = await getOrgFilter(req.user!)
    const orgId = await resolveOrgId(req.user!)
    const { intervalKm: defaultIntervalKm, warningKm: defaultWarningKm } = await getTypeDefaults(orgId, serviceType)
    const isOil = serviceType === 'oil_change'

    // Org GPS credential — sana orqali km derivatsiya qilish uchun
    const gpsCred = orgId
      ? await (prisma as any).gpsCredential.findUnique({ where: { orgId } })
      : null

    // 1) Barcha mashinalarni bitta so'rov bilan olamiz
    const vehicleIds = items.map((x: any) => x.vehicleId).filter(Boolean)
    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: { id: true, branchId: true, mileage: true, oilIntervalKm: true, gpsUnitName: true, registrationNumber: true },
    })
    const vehicleById = new Map(vehicles.map(v => [v.id, v]))

    // 2) GPS km ni parallel tortamiz (external API — eng sekin qism).
    // manualLastServiceKm berilgan bo'lsa GPS so'rovi qilinmaydi — odometr to'g'ridan-to'g'ri ishlatiladi.
    const preparedItems: Array<{ vehicleId: string; rawIntervalKm: number | null; lastServiceDate: string | null; gpsKmSinceService: number; manualLastServiceKm: number | null; vehicle: typeof vehicles[number] }> = []

    await Promise.all(items.map(async (item: any) => {
      const { vehicleId, intervalKm, lastServiceDate, lastServiceKm } = item
      const vehicle = vehicleById.get(vehicleId)
      if (!vehicle || !isBranchAllowed(filter, vehicle.branchId)) return
      const rawIntervalKm = intervalKm ? Number(intervalKm) : null
      if (rawIntervalKm !== null && (rawIntervalKm < 500 || rawIntervalKm > 50000)) return

      // Qo'lda kiritilgan odometr (moy almashgan sanadagi km)
      const manualLastServiceKm = lastServiceKm != null && Number(lastServiceKm) > 0
        ? Math.round(Number(lastServiceKm))
        : null

      let gpsKmSinceService = 0
      if (manualLastServiceKm == null && lastServiceDate && gpsCred?.isActive) {
        const lookupKey = (vehicle.gpsUnitName || vehicle.registrationNumber).trim().toUpperCase()
        try {
          const r = await getVehicleIntervalKm(gpsCred.id, lookupKey, new Date(lastServiceDate), new Date())
          gpsKmSinceService = r.km
        } catch { /* GPS bo'lmasa davom etamiz */ }
      }
      preparedItems.push({ vehicleId, rawIntervalKm, lastServiceDate: lastServiceDate || null, gpsKmSinceService, manualLastServiceKm, vehicle })
    }))

    // Har bir prepared item uchun saqlanadigan qiymatlarni hisoblaydi
    // (transaction va per-item fallback yo'llarida bir xil mantiq ishlatiladi)
    const computeFields = (p: typeof preparedItems[number]) => {
      const effectiveIntervalKm = p.rawIntervalKm ?? defaultIntervalKm
      let currentKm: number
      let derivedLastServiceKm: number
      if (p.manualLastServiceKm != null) {
        // Qo'lda kiritilgan odometr — to'g'ridan-to'g'ri oxirgi xizmat km
        derivedLastServiceKm = p.manualLastServiceKm
        currentKm = Math.max(Number(p.vehicle.mileage), p.manualLastServiceKm)
      } else {
        currentKm = Math.max(Number(p.vehicle.mileage), p.gpsKmSinceService)
        derivedLastServiceKm = Math.max(0, currentKm - p.gpsKmSinceService)
      }
      const nextDueKm = derivedLastServiceKm + effectiveIntervalKm
      let status: 'ok' | 'due_soon' | 'overdue' = 'ok'
      if (currentKm >= nextDueKm) status = 'overdue'
      else if (currentKm >= nextDueKm - defaultWarningKm) status = 'due_soon'
      const hasService = p.manualLastServiceKm != null || p.gpsKmSinceService > 0 || !!p.lastServiceDate
      const serviceKmVal = hasService ? derivedLastServiceKm : null
      const serviceDateVal = p.lastServiceDate ? new Date(p.lastServiceDate) : null
      return { effectiveIntervalKm, currentKm, nextDueKm, status, serviceKmVal, serviceDateVal }
    }

    // 3) Batch DB yozuvlari — har item uchun kerakli operationlarni yig'amiz
    const ops: any[] = []
    for (const p of preparedItems) {
      const { effectiveIntervalKm, currentKm, nextDueKm, status, serviceKmVal, serviceDateVal } = computeFields(p)

      ops.push(prisma.serviceInterval.upsert({
        where: { vehicleId_serviceType: { vehicleId: p.vehicleId, serviceType } },
        create: {
          vehicleId: p.vehicleId, serviceType,
          intervalKm: effectiveIntervalKm, intervalDays: 180, warningKm: defaultWarningKm,
          lastServiceKm: serviceKmVal, lastServiceDate: serviceDateVal,
          nextDueKm, status,
        },
        update: {
          intervalKm: effectiveIntervalKm,
          lastServiceKm: serviceKmVal, lastServiceDate: serviceDateVal,
          nextDueKm, status,
        },
      }))
      if (currentKm > Number(p.vehicle.mileage)) {
        ops.push(prisma.vehicle.update({ where: { id: p.vehicleId }, data: { mileage: currentKm } }))
      }
      // Per-vehicle interval override faqat oil_change uchun Vehicle.oilIntervalKm ga yoziladi.
      // Boshqa turlar uchun interval ServiceInterval.intervalKm da (yuqorida) saqlangan.
      if (isOil) {
        ops.push(prisma.vehicle.update({ where: { id: p.vehicleId }, data: { oilIntervalKm: p.rawIntervalKm } }))
      }
    }

    let saved = 0
    if (ops.length > 0) {
      try {
        await prisma.$transaction(ops)
        saved = preparedItems.length
      } catch (_) {
        // Tranzaksiya muvaffaqiyatsiz bo'lsa — per-item fallback (kichikroq portsiyalarda)
        for (const p of preparedItems) {
          try {
            const { effectiveIntervalKm, currentKm, nextDueKm, status, serviceKmVal, serviceDateVal } = computeFields(p)
            await prisma.serviceInterval.upsert({
              where: { vehicleId_serviceType: { vehicleId: p.vehicleId, serviceType } },
              create: {
                vehicleId: p.vehicleId, serviceType,
                intervalKm: effectiveIntervalKm, intervalDays: 180, warningKm: defaultWarningKm,
                lastServiceKm: serviceKmVal, lastServiceDate: serviceDateVal,
                nextDueKm, status,
              },
              update: {
                intervalKm: effectiveIntervalKm,
                lastServiceKm: serviceKmVal, lastServiceDate: serviceDateVal,
                nextDueKm, status,
              },
            })
            if (currentKm > Number(p.vehicle.mileage)) {
              await prisma.vehicle.update({ where: { id: p.vehicleId }, data: { mileage: currentKm } })
            }
            if (isOil) {
              await prisma.vehicle.update({ where: { id: p.vehicleId }, data: { oilIntervalKm: p.rawIntervalKm } })
            }
            saved++
          } catch { /* skip */ }
        }
      }
    }

    return saved
}

/** POST /api/oil-change/bulk-setup */
export async function bulkOilSetup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { items } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('items majburiy', 400)
    }
    const serviceType = resolveServiceType(req.body.serviceType)
    const saved = await applyOilBulkSetup(req, items, serviceType)
    res.json({ saved })
  } catch (err) { next(err) }
}

/**
 * GET /api/oil-change/import/template — ommaviy import uchun namuna Excel shabloni
 */
export async function downloadOilImportTemplate(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Moy import')
    ws.columns = [
      { header: 'Davlat raqami', key: 'reg', width: 18 },
      { header: 'Oxirgi moy sanasi (KK.OO.YYYY)', key: 'date', width: 28 },
      { header: 'Sanadagi odometr (km)', key: 'odo', width: 22 },
      { header: 'Interval (km, ixtiyoriy)', key: 'interval', width: 22 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } }
    ws.getRow(1).height = 22
    // Namuna qatorlar
    ws.addRow({ reg: '01A123BC', date: '11.06.2026', odo: 250000, interval: 10000 })
    ws.addRow({ reg: '01B456DE', date: '01.06.2026', odo: 180500, interval: '' })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="moy-import-shablon.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

// Excel katakdan sanani turlicha formatlarda o'qish (Date obyekti, ISO, KK.OO.YYYY)
function parseExcelDate(val: any): Date | null {
  if (val == null || val === '') return null
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val
  const s = String(val).trim()
  // KK.OO.YYYY yoki KK/OO/YYYY
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/**
 * POST /api/oil-change/import — Excel fayldan ommaviy moy sozlamasi.
 * Ustunlar: [Davlat raqami, Oxirgi moy sanasi, Sanadagi odometr, Interval(ixtiyoriy)].
 * Davlat raqami org mashinalariga moslashtiriladi; xato qatorlar hisoboti qaytadi.
 */
export async function importOilSetup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const file = (req as any).file
    if (!file?.buffer) throw new AppError('Fayl yuklanmadi', 400)
    const serviceType = resolveServiceType(req.body?.serviceType)

    // Org mashinalari: davlat raqami → vehicleId (faqat ruxsat etilgan filiallar)
    const filter = await getOrgFilter(req.user!)
    const where: any = { status: 'active' }
    const branchScope = applyBranchFilter(filter)
    if (branchScope !== undefined) where.branchId = branchScope
    const vehicles = await prisma.vehicle.findMany({ where, select: { id: true, registrationNumber: true } })
    const vehicleByReg = new Map(vehicles.map(v => [v.registrationNumber.trim().toUpperCase(), v.id]))

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(file.buffer)
    const ws = wb.worksheets[0]
    if (!ws) throw new AppError('Excel faylda varaq topilmadi', 400)

    const items: any[] = []
    const errors: Array<{ row: number; reg: string; reason: string }> = []

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return // sarlavha
      const regCell = row.getCell(1).value
      const reg = String(regCell ?? '').trim()
      if (!reg) return // bo'sh qator

      const vehicleId = vehicleByReg.get(reg.toUpperCase())
      if (!vehicleId) { errors.push({ row: rowNum, reg, reason: 'Mashina topilmadi' }); return }

      const date = parseExcelDate(row.getCell(2).value)
      const odoVal = row.getCell(3).value
      const odo = odoVal != null && odoVal !== '' ? Number(String(odoVal).replace(/[^\d.]/g, '')) : null
      const ivVal = row.getCell(4).value
      const interval = ivVal != null && ivVal !== '' ? Number(String(ivVal).replace(/[^\d.]/g, '')) : null

      if (!date && (odo == null || isNaN(odo))) {
        errors.push({ row: rowNum, reg, reason: 'Sana yoki odometr kerak' }); return
      }
      if (odo != null && (isNaN(odo) || odo < 0)) {
        errors.push({ row: rowNum, reg, reason: "Odometr noto'g'ri" }); return
      }
      if (interval != null && (isNaN(interval) || interval < 500 || interval > 50000)) {
        errors.push({ row: rowNum, reg, reason: 'Interval 500–50000 km bo\'lishi kerak' }); return
      }

      items.push({
        vehicleId,
        lastServiceDate: date ? date.toISOString() : undefined,
        lastServiceKm: odo != null && !isNaN(odo) ? odo : undefined,
        intervalKm: interval != null && !isNaN(interval) ? interval : undefined,
      })
    })

    const saved = items.length ? await applyOilBulkSetup(req, items, serviceType) : 0
    res.json({ saved, totalRows: items.length + errors.length, errorCount: errors.length, errors: errors.slice(0, 100) })
  } catch (err) { next(err) }
}

/** POST /api/oil-change/record */
export async function recordOilChange(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, servicedAtKm, servicedAt, technicianName, notes, cost, force } = req.body
    if (!vehicleId) throw new AppError('vehicleId majburiy', 400)
    const serviceType = resolveServiceType(req.body.serviceType)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) {
      throw new AppError("Ruxsat yo'q", 403)
    }

    const orgId = await resolveOrgId(req.user!)
    const { intervalKm: defaultIntervalKm, warningKm: defaultWarningKm } = await getTypeDefaults(orgId, serviceType)

    const km = servicedAtKm != null && Number(servicedAtKm) > 0
      ? Number(servicedAtKm)
      : Number(vehicle.mileage)
    if (km <= 0) throw new AppError('Xizmat bajarilgan km kiritilishi shart', 400)

    const date = servicedAt ? new Date(servicedAt) : new Date()

    // Mavjud interval — anomaliya tekshiruvi va (oil bo'lmagan turlar uchun) interval manbasi
    const existing = await prisma.serviceInterval.findUnique({
      where: { vehicleId_serviceType: { vehicleId, serviceType } },
      select: { lastServiceKm: true, intervalKm: true },
    })
    // oil_change → Vehicle.oilIntervalKm override; boshqa turlar → mavjud ServiceInterval.intervalKm
    const intervalKm = serviceType === 'oil_change'
      ? (vehicle.oilIntervalKm ?? defaultIntervalKm)
      : (existing?.intervalKm ?? defaultIntervalKm)
    const nextDueKm = km + intervalKm

    // ─── Anomaliya validatsiyasi (force:true bilan bypass qilinadi) ──────────────
    if (!force) {
      // 1) Probeg regressiyasi: yangi km oxirgi xizmat km'idan kichik — mantiqsiz
      if (existing?.lastServiceKm != null && km < existing.lastServiceKm) {
        return res.status(409).json({
          warning: 'km_regression',
          message: `Kiritilgan km (${km.toLocaleString()}) oxirgi xizmat km'idan (${existing.lastServiceKm.toLocaleString()}) kichik. Davom etilsinmi?`,
          detail: { entered: km, lastServiceKm: existing.lastServiceKm },
        })
      }

      // 2) Dublikat: shu mashina+tur uchun o'sha kunda yozuv allaqachon bor
      const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999)
      const dup = await prisma.serviceRecord.findFirst({
        where: { vehicleId, serviceType, servicedAt: { gte: dayStart, lte: dayEnd } },
        select: { id: true },
      })
      if (dup) {
        return res.status(409).json({
          warning: 'duplicate',
          message: `Bu mashinada ${dayStart.toLocaleDateString('uz-UZ')} sanasida bu xizmat allaqachon yozilgan. Yana qo'shilsinmi?`,
          detail: {},
        })
      }
    }

    const costNum = cost != null && Number(cost) > 0 ? Number(cost) : 0

    // vehicle.mileage ni eng yuqori ma'lum km ga yangilash (GPS tracking uchun to'g'ri baza)
    if (km > Number(vehicle.mileage)) {
      await prisma.vehicle.update({ where: { id: vehicleId }, data: { mileage: km } })
    }

    const interval = await prisma.serviceInterval.upsert({
      where: { vehicleId_serviceType: { vehicleId, serviceType } },
      create: {
        vehicleId,
        serviceType,
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
        serviceType,
        servicedAtKm: km,
        servicedAt: date,
        cost: costNum,
        technicianName: technicianName ?? null,
        notes: notes ?? null,
        nextDueKm,
        createdById: req.user?.id ?? null,
      },
    })

    res.json({ success: true, nextDueKm, intervalKm })
  } catch (err) { next(err) }
}

/**
 * GET /api/oil-change/km-at-date?vehicleId=&date=
 * GPS loglaridan berilgan sanaga eng yaqin km ni topadi.
 * Natija: o'sha sana km, bugungi km, yurgan km (farq).
 */
export async function getKmAtDate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, date } = req.query as { vehicleId: string; date: string }
    if (!vehicleId || !date) throw new AppError('vehicleId va date majburiy', 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) {
      throw new AppError("Ruxsat yo'q", 403)
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
  } catch (err) { next(err) }
}

/**
 * GET /api/oil-change/history?vehicleId=
 * Mashinaning moy almashtirish tarixi (ServiceRecord). Har yozuv uchun oldingi
 * almashtirishdan beri yurilgan km hisoblanadi (audit + tahlil uchun).
 */
export async function getOilHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.query as { vehicleId: string }
    if (!vehicleId) throw new AppError('vehicleId majburiy', 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) throw new AppError("Ruxsat yo'q", 403)

    const serviceType = resolveServiceType((req.query as any).serviceType)
    const records = await prisma.serviceRecord.findMany({
      where: { vehicleId, serviceType },
      orderBy: { servicedAt: 'desc' },
    })

    // Yaratuvchi foydalanuvchi ismlarini bitta so'rovda olamiz (N+1 yo'q)
    const creatorIds = [...new Set(records.map(r => r.createdById).filter((x): x is string => !!x))]
    const creators = creatorIds.length
      ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true } })
      : []
    const creatorName = new Map(creators.map(u => [u.id, u.fullName]))

    // Eng eskidan eng yangiga km farqini hisoblash uchun teskari tartibda yuramiz
    const asc = [...records].reverse()
    const kmSince = new Map<string, number | null>()
    for (let i = 0; i < asc.length; i++) {
      kmSince.set(asc[i].id, i === 0 ? null : asc[i].servicedAtKm - asc[i - 1].servicedAtKm)
    }

    const result = records.map(r => ({
      id: r.id,
      servicedAt: r.servicedAt,
      servicedAtKm: r.servicedAtKm,
      nextDueKm: r.nextDueKm,
      cost: Number(r.cost),
      technicianName: r.technicianName,
      notes: r.notes,
      createdByName: r.createdById ? creatorName.get(r.createdById) ?? null : null,
      kmSinceLast: kmSince.get(r.id) ?? null,
    }))

    res.json({ vehicleId, registrationNumber: vehicle.registrationNumber, records: result })
  } catch (err) { next(err) }
}

/**
 * GET /api/gps/vehicle-mileage-report?vehicleId=&from=&to=
 * Berilgan sana oralig'ida har bir GPS sync da yurgan km hisoboti.
 */
export async function getVehicleMileageReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, from, to } = req.query as { vehicleId: string; from: string; to: string }
    if (!vehicleId || !from || !to) throw new AppError('vehicleId, from, to majburiy', 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) {
      throw new AppError("Ruxsat yo'q", 403)
    }

    const fromDate = new Date(from); fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date(to); toDate.setHours(23, 59, 59, 999)
    const currentKm = Number(vehicle.mileage)

    // ─── 1-USUL: GPS XABARLARIDAN (token tarixidan mustaqil) ────────────────────
    // Bu so'ralgan davrning to'liqligini ta'minlaydi — hatto token keyin qo'yilgan
    // bo'lsa ham qurilma server tarixidan kunlik km tortiladi.
    const branch = await (prisma as any).branch.findUnique({
      where: { id: vehicle.branchId }, select: { organizationId: true },
    })
    const orgId = branch?.organizationId ?? vehicle.branchId
    const cred = await (prisma as any).gpsCredential.findUnique({
      where: { orgId }, select: { id: true, isActive: true },
    })

    let days: Array<{ date: string; km: number }> = []
    let totalKm = 0
    let source: 'gps_messages' | 'db_logs' = 'db_logs'
    let earliestGps: Date | null = null

    if (cred?.isActive) {
      const lookupKey = ((vehicle as any).gpsUnitName || vehicle.registrationNumber).trim()
      try {
        const r = await getVehicleDailyMileage(
          cred.id, lookupKey,
          Math.floor(fromDate.getTime() / 1000),
          Math.floor(toDate.getTime() / 1000),
        )
        if (r.days.length > 0) {
          days = r.days
          totalKm = r.totalKm
          source = 'gps_messages'
          earliestGps = r.earliestTs ? new Date(r.earliestTs * 1000) : null
        }
      } catch { /* Wialon ishlamasa — DB loglariga tushamiz */ }
    }

    // ─── 2-USUL (zaxira): DB sync loglari ───────────────────────────────────────
    if (days.length === 0) {
      const logs = await (prisma as any).gpsMileageLog.findMany({
        where: { vehicleId, skipped: false, syncedAt: { gte: fromDate, lte: toDate } },
        orderBy: { syncedAt: 'asc' },
      })
      const dailyMap: Record<string, number> = {}
      for (const log of logs) {
        const day = new Date(log.syncedAt).toISOString().slice(0, 10)
        const delta = Math.max(0, Number(log.gpsMileageKm) - Number(log.prevMileageKm))
        dailyMap[day] = (dailyMap[day] ?? 0) + delta
      }
      days = Object.entries(dailyMap).map(([date, km]) => ({ date, km: Math.round(km) }))
      totalKm = days.reduce((s, r) => s + r.km, 0)
      if (logs.length > 0) earliestGps = new Date(logs[0].syncedAt)
    }

    // So'ralgan boshlanish GPS tarixidan oldinmi? (mijozga halol ko'rsatish uchun)
    const requestedBeforeData = !!(earliestGps && earliestGps.getTime() > fromDate.getTime() + 24 * 3600000)

    res.json({
      vehicleId,
      registrationNumber: vehicle.registrationNumber,
      from: fromDate,
      to: toDate,
      totalKm,
      startKm: currentKm > 0 ? Math.max(0, currentKm - totalKm) : null,
      endKm: currentKm > 0 ? currentKm : null,
      days,
      syncCount: days.length,
      source,
      earliestGps,
      requestedBeforeData,
    })
  } catch (err) { next(err) }
}
