import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { resolveOrgId } from '../lib/orgFilter'

const VALID_FUEL_TYPES = ['petrol', 'diesel', 'gas', 'electric', 'hybrid']

/**
 * GET /fuel-prices
 * Tashkilot uchun barcha narx tarixi (so'nggi 50 ta, yangi → eski)
 */
export async function getFuelPrices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 400)

    const prices = await prisma.fuelPriceHistory.findMany({
      where: { organizationId: orgId },
      orderBy: [{ fuelType: 'asc' }, { effectiveFrom: 'desc' }],
      take: 100,
    })
    res.json(successResponse(prices))
  } catch (err) { next(err) }
}

/**
 * GET /fuel-prices/current?date=YYYY-MM-DD
 * Har bir yoqilg'i turi uchun joriy (yoki ko'rsatilgan sana bo'yicha) narx.
 * Response: { gas: { pricePerUnit, effectiveFrom }, petrol: {...}, ... }
 */
export async function getCurrentFuelPrices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 400)
    const dateStr = req.query.date as string | undefined
    const date = dateStr ? new Date(dateStr) : new Date()

    // Har bir fuelType uchun effectiveFrom <= date eng katta yozuv
    const rows = await prisma.$queryRaw<Array<{
      fuelType: string; pricePerUnit: string; effectiveFrom: Date; id: string
    }>>`
      SELECT DISTINCT ON ("fuelType")
        "id", "fuelType", "pricePerUnit", "effectiveFrom"
      FROM "fuel_price_history"
      WHERE "organizationId" = ${orgId}
        AND "effectiveFrom" <= ${date}
      ORDER BY "fuelType", "effectiveFrom" DESC
    `

    const result: Record<string, { id: string; pricePerUnit: number; effectiveFrom: string }> = {}
    for (const r of rows) {
      result[r.fuelType] = {
        id: r.id,
        pricePerUnit: Number(r.pricePerUnit),
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
      }
    }
    res.json(successResponse(result))
  } catch (err) { next(err) }
}

/**
 * POST /fuel-prices
 * Yangi narx qo'shish (admin/manager)
 * body: { fuelType, pricePerUnit, effectiveFrom, note? }
 */
export async function createFuelPrice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fuelType, pricePerUnit, effectiveFrom, note } = req.body
    if (!fuelType || !VALID_FUEL_TYPES.includes(fuelType))
      throw new AppError('Yoqilg\'i turi noto\'g\'ri', 400)
    const price = parseFloat(pricePerUnit)
    if (isNaN(price) || price <= 0)
      throw new AppError('Narx musbat son bo\'lishi kerak', 400)
    if (!effectiveFrom || isNaN(new Date(effectiveFrom).getTime()))
      throw new AppError('Sana noto\'g\'ri', 400)

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 400)

    const entry = await prisma.fuelPriceHistory.create({
      data: {
        organizationId: orgId,
        fuelType,
        pricePerUnit: price,
        effectiveFrom: new Date(effectiveFrom),
        note: note?.trim() || null,
        createdById: req.user!.id,
      },
    })
    res.status(201).json(successResponse(entry, 'Narx qo\'shildi'))
  } catch (err) { next(err) }
}

/**
 * DELETE /fuel-prices/:id
 * Narx yozuvini o'chirish (faqat admin)
 */
export async function deleteFuelPrice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 400)
    const entry = await prisma.fuelPriceHistory.findUnique({ where: { id: req.params.id } })
    if (!entry || entry.organizationId !== orgId)
      throw new AppError('Yozuv topilmadi', 404)
    await prisma.fuelPriceHistory.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'O\'chirildi'))
  } catch (err) { next(err) }
}
