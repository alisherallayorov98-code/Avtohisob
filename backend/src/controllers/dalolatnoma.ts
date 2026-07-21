import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'

/**
 * GET /reports/dalolatnoma?branchId=&month=YYYY-MM[&official=1]
 * Bir filial (tashkilot/tuman) uchun o'sha oyda ta'mirlashda ISHLATILGAN ehtiyot
 * qismlarining oylik jamlanma dalolatnomasi. Har qism nomi bo'yicha jamlanadi.
 * Filial rekvizitlari (rasmiy nom, rahbar, injener, STIR, manzil) hujjat uchun qaytadi.
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
    const records = await prisma.maintenanceRecord.findMany({
      where: {
        vehicle: { branchId },
        installationDate: { gte: start, lt: end },
        status: 'approved',
        ...(onlyOfficial ? { isOfficial: true } : {}),
      },
      include: {
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
        sparePart: { select: { name: true } },
        items: { include: { sparePart: { select: { name: true } } } },
      },
      orderBy: { installationDate: 'asc' },
    })

    // Qismlarni NOMI bo'yicha jamlaymiz: { nomi, jami miqdor, jami summa }
    const partMap = new Map<string, { name: string; quantity: number; total: number }>()
    const vehicleSet = new Set<string>()
    let grandTotal = 0

    const addPart = (name: string | undefined, qty: number, lineTotal: number) => {
      const key = (name || 'Nomsiz qism').trim()
      const g = partMap.get(key) || { name: key, quantity: 0, total: 0 }
      g.quantity += qty
      g.total += lineTotal
      partMap.set(key, g)
      grandTotal += lineTotal
    }

    for (const r of records) {
      if (r.vehicle) vehicleSet.add(r.vehicle.registrationNumber)
      if (r.items && r.items.length > 0) {
        for (const it of r.items) {
          const qty = it.quantityUsed || 0
          addPart(it.sparePart?.name, qty, Number(it.unitCost) * qty)
        }
      } else if (r.sparePart) {
        // Eski (items'siz) yozuvlar uchun moslik
        const qty = r.quantityUsed || 0
        addPart(r.sparePart.name, qty, Number(r.cost) * qty)
      }
    }

    const parts = [...partMap.values()].sort((a, b) => a.name.localeCompare(b.name))

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
      parts,
      grandTotal,
      partTypeCount: parts.length,
      vehicleCount: vehicleSet.size,
      recordCount: records.length,
    }))
  } catch (err) { next(err) }
}
