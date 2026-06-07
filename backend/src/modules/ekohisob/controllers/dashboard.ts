import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getCurrentMonth } from '../lib/months'

/**
 * GET /dashboard/onboarding — yangi korxona sozlash holati (checklist uchun).
 * Tuman, inspektor/boshliq va tashkilot bor-yo'qligini qaytaradi.
 */
export async function getOnboardingStatus(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const [districts, mahallas, inspectors, entities] = await Promise.all([
      (prisma as any).ekoHisobDistrict.count({ where: { orgId } }),
      (prisma as any).ekoHisobMahalla.count({ where: { district: { orgId } } }),
      (prisma as any).ekoHisobUser.count({ where: { orgId, role: { in: ['inspector', 'supervisor'] } } }),
      (prisma as any).ekoHisobLegalEntity.count({ where: { orgId } }),
    ])
    res.json({ success: true, data: { districts, mahallas, inspectors, entities } })
  } catch (err) { next(err) }
}

export async function getDailyList(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { districtId, mahallId, month = getCurrentMonth() } = req.query

    const entityWhere: any = {
      orgId,
      status: 'active',
    }

    // District filter
    if (role !== 'admin') {
      entityWhere.districtId = { in: districtIds }
    }
    if (districtId) {
      if (role !== 'admin' && !districtIds.includes(String(districtId))) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      entityWhere.districtId = String(districtId)
    }
    if (mahallId) {
      entityWhere.mahallId = String(mahallId)
    }

    const currentMonth = String(month)

    // Get all active entities + this-month payment + open/partial charges (debt months)
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      include: {
        mahalla: { select: { id: true, name: true } },
        payments: {
          where: { month: currentMonth },
          select: { id: true, amount: true, paidAt: true },
        },
        charges: {
          where: { status: { in: ['open', 'partial'] } },
          select: { month: true, expectedAmount: true, paidAmount: true },
        },
      },
      orderBy: [
        { mahallId: 'asc' },
        { name: 'asc' },
      ],
    })

    // Tanlangan oy uchun to'lov qilmaganlar (qisman to'laganlar ham — qarz qolgan bo'lsa)
    const unpaidEntities = entities.filter((e: any) => {
      // talon rejimi — oylik to'lov yo'q, alohida talon bo'limida boshqariladi
      if (e.billingMode === 'talon') return false
      const totalPaid = e.payments.reduce((s: number, p: any) => s + p.amount, 0)
      if (e.billingMode === 'monthly_fixed') {
        return totalPaid < (e.monthlyFee || 0)
      }
      // variable: umuman to'lamagan bo'lsa qarzdor
      return e.payments.length === 0
    })

    // Group by mahalla → { mahallId, mahallName, entities: [...] }
    const grouped: Record<string, any> = {}
    for (const entity of unpaidEntities) {
      const key = entity.mahallId || '__no_mahalla__'
      if (!grouped[key]) {
        grouped[key] = {
          mahallId: entity.mahalla?.id ?? '__no_mahalla__',
          mahallName: entity.mahalla?.name ?? 'Mahallasiz',
          entities: [],
        }
      }

      // unpaidMonths: monthly_fixed → ochiq/qisman charge oylari (qarz). variable → faqat shu oy.
      let unpaidMonths: string[]
      let debtAmount = 0
      if (entity.billingMode === 'monthly_fixed' && entity.charges.length > 0) {
        unpaidMonths = entity.charges.map((c: any) => c.month).sort()
        debtAmount = entity.charges.reduce(
          (s: number, c: any) => s + Math.max(0, c.expectedAmount - c.paidAmount), 0
        )
        if (!unpaidMonths.includes(currentMonth)) unpaidMonths.push(currentMonth)
        unpaidMonths.sort()
      } else {
        unpaidMonths = [currentMonth]
      }

      grouped[key].entities.push({
        id: entity.id,
        name: entity.name,
        address: entity.address,
        monthlyFee: entity.monthlyFee,
        billingMode: entity.billingMode,
        unpaidMonths,
        debtAmount,
      })
    }

    // Bugun to'langanlar — tanlangan filtr ichidagi tashkilotlar, paidAt = bugun
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const orgEntityIds = entities.map((e: any) => e.id)
    const paidTodayRows = await (prisma as any).ekoHisobPayment.findMany({
      where: {
        entityId: { in: orgEntityIds },
        paidAt: { gte: startOfDay },
      },
      include: { entity: { select: { id: true, name: true, address: true } } },
      orderBy: { paidAt: 'desc' },
    })
    const paidToday = paidTodayRows.map((p: any) => ({
      id: p.entity.id,
      name: p.entity.name,
      address: p.entity.address,
      monthlyFee: p.amount,
      month: p.month,
    }))

    res.json({
      success: true,
      data: {
        month: currentMonth,
        groups: Object.values(grouped),
        totalUnpaid: unpaidEntities.length,
        paidToday,
      },
    })
  } catch (err) { next(err) }
}

export async function getMapData(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const currentMonth = getCurrentMonth()

    const entityWhere: any = {
      orgId,
      lat: { not: null },
      lon: { not: null },
      status: { not: 'inactive' },   // draft (chala) ham xaritada — alohida belgi bilan
    }

    if (role !== 'admin') {
      entityWhere.districtId = { in: districtIds }
    }

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      select: {
        id: true,
        name: true,
        address: true,
        lat: true,
        lon: true,
        status: true,
        districtId: true,
        monthlyFee: true,
        billingMode: true,
        payments: {
          where: { month: currentMonth },
          select: { id: true },
        },
        // Ochiq/qisman to'langan hisoblar — qarz oylar soni uchun
        charges: {
          where: { status: { in: ['open', 'partial'] } },
          select: { month: true },
        },
      },
    })

    const result = entities.map((e: any) => {
      const paidThisMonth = e.payments.length > 0
      // monthly_fixed → ochiq charges soni; variable → shu oy to'lanmagan bo'lsa 1
      let debtMonths = 0
      if (e.billingMode === 'monthly_fixed') {
        debtMonths = e.charges.length
      } else if (!paidThisMonth) {
        debtMonths = 1
      }
      return {
        id: e.id,
        name: e.name,
        address: e.address,
        lat: e.lat,
        lon: e.lon,
        status: e.status,
        districtId: e.districtId,
        monthlyFee: e.monthlyFee,
        paidThisMonth,
        debtMonths,
      }
    })

    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

export async function getStats(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const currentMonth = getCurrentMonth()

    const entityWhere: any = { orgId }
    if (role !== 'admin') {
      entityWhere.districtId = { in: districtIds }
    }

    const [total, blacklisted] = await Promise.all([
      (prisma as any).ekoHisobLegalEntity.count({
        where: { ...entityWhere, status: 'active' },
      }),
      (prisma as any).ekoHisobLegalEntity.count({
        where: { ...entityWhere, status: 'blacklisted' },
      }),
    ])

    // Get entities IDs for payment queries
    const orgEntities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { ...entityWhere, status: 'active' },
      select: { id: true },
    })
    const entityIds = orgEntities.map((e: any) => e.id)

    // Bu oy to'lov qilgan TASHKILOTLAR soni — distinct entityId
    // (qisman to'lov bilan bir oyga bir necha yozuv bo'lishi mumkin, shuning uchun count emas)
    const paidRows = await (prisma as any).ekoHisobPayment.findMany({
      where: { entityId: { in: entityIds }, month: currentMonth },
      select: { entityId: true },
      distinct: ['entityId'],
    })
    const paidThisMonth = paidRows.length

    // Sum collected amount this month (barcha to'lovlar yig'indisi)
    const collectedResult = await (prisma as any).ekoHisobPayment.aggregate({
      where: { entityId: { in: entityIds }, month: currentMonth },
      _sum: { amount: true },
    })
    const collectedAmount = collectedResult._sum.amount || 0

    res.json({
      success: true,
      data: {
        month: currentMonth,
        total,
        totalEntities: total,
        paidThisMonth,
        unpaidThisMonth: total - paidThisMonth,
        blacklisted,
        collectedAmount,
      },
    })
  } catch (err) { next(err) }
}
