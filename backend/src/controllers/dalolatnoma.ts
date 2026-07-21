import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'

/**
 * GET /reports/dalolatnoma?branchId=&month=YYYY-MM[&official=1]
 * Bir filial (tashkilot/tuman) uchun o'sha oyda HAR MASHINA olgan ehtiyot qismlarni
 * OYLIK jamlaydi: har mashina uchun bitta dalolatnoma — shu oydagi barcha berishlar
 * bir joyda, qism nomi bo'yicha jamlangan (miqdor + summa). 450-mashina iyulda 3 marta
 * qism olgan bo'lsa ham — bitta iyul dalolatnomasida.
 * Filial rekvizitlari (rasmiy nom, rahbar, injener, STIR, manzil) har hujjat sarlavhasi uchun.
 *
 * Tenant izolatsiya: getOrgFilter + isBranchAllowed — foydalanuvchi faqat o'z
 * tashkilotidagi filiallar bo'yicha dalolatnoma ola oladi.
 */
export async function getPartsAct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId, month } = req.query as { branchId?: string; month?: string; official?: string }
    if (!branchId) throw new AppError('branchId majburiy', 400)
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new AppError('month formati: YYYY-MM', 400)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, branchId)) throw new AppError('Bu filialga kirish huquqingiz yo\'q', 403)

    const branch = await prisma.branch.findUnique({ where: { id: branchId } })
    if (!branch) throw new AppError('Filial topilmadi', 404)

    const [y, m] = month.split('-').map(Number)
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 1) // keyingi oy boshi (yarim ochiq oraliq)

    // Faqat tasdiqlangan yozuvlar. official=1 bo'lsa faqat rasmiy (buxgalteriya uchun).
    const onlyOfficial = req.query.official === '1'
    const raw = await prisma.maintenanceRecord.findMany({
      where: {
        vehicle: { branchId },
        installationDate: { gte: start, lt: end },
        status: 'approved',
        ...(onlyOfficial ? { isOfficial: true } : {}),
      },
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
        sparePart: { select: { name: true } },
        items: { include: { sparePart: { select: { name: true } } } },
      },
      orderBy: { installationDate: 'asc' },
    })

    // MASHINA bo'yicha guruhlaymiz; har mashina ichida qism NOMI bo'yicha jamlaymiz.
    interface VehAgg {
      vehicleId: string; registrationNumber: string; brand: string; model: string
      partMap: Map<string, { name: string; quantity: number; total: number }>
      eventCount: number; partsTotal: number
    }
    const vehMap = new Map<string, VehAgg>()
    let grandTotal = 0

    for (const r of raw) {
      if (!r.vehicle) continue
      const vId = r.vehicle.id
      let agg = vehMap.get(vId)
      if (!agg) {
        agg = {
          vehicleId: vId,
          registrationNumber: r.vehicle.registrationNumber,
          brand: r.vehicle.brand, model: r.vehicle.model,
          partMap: new Map(), eventCount: 0, partsTotal: 0,
        }
        vehMap.set(vId, agg)
      }
      agg.eventCount++

      const lines = (r.items && r.items.length > 0)
        ? r.items.map(it => ({ name: it.sparePart?.name || 'Nomsiz qism', qty: it.quantityUsed || 0, lineTotal: Number(it.unitCost) * (it.quantityUsed || 0) }))
        : (r.sparePart ? [{ name: r.sparePart.name, qty: r.quantityUsed || 0, lineTotal: Number(r.cost) * (r.quantityUsed || 0) }] : [])

      for (const ln of lines) {
        const key = ln.name.trim()
        const g = agg.partMap.get(key) || { name: key, quantity: 0, total: 0 }
        g.quantity += ln.qty
        g.total += ln.lineTotal
        agg.partMap.set(key, g)
        agg.partsTotal += ln.lineTotal
        grandTotal += ln.lineTotal
      }
    }

    const vehicles = [...vehMap.values()]
      .map(v => ({
        vehicleId: v.vehicleId,
        registrationNumber: v.registrationNumber,
        brand: v.brand, model: v.model,
        parts: [...v.partMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
        partTypeCount: v.partMap.size,
        eventCount: v.eventCount,
        partsTotal: v.partsTotal,
      }))
      .sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber))

    res.json(successResponse({
      branch: {
        id: branch.id,
        name: branch.name,
        officialName: (branch as any).officialName || null,
        stir: (branch as any).stir || null,
        docAddress: (branch as any).docAddress || null,
        directorName: (branch as any).directorName || null,
        engineerName: (branch as any).engineerName || null,
        receiverOrgName: (branch as any).receiverOrgName || null,
        receiverName: (branch as any).receiverName || null,
        receiverPosition: (branch as any).receiverPosition || null,
      },
      month,
      vehicles,
      vehicleCount: vehicles.length,
      grandTotal,
    }))
  } catch (err) { next(err) }
}
