import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getCurrentMonth } from '../lib/months'
import { computeEntityDebt, sumPaymentsByMonth } from '../lib/debtMath'

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

    // Barcha faol tashkilotlar + shu oy to'lovlari + ochiq hisoblar + to'lanmagan talonlar.
    // Talonlar ham yuklanadi: talon rejimidagi tashkilotlar ilgari kunlik ro'yxatga
    // umuman tushmasdi — qarzi bo'lsa ham hech kim ularni ta'qib qilmasdi.
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      include: {
        mahalla: { select: { id: true, name: true } },
        payments: {
          where: { month: currentMonth },
          select: { id: true, month: true, amount: true, paidAt: true },
        },
        charges: {
          where: { status: { in: ['open', 'partial'] } },
          select: { month: true, expectedAmount: true, paidAmount: true },
        },
        talons: {
          where: { paid: false },
          select: { date: true, amount: true, paid: true },
        },
      },
      orderBy: [
        { mahallId: 'asc' },
        { name: 'asc' },
      ],
    })

    // Har tashkilot uchun qarz — yagona kanonik funksiyadan (debtMath)
    const withDebt = entities.map((e: any) => ({
      entity: e,
      debt: computeEntityDebt({
        billingMode: e.billingMode,
        charges: e.charges,
        talons: e.talons,
        currentMonth,
        paidCurrentMonth: sumPaymentsByMonth(e.payments).has(currentMonth),
      }),
    }))

    // Qarzdorlar: monthly_fixed/talon → qarz qolgan oy bor; variable → shu oy to'lamagan.
    // monthly_fixed uchun joriy oy hali charge yaratilmagan bo'lsa ham ro'yxatga qo'shiladi.
    const unpaidEntities = withDebt.filter(({ entity, debt }: { entity: any; debt: any }) => {
      if (entity.billingMode === 'monthly_fixed') {
        const paidThisMonth = sumPaymentsByMonth(entity.payments).get(currentMonth)?.paid ?? 0
        return debt.debtMonths > 0 || paidThisMonth < (entity.monthlyFee || 0)
      }
      return debt.debtMonths > 0
    })

    // Group by mahalla → { mahallId, mahallName, entities: [...] }
    const grouped: Record<string, any> = {}
    for (const { entity, debt } of unpaidEntities) {
      const key = entity.mahallId || '__no_mahalla__'
      if (!grouped[key]) {
        grouped[key] = {
          mahallId: entity.mahalla?.id ?? '__no_mahalla__',
          mahallName: entity.mahalla?.name ?? 'Mahallasiz',
          entities: [],
        }
      }

      const unpaidMonths = [...debt.unpaidMonths]
      let debtAmount = debt.totalDebt
      // monthly_fixed: joriy oy hisobi hali yaratilmagan bo'lsa ham to'lash kerak
      if (entity.billingMode === 'monthly_fixed' && !unpaidMonths.includes(currentMonth)) {
        const paidThisMonth = sumPaymentsByMonth(entity.payments).get(currentMonth)?.paid ?? 0
        const remaining = Math.max(0, (entity.monthlyFee || 0) - paidThisMonth)
        if (remaining > 0) {
          unpaidMonths.push(currentMonth)
          debtAmount += remaining
        }
        unpaidMonths.sort()
      }

      grouped[key].entities.push({
        id: entity.id,
        name: entity.name,
        address: entity.address,
        monthlyFee: entity.monthlyFee,
        cubicPrice: entity.cubicPrice,
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
          select: { id: true, month: true, amount: true },
        },
        // Ochiq/qisman to'langan hisoblar — qarz oylar soni uchun
        charges: {
          where: { status: { in: ['open', 'partial'] } },
          select: { month: true, expectedAmount: true, paidAmount: true },
        },
        // To'lanmagan talonlar — talon rejimidagi tashkilot qarzi xaritada ham ko'rinsin
        talons: {
          where: { paid: false },
          select: { date: true, amount: true, paid: true },
        },
      },
    })

    const result = entities.map((e: any) => {
      const paidThisMonth = e.payments.length > 0
      // Uchala rejim uchun bir xil hisob — debtMath (ilgari talon qarzi xaritada ko'rinmasdi)
      const debt = computeEntityDebt({
        billingMode: e.billingMode,
        charges: e.charges,
        talons: e.talons,
        currentMonth,
        paidCurrentMonth: paidThisMonth,
      })
      return {
        id: e.id,
        name: e.name,
        address: e.address,
        lat: e.lat,
        lon: e.lon,
        status: e.status,
        districtId: e.districtId,
        monthlyFee: e.monthlyFee,
        billingMode: e.billingMode,
        paidThisMonth,
        debtMonths: debt.debtMonths,
        debtAmount: debt.totalDebt,
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

    // Faol tashkilotlar + qarz manbalari (bitta so'rovda — qarzni to'g'ri hisoblash uchun)
    const orgEntities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { ...entityWhere, status: 'active' },
      select: {
        id: true, billingMode: true, monthlyFee: true,
        payments: { where: { month: currentMonth }, select: { month: true, amount: true } },
        charges: {
          where: { status: { in: ['open', 'partial'] } },
          select: { month: true, expectedAmount: true, paidAmount: true },
        },
        talons: { where: { paid: false }, select: { date: true, amount: true, paid: true } },
      },
    })
    const entityIds = orgEntities.map((e: any) => e.id)

    // Bu oy to'lov qilgan TASHKILOTLAR soni + jami qarz.
    // Ilgari unpaidThisMonth = total − paidThisMonth edi: talon va o'zgaruvchan
    // tashkilotlar ham "qarzdor" deb sanalardi. Endi haqiqiy qarzga qaraladi.
    let paidThisMonth = 0
    let unpaidThisMonth = 0
    let totalDebt = 0
    for (const e of orgEntities) {
      const paidMap = sumPaymentsByMonth(e.payments)
      const paidNow = paidMap.get(currentMonth)?.paid ?? 0
      if (paidNow > 0) paidThisMonth++

      const debt = computeEntityDebt({
        billingMode: e.billingMode,
        charges: e.charges,
        talons: e.talons,
        currentMonth,
        paidCurrentMonth: paidNow > 0,
      })
      totalDebt += debt.totalDebt

      const owesThisMonth = e.billingMode === 'monthly_fixed'
        ? paidNow < (e.monthlyFee || 0)
        : debt.debtMonths > 0
      if (owesThisMonth) unpaidThisMonth++
    }

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
        unpaidThisMonth,
        blacklisted,
        collectedAmount,
        totalDebt,
      },
    })
  } catch (err) { next(err) }
}
