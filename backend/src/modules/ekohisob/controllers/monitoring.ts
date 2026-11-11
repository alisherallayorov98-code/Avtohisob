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
import { ScopeUser, entityScopeWhere } from '../lib/ekoScope'
import { evaluationMonths } from '../lib/monitoringMath'
import { queryEntityDebts, queryPaidMonthsByEntity } from '../lib/reportQueries'

function scopeOf(req: EkoRequest): ScopeUser {
  const u = req.ekoUser!
  return { role: u.role, orgId: u.orgId, districtIds: u.districtIds ?? [] }
}

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
    const where: any = { ...entityScopeWhere(scopeOf(req)), status: { notIn: ['inactive', 'blacklisted'] } }

    const total = await (prisma as any).ekoHisobLegalEntity.count({ where })

    // Faqat kerakli skalyar maydonlar — qator kichik, 20 ming qator ~2 MB.
    // Sanashni Prisma'da alohida so'rovlar bilan qilish mumkin edi, lekin u
    // holda shart mantiqi ikki joyda (Prisma where va lib) takrorlanib,
    // vaqt o'tib bir-biridan uzoqlashardi.
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where,
      select: {
        id: true, name: true, status: true, phone: true, lat: true, lon: true,
        billingMode: true, monthlyFee: true, cubicPrice: true, mahallId: true, stir: true, entityType: true,
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
    const user = scopeOf(req)
    const q = req.query as Record<string, string>

    const monthCount = Math.min(Math.max(parseInt(q.months ?? '12', 10) || 12, 4), 24)
    const minGap = Math.min(Math.max(parseInt(q.minGap ?? '2', 10) || 2, 1), 12)
    const minHistory = Math.min(Math.max(parseInt(q.minHistory ?? '3', 10) || 3, 1), 12)

    // Tugamagan joriy oy "to'lanmagan" hisoblanmasin: davr oldingi oygacha, joriy oy faqat
    // kesim kunidan (paymentDueDay, kamida 15) keyin qo'shiladi.
    const settings = await (prisma as any).ekoHisobOrgSettings.findUnique({
      where: { orgId: user.orgId }, select: { paymentDueDay: true },
    }).catch(() => null)
    const months = evaluationMonths(monthCount, new Date(), settings?.paymentDueDay)
    const evaluatedThrough = months[months.length - 1]

    const base = { months: monthCount, minGap, minHistory, evaluatedThrough }

    // To'lovlarni tashkilot bo'yicha DB tomonida guruhlaymiz (ent CTE — doira ekoScope orqali)
    const paid = await queryPaidMonthsByEntity(user, ['active'], months)
    if (paid.length === 0) {
      res.json({ success: true, data: { ...base, totalFound: 0, totalEstimatedLoss: 0, rows: [], topRecentlyStopped: [] } })
      return
    }

    const stopped = findStoppedPaying(
      paid.map(v => ({
        entityId: v.entityId,
        months,
        paidMonths: new Set(v.paidMonths),
        avgPayment: v.count > 0 ? v.total / v.count : 0,
      })),
      { minGap, minHistory },
    )

    if (stopped.length === 0) {
      res.json({ success: true, data: { ...base, totalFound: 0, totalEstimatedLoss: 0, rows: [], topRecentlyStopped: [] } })
      return
    }

    // Tashkilot ma'lumotlari va hozirgi qarzi (doira shu yerda ham qo'llanadi)
    const top = stopped.slice(0, 200)
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { ...entityScopeWhere(user), id: { in: top.map(s => s.entityId) } },
      select: {
        id: true, name: true, phone: true, billingMode: true,
        district: { select: { name: true } },
        mahalla: { select: { name: true } },
      },
    })
    const byId = new Map<string, any>(entities.map((e: any) => [e.id, e]))
    // Kanonik qarz (SQL, tashkilot ichida netto) — kartochka/hisobot bilan bir xil
    const debtById = await queryEntityDebts(entities.map((e: any) => e.id), user.orgId)

    const rows = top.map(s => {
      const e = byId.get(s.entityId)
      const debt = e ? (debtById.get(s.entityId)?.debt ?? 0) : 0
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

    // So what: ENG QIMMAT va YAQINDA to'xtagan mijozlar (uzilish <= minGap + 1 oy) — qaytarish eng oson.
    // `stopped` allaqachon estimatedLoss bo'yicha kamayish tartibida.
    const topRecentlyStopped = rows
      .filter(r => r.gapMonths <= minGap + 1 && byId.has(r.entityId))
      .slice(0, 10)

    res.json({
      success: true,
      data: {
        ...base,
        totalFound: stopped.length,
        totalEstimatedLoss: stopped.reduce((sum, s) => sum + s.estimatedLoss, 0),
        rows,
        topRecentlyStopped,
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
    const where: any = { ...entityScopeWhere(scopeOf(req)), status: { notIn: ['inactive'] } }

    const totalEntities = await (prisma as any).ekoHisobLegalEntity.count({ where })
    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where,
      select: { id: true, name: true, stir: true },
      take: MAX_SCAN,
    })

    const groups = findDuplicateGroups(entities)
    if (groups.length === 0) {
      res.json({
        success: true,
        data: { groups: [], scanned: entities.length, total: totalEntities, truncated: totalEntities > entities.length },
      })
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
        _count: { select: { payments: true } },
      },
    })
    const dupDebt = await queryEntityDebts(detail.map((e: any) => e.id), scopeOf(req).orgId)
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
      const debt = dupDebt.get(id)?.debt ?? 0
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
        total: totalEntities,
        // MAX_SCAN dan ko'p tashkilot bo'lsa takrorlar qisman qidirilgan — UI ogohlantirishi kerak
        truncated: totalEntities > entities.length,
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
