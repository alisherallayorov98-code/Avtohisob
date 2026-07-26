import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getCurrentMonth, isValidMonth, monthsBetween, lastNMonths } from '../lib/months'
import {
  buildLedger, computeEntityDebt, sumPaymentsByMonth, chargeRowStatus, talonMonth,
} from '../lib/debtMath'
import { logEkoAudit } from '../lib/ekoAudit'

/**
 * Berilgan org va oy uchun hisoblarni (charge) yaratadi.
 * FAQAT billingMode='monthly_fixed' va status='active' tashkilotlar uchun.
 * Idempotent — mavjud charge ustiga yozmaydi (skipDuplicates).
 * Cron va HTTP endpoint ham shu funksiyani chaqiradi.
 */
export async function generateChargesForOrg(orgId: string, month: string): Promise<number> {
  const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
    where: {
      orgId,
      status: 'active',
      billingMode: 'monthly_fixed',
      monthlyFee: { gt: 0 },
      // Shartnoma boshlanmagan tashkilotlarga shu oy uchun charge yozilmasin
      OR: [
        { contractStartMonth: null },
        { contractStartMonth: { lte: month } },
      ],
    },
    select: { id: true, monthlyFee: true },
  })

  if (entities.length === 0) return 0

  const result = await (prisma as any).ekoHisobCharge.createMany({
    data: entities.map((e: any) => ({
      entityId: e.id,
      month,
      expectedAmount: e.monthlyFee,
    })),
    skipDuplicates: true,
  })

  return result.count ?? 0
}

/**
 * Barcha korxonalar uchun joriy oy hisoblarini avtomatik yaratadi (cron chaqiradi).
 * Idempotent — mavjud hisoblar ustiga yozmaydi, shuning uchun har kuni xavfsiz
 * ishga tushadi (server o'chiq bo'lib 1-sanani o'tkazib yuborsa ham keyingi kun yaratadi).
 */
export async function autoGenerateMonthlyCharges(): Promise<void> {
  try {
    const month = getCurrentMonth()
    const orgs = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { status: 'active', billingMode: 'monthly_fixed' },
      select: { orgId: true },
      distinct: ['orgId'],
    })
    let total = 0
    for (const { orgId } of orgs) {
      const created = await generateChargesForOrg(orgId, month).catch(() => 0)
      total += created
    }
    if (total > 0) {
      console.log(`[Scheduler] EkoHisob: ${month} uchun jami ${total} ta oylik hisob avtomatik yaratildi`)
    }
  } catch (err: any) {
    console.error('autoGenerateMonthlyCharges error:', err?.message ?? err)
  }
}

/** POST /charges/generate — admin qo'lda joriy (yoki tanlangan) oy uchun hisoblarni yaratadi. */
export async function generateCharges(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const month = req.body?.month ? String(req.body.month) : getCurrentMonth()
    if (!isValidMonth(month)) {
      res.status(400).json({ success: false, error: 'month formati: "YYYY-MM"' })
      return
    }
    const created = await generateChargesForOrg(orgId, month)
    res.json({ success: true, data: { month, created } })
  } catch (err) { next(err) }
}

/**
 * GET /charges/entity/:id — bitta tashkilotning oylar tasmasi (ledger).
 * Har oy uchun: to'langan yig'indi, kutilgan summa, holat. + jami qarz.
 *  - monthly_fixed: shartnoma boshidan (yoki oxirgi 12 oy) hisoblar bo'yicha;
 *  - talon: talonlar sanasi bo'yicha oyga guruhlanadi (kutilgan = shu oy talonlari);
 *  - variable: faqat to'lov yozuvlari (qarz tushunchasi yo'q).
 *
 * Hisob-kitob debtMath'da (testlangan): bir oyda bir necha qisman to'lov bo'lsa
 * ular YIG'ILADI. Ilgari faqat oxirgi to'lov olinardi va tashkilot qarzdor ko'rinardi.
 */
export async function getEntityLedger(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id },
      select: {
        id: true, name: true, orgId: true, districtId: true,
        billingMode: true, monthlyFee: true, cubicPrice: true, contractStartMonth: true,
      },
    })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const current = getCurrentMonth()
    const months = entity.contractStartMonth && isValidMonth(entity.contractStartMonth)
      ? monthsBetween(entity.contractStartMonth, current)
      : lastNMonths(12, current)

    const isTalon = entity.billingMode === 'talon'

    const [payments, charges, talons] = await Promise.all([
      (prisma as any).ekoHisobPayment.findMany({
        where: { entityId: id, month: { in: months } },
        select: { month: true, amount: true, paidAt: true },
      }),
      entity.billingMode === 'monthly_fixed'
        ? (prisma as any).ekoHisobCharge.findMany({
            where: { entityId: id, month: { in: months } },
            select: { month: true, expectedAmount: true, paidAmount: true, status: true },
          })
        : Promise.resolve([]),
      isTalon
        ? (prisma as any).ekoHisobTalon.findMany({
            where: { entityId: id },
            select: { date: true, amount: true, volume: true, paid: true },
          })
        : Promise.resolve([]),
    ])

    // Talon tasmasi shartnoma oyidan emas, birinchi talon oyidan boshlansin —
    // aks holda eski talonlar oynadan tashqarida qolib, qarz kam ko'rinardi.
    let ledgerMonths = months
    if (isTalon && talons.length > 0) {
      const talonMonths = talons.map((t: any) => talonMonth(t.date)).filter(Boolean).sort()
      const first = talonMonths[0]
      if (first && first < ledgerMonths[0]) ledgerMonths = monthsBetween(first, current)
    }

    const timeline = buildLedger({
      months: ledgerMonths,
      billingMode: entity.billingMode,
      monthlyFee: entity.monthlyFee,
      payments,
      charges,
      talons,
    })

    const { totalDebt, unpaidMonths } = computeEntityDebt({
      billingMode: entity.billingMode,
      charges,
      talons,
      currentMonth: current,
      paidCurrentMonth: sumPaymentsByMonth(payments).has(current),
    })

    res.json({
      success: true,
      data: {
        entityId: id,
        billingMode: entity.billingMode,
        monthlyFee: entity.monthlyFee,
        cubicPrice: entity.cubicPrice,
        contractStartMonth: entity.contractStartMonth,
        totalDebt,
        unpaidMonths,
        timeline,
      },
    })
  } catch (err) { next(err) }
}

/**
 * POST /charges/recalc — barcha monthly_fixed hisoblarni HAQIQIY to'lovlardan
 * qayta hisoblaydi (admin only, confirmPhrase bilan).
 *
 * Nega kerak: ilgari to'lovni o'chirish charge.paidAmount ni qaytarmasdi —
 * mavjud bazada shishgan paidAmount va noto'g'ri "to'langan" holatlar qolgan.
 * Kod tuzatilishi eski ma'lumotni o'zi tuzatmaydi, shuning uchun bir martalik
 * moslash amali. Faqat charge jadvalini tegadi, to'lovlarga tegmaydi.
 */
export async function recalcCharges(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const CONFIRM = 'HISOBLARNI QAYTA HISOBLASH'
    if (String(req.body?.confirmPhrase ?? '').trim() !== CONFIRM) {
      res.status(400).json({
        success: false,
        error: `Tasdiqlash uchun "${CONFIRM}" iborasini kiriting`,
      })
      return
    }

    const charges = await (prisma as any).ekoHisobCharge.findMany({
      where: { entity: { orgId } },
      select: { id: true, entityId: true, month: true, expectedAmount: true, paidAmount: true, status: true },
    })
    if (charges.length === 0) {
      res.json({ success: true, data: { checked: 0, fixed: 0 } })
      return
    }

    // Shu hisoblarga tegishli barcha to'lovlarni bir so'rovda olib, (entity, oy) bo'yicha yig'amiz
    const entityIds = Array.from(new Set(charges.map((c: any) => c.entityId))) as string[]
    const payments = await (prisma as any).ekoHisobPayment.findMany({
      where: { entityId: { in: entityIds } },
      select: { entityId: true, month: true, amount: true },
    })
    const paidByKey = new Map<string, number>()
    for (const p of payments) {
      const key = `${p.entityId}|${p.month}`
      paidByKey.set(key, (paidByKey.get(key) ?? 0) + Number(p.amount || 0))
    }

    let fixed = 0
    const samples: any[] = []
    for (const c of charges) {
      const actualPaid = paidByKey.get(`${c.entityId}|${c.month}`) ?? 0
      const status = chargeRowStatus(c.expectedAmount, actualPaid)
      if (actualPaid === c.paidAmount && status === c.status) continue
      await (prisma as any).ekoHisobCharge.update({
        where: { id: c.id },
        data: { paidAmount: actualPaid, status },
      })
      fixed++
      if (samples.length < 20) {
        samples.push({ month: c.month, was: c.paidAmount, now: actualPaid, status })
      }
    }

    await logEkoAudit(req.ekoUser, {
      action: 'charge.recalc',
      targetType: 'charge',
      details: { checked: charges.length, fixed, samples },
    })

    res.json({ success: true, data: { checked: charges.length, fixed, samples } })
  } catch (err) { next(err) }
}

/**
 * PUT /charges/bulk-billing-mode — tanlangan tashkilotlarni ommaviy ravishda
 * monthly_fixed yoki variable rejimiga o'tkazadi (insoflilarni avto-rejimga).
 * Body: { entityIds: string[], billingMode: 'monthly_fixed'|'variable' }
 */
export async function bulkSetBillingMode(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { entityIds, billingMode } = req.body

    if (!Array.isArray(entityIds) || entityIds.length === 0) {
      res.status(400).json({ success: false, error: 'entityIds (massiv) talab qilinadi' })
      return
    }
    if (!['monthly_fixed', 'variable'].includes(billingMode)) {
      res.status(400).json({ success: false, error: "billingMode: 'monthly_fixed' yoki 'variable'" })
      return
    }

    const where: any = { id: { in: entityIds }, orgId }
    if (role === 'inspector') where.districtId = { in: districtIds }

    const result = await (prisma as any).ekoHisobLegalEntity.updateMany({
      where,
      data: { billingMode },
    })

    res.json({ success: true, data: { updated: result.count, billingMode } })
  } catch (err) { next(err) }
}
