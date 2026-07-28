// Nazorat: ma'lumot to'liqligi va to'lov xatti-harakati.
//
// Ikkalasi ham TALAB BO'YICHA hisoblanadi — cron va Telegram xabar yo'q.
// Sabab: bu ma'lumot har kuni o'zgarmaydi, kunlik xabar shovqin bo'lardi.
// Admin kerak bo'lganda ochib ko'radi.

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { classifyEntity, summarizeHealth, IssueCode, ISSUE_META } from '../lib/dataHealth'
import { findDuplicateGroups } from '../lib/duplicateDetect'
import { findStoppedPaying } from '../lib/paymentBehavior'
import { lastNMonths, getCurrentMonth } from '../lib/months'
import { computeEntityDebt } from '../lib/debtMath'

// Bir so'rovda tekshiriladigan maksimal tashkilot. Juda katta korxonada
// xotira bo'g'ilmasligi uchun; javobda `truncated` bilan ochiq aytiladi.
const MAX_SCAN = 20000

/** Har muammo guruhi uchun ko'rsatiladigan namuna qatorlar soni */
const SAMPLE_SIZE = 50

/**
 * GET /monitoring/data-health
 *
 * Avtomatlashtirishni jimgina buzayotgan to'ldirilmagan maydonlarni topadi.
 * So what: avto-SMS yoqilgan bo'lsa ham telefoni yo'q tashkilotlarga
 * hech qachon bormaydi — bu yerda buni ko'rmaguncha hech kim bilmaydi.
 */
export async function getDataHealth(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!

    const where: any = { orgId, status: { notIn: ['inactive', 'blacklisted'] } }
    if (role !== 'admin') where.districtId = { in: districtIds }

    const total = await (prisma as any).ekoHisobLegalEntity.count({ where })

    // Faqat kerakli skalyar maydonlar — qator kichik, 20 ming qator ~2 MB.
    // Sanashni Prisma'da alohida so'rovlar bilan qilish mumkin edi, lekin u
    // holda shart mantiqi ikki joyda (Prisma where va lib) takrorlanib,
    // vaqt o'tib bir-biridan uzoqlashardi.
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where,
      select: {
        id: true, name: true, status: true, phone: true, lat: true, lon: true,
        billingMode: true, monthlyFee: true, cubicPrice: true, mahallId: true, stir: true,
        district: { select: { name: true } },
      },
      take: MAX_SCAN,
      orderBy: { name: 'asc' },
    })

    const summary = summarizeHealth(entities)

    // Har guruh uchun namuna ro'yxat — foydalanuvchi qaysi tashkilotlarni
    // tuzatishi kerakligini darhol ko'rsin
    const samples: Partial<Record<IssueCode, any[]>> = {}
    for (const e of entities) {
      for (const code of classifyEntity(e)) {
        const list = samples[code] ?? (samples[code] = [])
        if (list.length < SAMPLE_SIZE) {
          list.push({ id: e.id, name: e.name, district: e.district?.name ?? null })
        }
      }
    }

    res.json({
      success: true,
      data: {
        checked: summary.checked,
        clean: summary.clean,
        total,
        truncated: total > entities.length,
        groups: summary.groups.map(g => ({ ...g, samples: samples[g.code] ?? [] })),
      },
    })
  } catch (err) { next(err) }
}

/**
 * GET /monitoring/stopped-paying?months=12&minGap=2&minHistory=3
 *
 * Muntazam to'lagan, keyin to'xtagan mijozlar.
 * So what: doimiy qarzdordan farqli — bunday mijozda aniq sabab bor va uni
 * qaytarish ancha oson. Hozirgi qarzdorlar ro'yxatida u boshqalar orasida
 * yo'qoladi, chunki u yerda faqat "qancha qarz" ko'rinadi.
 */
export async function getStoppedPaying(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const q = req.query as Record<string, string>

    const monthCount = Math.min(Math.max(parseInt(q.months ?? '12', 10) || 12, 4), 24)
    const minGap = Math.min(Math.max(parseInt(q.minGap ?? '2', 10) || 2, 1), 12)
    const minHistory = Math.min(Math.max(parseInt(q.minHistory ?? '3', 10) || 3, 1), 12)

    const months = lastNMonths(monthCount, getCurrentMonth())

    const entityWhere: any = { orgId, status: 'active' }
    if (role !== 'admin') entityWhere.districtId = { in: districtIds }

    // To'lovlarni (tashkilot × oy) kesimida DB tomonida guruhlaymiz —
    // faqat to'lov BO'LGAN kombinatsiyalar qaytadi.
    const groups = await (prisma as any).ekoHisobPayment.groupBy({
      by: ['entityId', 'month'],
      where: { entity: entityWhere, month: { in: months } },
      _sum: { amount: true },
    })

    if (groups.length === 0) {
      res.json({ success: true, data: { months: monthCount, minGap, minHistory, rows: [] } })
      return
    }

    // Tashkilot bo'yicha yig'amiz
    const byEntity = new Map<string, { paidMonths: Set<string>; total: number; count: number }>()
    for (const g of groups) {
      const cur = byEntity.get(g.entityId) ?? { paidMonths: new Set<string>(), total: 0, count: 0 }
      cur.paidMonths.add(g.month)
      cur.total += g._sum.amount || 0
      cur.count++
      byEntity.set(g.entityId, cur)
    }

    const stopped = findStoppedPaying(
      Array.from(byEntity.entries()).map(([entityId, v]) => ({
        entityId,
        months,
        paidMonths: v.paidMonths,
        avgPayment: v.count > 0 ? v.total / v.count : 0,
      })),
      { minGap, minHistory },
    )

    if (stopped.length === 0) {
      res.json({ success: true, data: { months: monthCount, minGap, minHistory, rows: [] } })
      return
    }

    // Tashkilot ma'lumotlari va hozirgi qarzi
    const ids = stopped.slice(0, 200).map(s => s.entityId)
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, name: true, phone: true, billingMode: true,
        district: { select: { name: true } },
        mahalla: { select: { name: true } },
        charges: {
          where: { status: { in: ['open', 'partial'] } },
          select: { month: true, expectedAmount: true, paidAmount: true },
        },
        talons: { where: { paid: false }, select: { date: true, amount: true, paid: true } },
      },
    })
    const byId = new Map<string, any>(entities.map((e: any) => [e.id, e]))

    const rows = stopped.slice(0, 200).map(s => {
      const e = byId.get(s.entityId)
      const debt = e
        ? computeEntityDebt({ billingMode: e.billingMode, charges: e.charges, talons: e.talons }).totalDebt
        : 0
      return {
        entityId: s.entityId,
        name: e?.name ?? '—',
        phone: e?.phone ?? null,
        district: e?.district?.name ?? null,
        mahalla: e?.mahalla?.name ?? null,
        lastPaidMonth: s.lastPaidMonth,
        gapMonths: s.gapMonths,
        paidBeforeGap: s.paidBeforeGap,
        regularity: s.regularity,
        avgPayment: s.avgPayment,
        estimatedLoss: s.estimatedLoss,
        currentDebt: debt,
      }
    })

    res.json({
      success: true,
      data: {
        months: monthCount, minGap, minHistory,
        totalFound: stopped.length,
        rows,
      },
    })
  } catch (err) { next(err) }
}

/**
 * GET /monitoring/duplicates
 *
 * Takroriy tashkilotlar — bir xil STIR yoki normallashtirilgan nom.
 * So what: bitta tashkilot ikki marta kiritilsa unga har oy IKKI MARTA hisob
 * yoziladi, SMS ikki marta boradi, akt sverkada janjal chiqadi.
 *
 * BIRLASHTIRISH QILINMAYDI (ataylab): to'lov/hisob/talonlarni bir yozuvdan
 * ikkinchisiga ko'chirish pul amali va charge'ning (entityId, month) unikal
 * cheklovi bilan to'qnashadi. To'g'ri yo'l — admin qaysi yozuv asl ekanini
 * o'zi hal qilib, takrorini deaktiv qiladi. Panel shunga yo'naltiradi.
 */
export async function getDuplicates(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!

    const where: any = { orgId, status: { notIn: ['inactive'] } }
    if (role !== 'admin') where.districtId = { in: districtIds }

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where,
      select: { id: true, name: true, stir: true },
      take: MAX_SCAN,
    })

    const groups = findDuplicateGroups(entities)
    if (groups.length === 0) {
      res.json({ success: true, data: { groups: [], scanned: entities.length } })
      return
    }

    // Guruhlangan (kichik) to'plam uchun tafsilot: hudud, kim/qachon kiritgan,
    // qarzi bormi — admin qaysi yozuv "asl" ekanini shu belgilaridan hal qiladi.
    const ids = groups.flatMap(g => g.ids)
    const detail = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, name: true, stir: true, status: true, createdAt: true, createdBy: true,
        billingMode: true,
        district: { select: { name: true } },
        mahalla: { select: { name: true } },
        charges: {
          where: { status: { in: ['open', 'partial'] } },
          select: { month: true, expectedAmount: true, paidAmount: true },
        },
        talons: { where: { paid: false }, select: { date: true, amount: true, paid: true } },
        _count: { select: { payments: true } },
      },
    })
    const creatorIds = Array.from(new Set(detail.map((e: any) => e.createdBy).filter(Boolean))) as string[]
    const creators = creatorIds.length > 0
      ? await (prisma as any).ekoHisobUser.findMany({
          where: { id: { in: creatorIds } }, select: { id: true, fullName: true },
        }).catch(() => [] as any[])
      : []
    const creatorById = new Map<string, string>(creators.map((u: any) => [u.id, u.fullName]))

    const byId = new Map<string, any>(detail.map((e: any) => [e.id, e]))
    const enrich = (id: string) => {
      const e = byId.get(id)
      if (!e) return null
      const debt = computeEntityDebt({
        billingMode: e.billingMode, charges: e.charges, talons: e.talons,
      }).totalDebt
      return {
        id: e.id, name: e.name, stir: e.stir, status: e.status,
        district: e.district?.name ?? null, mahalla: e.mahalla?.name ?? null,
        createdAt: e.createdAt,
        creatorName: e.createdBy ? (creatorById.get(e.createdBy) ?? null) : null,
        paymentsCount: e._count?.payments ?? 0,
        debtAmount: debt,
      }
    }

    res.json({
      success: true,
      data: {
        scanned: entities.length,
        groups: groups.slice(0, 100).map(g => ({
          reason: g.reason,
          key: g.key,
          entities: g.ids.map(enrich).filter(Boolean),
        })),
        totalGroups: groups.length,
      },
    })
  } catch (err) { next(err) }
}

/** UI uchun muammo turlarining tavsifi (bir joyda saqlash uchun) */
export async function getIssueMeta(_req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: Object.values(ISSUE_META) })
  } catch (err) { next(err) }
}
