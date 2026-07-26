import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getCurrentMonth } from '../lib/months'
import { computeEntityDebt, sumPaymentsByMonth } from '../lib/debtMath'

// Ro'yxat/xarita so'rovlari uchun cheklovlar. Katta shaharda (5-10 ming tashkilot)
// cheklovsiz so'rov serverni ham, brauzerni ham bo'g'adi. Cheklov oshsa javobda
// `meta.truncated` qaytadi va UI foydalanuvchiga tuman/mahalla tanlashni taklif qiladi.
const DAILY_LIST_DEFAULT = 300
const DAILY_LIST_MAX = 1000
const MAP_DEFAULT = 2000
const MAP_MAX = 5000

function clampLimit(raw: unknown, def: number, max: number): number {
  const n = parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(n, max)
}

/**
 * "Qarzdor" tashkilot shartini beradi — bitta indeksli COUNT so'rovi uchun.
 * Ro'yxat kesilgan bo'lsa ham KPI raqamlari to'liq bazadan hisoblanishi uchun kerak.
 *
 * Qarzdor deb hisoblanadi:
 *  - ochiq/qisman hisobi (charge) bor — monthly_fixed, qisman to'lov ham shunga tushadi
 *    (to'lov qabul qilinganda charge avtomatik yaratiladi/yangilanadi);
 *  - talon rejimida to'lanmagan taloni bor;
 *  - monthly_fixed, oylik summasi bor, lekin shu oyda umuman to'lov yo'q.
 */
function debtorCondition(currentMonth: string): any {
  return {
    OR: [
      { charges: { some: { status: { in: ['open', 'partial'] } } } },
      { billingMode: 'talon', talons: { some: { paid: false } } },
      {
        billingMode: 'monthly_fixed',
        monthlyFee: { gt: 0 },
        payments: { none: { month: currentMonth } },
      },
    ],
  }
}

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
    const limit = clampLimit(req.query.limit, DAILY_LIST_DEFAULT, DAILY_LIST_MAX)

    // Qarzdorlar umumiy soni — ro'yxat kesilgan bo'lsa ham KPI to'g'ri qolishi uchun
    // alohida indeksli COUNT bilan olinadi (barcha qatorni yuklamasdan).
    const totalDebtors = await (prisma as any).ekoHisobLegalEntity.count({
      where: { ...entityWhere, ...debtorCondition(currentMonth) },
    })

    // Ro'yxat uchun faqat QARZDOR tashkilotlar yuklanadi (ilgari BARCHA faol
    // tashkilot nested bog'lanishlari bilan yuklanardi) va cheklov qo'yiladi.
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { ...entityWhere, ...debtorCondition(currentMonth) },
      take: limit,
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

    // Bugun to'langanlar — tanlangan filtr ichidagi tashkilotlar, paidAt = bugun.
    // Tashkilot id ro'yxati bo'yicha emas, bog'lanish filtri orqali: qarzdorlar
    // ro'yxati kesilgan bo'lsa ham bugungi to'lovlar to'liq ko'rinadi.
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const paidTodayRows = await (prisma as any).ekoHisobPayment.findMany({
      where: {
        entity: entityWhere,
        paidAt: { gte: startOfDay },
      },
      include: { entity: { select: { id: true, name: true, address: true } } },
      orderBy: { paidAt: 'desc' },
      take: 200,
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
        // Ko'rsatilgan qarzdorlar soni (ro'yxatdagi)
        totalUnpaid: unpaidEntities.length,
        // Bazadagi umumiy qarzdorlar soni — ro'yxat kesilgan bo'lsa ham to'g'ri
        totalDebtors,
        paidToday,
      },
      meta: {
        limit,
        truncated: totalDebtors > entities.length,
        shown: entities.length,
      },
    })
  } catch (err) { next(err) }
}

export async function getMapData(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const currentMonth = getCurrentMonth()
    const limit = clampLimit(req.query.limit, MAP_DEFAULT, MAP_MAX)

    const entityWhere: any = {
      orgId,
      lat: { not: null },
      lon: { not: null },
      status: { not: 'inactive' },   // draft (chala) ham xaritada — alohida belgi bilan
    }

    if (role !== 'admin') {
      entityWhere.districtId = { in: districtIds }
    }

    // Xarita oynasi (bbox) — foydalanuvchi ko'rayotgan hudud. Butun shaharni
    // birdan yuklamaslik uchun: xarita siljiganda faqat ko'rinadigan qism so'raladi.
    const { minLat, maxLat, minLon, maxLon } = req.query
    if (minLat && maxLat) {
      entityWhere.lat = { gte: parseFloat(String(minLat)), lte: parseFloat(String(maxLat)) }
    }
    if (minLon && maxLon) {
      entityWhere.lon = { gte: parseFloat(String(minLon)), lte: parseFloat(String(maxLon)) }
    }
    if (req.query.districtId) {
      const d = String(req.query.districtId)
      if (role !== 'admin' && !districtIds.includes(d)) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      entityWhere.districtId = d
    }

    const totalInScope = await (prisma as any).ekoHisobLegalEntity.count({ where: entityWhere })

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      take: limit,
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

    res.json({
      success: true,
      data: result,
      meta: { limit, shown: result.length, total: totalInScope, truncated: totalInScope > result.length },
    })
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

    const activeWhere = { ...entityWhere, status: 'active' }

    // Hammasi indeksli agregat/COUNT so'rovlar — bitta ham tashkilot qatori
    // xotiraga yuklanmaydi. Ilgari barcha faol tashkilot nested payments/charges/
    // talons bilan o'qilardi: 10 ming tashkilotli shaharda bu ishlamas edi.
    const [
      total, blacklisted, paidThisMonth, unpaidThisMonth,
      collectedResult, openCharges, unpaidTalons,
    ] = await Promise.all([
      (prisma as any).ekoHisobLegalEntity.count({ where: activeWhere }),
      (prisma as any).ekoHisobLegalEntity.count({
        where: { ...entityWhere, status: 'blacklisted' },
      }),
      // Shu oyda kamida bitta to'lov qilgan tashkilotlar soni (EXISTS)
      (prisma as any).ekoHisobLegalEntity.count({
        where: { ...activeWhere, payments: { some: { month: currentMonth } } },
      }),
      // Haqiqiy qarzdorlar soni. Ilgari `total − paidThisMonth` edi — talon va
      // o'zgaruvchan tashkilotlar qarzi bo'lmasa ham "to'lamagan" deb sanalardi.
      (prisma as any).ekoHisobLegalEntity.count({
        where: { ...activeWhere, ...debtorCondition(currentMonth) },
      }),
      (prisma as any).ekoHisobPayment.aggregate({
        where: { entity: activeWhere, month: currentMonth },
        _sum: { amount: true },
      }),
      (prisma as any).ekoHisobCharge.aggregate({
        where: { entity: activeWhere, status: { in: ['open', 'partial'] } },
        _sum: { expectedAmount: true, paidAmount: true },
      }),
      (prisma as any).ekoHisobTalon.aggregate({
        where: { entity: activeWhere, paid: false },
        _sum: { amount: true },
      }),
    ])

    const collectedAmount = collectedResult._sum.amount || 0
    // Jami qarz = ochiq hisoblardagi qoldiq + to'lanmagan talonlar
    const chargeDebt = Math.max(0,
      (openCharges._sum.expectedAmount || 0) - (openCharges._sum.paidAmount || 0))
    const totalDebt = chargeDebt + (unpaidTalons._sum.amount || 0)

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
