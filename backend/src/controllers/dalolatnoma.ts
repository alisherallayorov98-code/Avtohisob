import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'

/**
 * GET /reports/dalolatnoma?branchId=&month=YYYY-MM[&official=1]
 * Bir filial (tashkilot/tuman) uchun o'sha oydagi HAR BIR ehtiyot qism berish
 * hodisasi (bitta mashina + bitta sana + o'sha partiyada berilgan qismlar) alohida
 * dalolatnoma sifatida qaytadi. Har hodisa = bitta tasdiqlangan ta'mirlash yozuvi.
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
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
        sparePart: { select: { name: true } },
        performedBy: { select: { fullName: true } },
        items: { include: { sparePart: { select: { name: true } } } },
      },
      orderBy: { installationDate: 'desc' },
    })

    // Har yozuv = bitta dalolatnoma (partiya). Ichidagi qismlarni birga chiqaramiz.
    let grandTotal = 0
    const records = raw.map(r => {
      const items = (r.items && r.items.length > 0)
        ? r.items.map(it => ({
            name: it.sparePart?.name || 'Nomsiz qism',
            quantity: it.quantityUsed || 0,
            unitCost: Number(it.unitCost),
            total: Number(it.unitCost) * (it.quantityUsed || 0),
          }))
        : (r.sparePart
            ? [{ name: r.sparePart.name, quantity: r.quantityUsed || 0, unitCost: Number(r.cost), total: Number(r.cost) * (r.quantityUsed || 0) }]
            : [])
      const partsTotal = items.reduce((s, it) => s + it.total, 0)
      const laborCost = Number(r.laborCost) || 0
      const total = partsTotal + laborCost
      grandTotal += total
      return {
        id: r.id,
        docNo: `DL-${r.id.slice(0, 8).toUpperCase()}`,
        date: r.installationDate,
        vehicle: r.vehicle
          ? { registrationNumber: r.vehicle.registrationNumber, brand: r.vehicle.brand, model: r.vehicle.model }
          : null,
        worker: r.workerName || r.performedBy?.fullName || null,
        notes: r.notes || null,
        items,
        partsTotal,
        laborCost,
        total,
      }
    })

    res.json(successResponse({
      branch: {
        id: branch.id,
        name: branch.name,
        officialName: (branch as any).officialName || null,
        stir: (branch as any).stir || null,
        docAddress: (branch as any).docAddress || null,
        directorName: (branch as any).directorName || null,
        engineerName: (branch as any).engineerName || null,
      },
      month,
      records,
      recordCount: records.length,
      grandTotal,
    }))
  } catch (err) { next(err) }
}
