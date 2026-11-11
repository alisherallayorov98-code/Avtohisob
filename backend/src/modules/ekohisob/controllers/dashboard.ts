import { Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getCurrentMonth, isValidMonth } from '../lib/months'
import { computeEntityDebt } from '../lib/debtMath'
import { ScopeUser, entityScopeWhere, canAccessDistrict } from '../lib/ekoScope'
import { dayBoundsUz, monthBoundsUz, todayUz } from '../lib/uzt'
import { summarizeDebt } from '../lib/debtSummary'
import { queryDailyDebtors, queryDebtGroups, queryEntityDebts } from '../lib/reportQueries'

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

function scopeOf(req: EkoRequest): ScopeUser {
  const u = req.ekoUser!
  return { role: u.role, orgId: u.orgId, districtIds: u.districtIds ?? [] }
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

/**
 * GET /dashboard/daily — bugungi qarzdorlar ro'yxati.
 *
 * Qarzdor qoidasi (ro'yxat va `getStats` uchun BIR XIL — reportQueries.queryDailyDebtors):
 *  qarz = ochiq/qisman hisob qoldig'i + to'lanmagan talon qoldig'i
 *         + (belgilangan oylik, shu oy hisobi hali yaratilmagan bo'lsa: monthlyFee − shu oy to'lovlari).
 * Tartib: qarz kamayish bo'yicha, KESISHDAN OLDIN (SQL ORDER BY ... LIMIT) — eng katta qarzdorlar
 * hech qachon tushib qolmaydi. Ro'yxat kesilsa `meta.truncated` qaytadi, umumiy summa esa to'liq.
 */
export async function getDailyList(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = scopeOf(req)
    const { districtId, mahallId } = req.query
    const currentMonth = isValidMonth(String(req.query.month ?? '')) ? String(req.query.month) : getCurrentMonth()

    // Prisma uchun doira (tashkilotlar yuklash, bugun to'langanlar)
    const entityWhere: any = { ...entityScopeWhere(user), status: 'active' }
    let extra: Prisma.Sql = Prisma.empty
    if (districtId) {
      if (!canAccessDistrict(user, String(districtId))) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      entityWhere.districtId = String(districtId)
      extra = Prisma.sql`${extra} AND e."districtId" = ${String(districtId)}`
    }
    if (mahallId) {
      entityWhere.mahallId = String(mahallId)
      extra = Prisma.sql`${extra} AND e."mahallId" = ${String(mahallId)}`
    }

    const limit = clampLimit(req.query.limit, DAILY_LIST_DEFAULT, DAILY_LIST_MAX)
    const ranked = await queryDailyDebtors(user, currentMonth, extra, limit)
    const ids = ranked.rows.map(r => r.id)

    // Tafsilot faqat kesilgan (eng katta qarzdor) to'plam uchun yuklanadi
    const entities = ids.length === 0 ? [] : await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { ...entityWhere, id: { in: ids } },
      include: {
        mahalla: { select: { id: true, name: true } },
      },
    })
    // Qarz oylari — KANONIK SQL (ortiqcha to'langan oy eng eski qarzni qoplaydi), summa bilan bir manba
    const debtById = await queryEntityDebts(ids, user.orgId)
    const byId = new Map<string, any>(entities.map((e: any) => [e.id, e]))

    // Mahalla bo'yicha guruhlash (qarz tartibi saqlanadi)
    const grouped: Record<string, any> = {}
    let shown = 0
    for (const r of ranked.rows) {
      const entity = byId.get(r.id)
      if (!entity) continue
      shown++
      const unpaidMonths = [...(debtById.get(r.id)?.unpaidMonths ?? [])]
      if (r.unbilled > 0 && !unpaidMonths.includes(currentMonth)) unpaidMonths.push(currentMonth)
      unpaidMonths.sort()

      const key = entity.mahallId || '__no_mahalla__'
      if (!grouped[key]) {
        grouped[key] = {
          mahallId: entity.mahalla?.id ?? '__no_mahalla__',
          mahallName: entity.mahalla?.name ?? 'Mahallasiz',
          entities: [],
          debtAmount: 0,
        }
      }
      grouped[key].entities.push({
        id: entity.id,
        name: entity.name,
        address: entity.address,
        monthlyFee: entity.monthlyFee,
        cubicPrice: entity.cubicPrice,
        billingMode: entity.billingMode,
        unpaidMonths,
        // Yagona manba: SQL qarzi (stats bilan bir xil qoida)
        debtAmount: r.debt,
        billedDebt: r.billed,
        unbilledDebt: r.unbilled,
      })
      grouped[key].debtAmount += r.debt
    }
    const groups = Object.values(grouped).sort((a: any, b: any) => b.debtAmount - a.debtAmount)

    // Bugun to'langanlar — UZT kun chegarasi (server mintaqasiga bog'liq emas)
    const day = dayBoundsUz(todayUz())
    const paidTodayRows = day ? await (prisma as any).ekoHisobPayment.findMany({
      where: { entity: entityWhere, paidAt: { gte: day.start, lt: day.end } },
      include: { entity: { select: { id: true, name: true, address: true } } },
      orderBy: { paidAt: 'desc' },
      take: 200,
    }) : []
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
        groups,
        // Ko'rsatilgan qarzdorlar soni (ro'yxatdagi)
        totalUnpaid: shown,
        // Bazadagi umumiy qarzdorlar soni — ro'yxat kesilgan bo'lsa ham to'g'ri
        totalDebtors: ranked.total,
        // Umumiy qarz (kesilmagan): hisoblangan + hali hisoblanmagan joriy oylik
        totalDebtAmount: ranked.totalBilled + ranked.totalUnbilled,
        totalBilledDebt: ranked.totalBilled,
        totalUnbilledDebt: ranked.totalUnbilled,
        paidToday,
      },
      meta: {
        limit,
        truncated: ranked.total > shown,
        shown,
      },
    })
  } catch (err) { next(err) }
}

export async function getMapData(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = scopeOf(req)
    const currentMonth = getCurrentMonth()
    const limit = clampLimit(req.query.limit, MAP_DEFAULT, MAP_MAX)

    const entityWhere: any = {
      ...entityScopeWhere(user),
      lat: { not: null },
      lon: { not: null },
      status: { not: 'inactive' },   // draft (chala) ham xaritada — alohida belgi bilan
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
      if (!canAccessDistrict(user, d)) {
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
        cubicPrice: true,
        billingMode: true,
        createdBy: true,       // kim kiritgan — popup'da ko'rsatiladi
        payments: {
          where: { month: currentMonth },
          select: { id: true, month: true, amount: true },
        },
      },
    })

    // Qarz — KANONIK SQL (hisobotlar, kartochka, akt sverka bilan bir xil): tashkilot ichida netto,
    // talon rejimi ham. variable'da qarz yo'q (faqat joriy oy to'lamaganlik belgisi).
    const debtById = await queryEntityDebts(entities.map((e: any) => e.id), user.orgId)

    // Kim kiritganini nomi bilan — bir tumanda bir necha inspektor ishlaganda
    // markerni ochib "bu kimniki?" degan savolga javob beradi.
    // FK emas, alohida so'rov: eski yozuvlarda mavjud bo'lmagan id bo'lishi mumkin.
    const creatorIds = Array.from(new Set(entities.map((e: any) => e.createdBy).filter(Boolean))) as string[]
    const creatorById = new Map<string, string>()
    if (creatorIds.length > 0) {
      const users = await (prisma as any).ekoHisobUser.findMany({
        where: { id: { in: creatorIds }, orgId: user.orgId },
        select: { id: true, fullName: true },
      }).catch(() => [] as any[])
      for (const u of users) creatorById.set(u.id, u.fullName)
    }

    const result = entities.map((e: any) => {
      const paidThisMonth = e.payments.length > 0
      const canon = debtById.get(e.id)
      const debt = e.billingMode === 'variable'
        ? computeEntityDebt({ billingMode: 'variable', currentMonth, paidCurrentMonth: paidThisMonth })
        : { totalDebt: canon?.debt ?? 0, debtMonths: canon?.months ?? 0 }
      return {
        id: e.id,
        name: e.name,
        address: e.address,
        lat: e.lat,
        lon: e.lon,
        status: e.status,
        districtId: e.districtId,
        monthlyFee: e.monthlyFee,
        cubicPrice: e.cubicPrice,
        billingMode: e.billingMode,
        paidThisMonth,
        debtMonths: debt.debtMonths,
        debtAmount: debt.totalDebt,
        creatorName: e.createdBy ? (creatorById.get(e.createdBy) ?? null) : null,
      }
    })

    res.json({
      success: true,
      data: result,
      meta: { limit, shown: result.length, total: totalInScope, truncated: totalInScope > result.length },
    })
  } catch (err) { next(err) }
}

/**
 * GET /dashboard/stats
 *
 *  totalDebt       — faol tashkilotlarning hisoblangan qarzi (hisobotlardagi KPI "jami qarz" bilan BIR XIL);
 *  blacklistedDebt — qora ro'yxat qarzi ALOHIDA;
 *  unbilledDebt    — shu oy hisobi hali yaratilmagan belgilangan oylik (kunlik ro'yxat qoidasi);
 *  unpaidThisMonth — kunlik ro'yxatdagi qarzdorlar soni (BIR XIL qoida);
 *  collectedAmount — payment.month = shu oy ("Shu oyga tegishli"); collectedCash — paidAt shu UZT oyida.
 */
export async function getStats(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = scopeOf(req)
    const currentMonth = getCurrentMonth()
    const bounds = monthBoundsUz(currentMonth)!

    const entityWhere: any = entityScopeWhere(user)
    const activeWhere = { ...entityWhere, status: 'active' }

    const [
      total, blacklisted, paidThisMonth, daily, collectedResult, cashResult, debtRows,
    ] = await Promise.all([
      (prisma as any).ekoHisobLegalEntity.count({ where: activeWhere }),
      (prisma as any).ekoHisobLegalEntity.count({ where: { ...entityWhere, status: 'blacklisted' } }),
      // Shu oyda kamida bitta to'lov qilgan tashkilotlar soni (EXISTS)
      (prisma as any).ekoHisobLegalEntity.count({
        where: { ...activeWhere, payments: { some: { month: currentMonth } } },
      }),
      queryDailyDebtors(user, currentMonth, Prisma.empty, 1),
      (prisma as any).ekoHisobPayment.aggregate({
        where: { entity: activeWhere, month: currentMonth },
        _sum: { amount: true },
      }),
      (prisma as any).ekoHisobPayment.aggregate({
        where: { entity: activeWhere, paidAt: { gte: bounds.start, lt: bounds.end } },
        _sum: { amount: true },
      }),
      queryDebtGroups(user),
    ])

    const debt = summarizeDebt(debtRows, false)

    res.json({
      success: true,
      data: {
        month: currentMonth,
        total,
        totalEntities: total,
        paidThisMonth,
        unpaidThisMonth: daily.total,
        blacklisted,
        collectedAmount: collectedResult._sum.amount || 0,
        collectedCash: cashResult._sum.amount || 0,
        totalDebt: debt.activeDebt,
        debtors: debt.activeDebtors,
        blacklistedDebt: debt.blacklistedDebt,
        unbilledDebt: daily.totalUnbilled,
        totalDebtWithUnbilled: debt.activeDebt + daily.totalUnbilled,
      },
    })
  } catch (err) { next(err) }
}
