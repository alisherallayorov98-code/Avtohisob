import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getCurrentMonth, isValidMonth, monthsBetween, lastNMonths } from '../lib/months'

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
 * Har oy uchun: to'landimi, summa, kutilgan summa, holat. + jami qarz.
 * monthly_fixed: shartnoma boshidan (yoki oxirgi 12 oy) hisoblar bo'yicha.
 * variable: faqat to'lov yozuvlari bo'yicha (qarz tushunchasi yo'q).
 */
export async function getEntityLedger(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id },
      select: {
        id: true, name: true, orgId: true, districtId: true,
        billingMode: true, monthlyFee: true, contractStartMonth: true,
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

    const [payments, charges] = await Promise.all([
      (prisma as any).ekoHisobPayment.findMany({
        where: { entityId: id, month: { in: months } },
        select: { month: true, amount: true, paidAt: true },
      }),
      (prisma as any).ekoHisobCharge.findMany({
        where: { entityId: id, month: { in: months } },
        select: { month: true, expectedAmount: true, paidAmount: true, status: true },
      }),
    ])

    const payMap = new Map<string, any>(payments.map((p: any) => [p.month, p]))
    const chargeMap = new Map<string, any>(charges.map((c: any) => [c.month, c]))

    const timeline = months.map((m) => {
      const pay = payMap.get(m)
      const charge = chargeMap.get(m)
      const expected = charge ? charge.expectedAmount : (entity.billingMode === 'monthly_fixed' ? entity.monthlyFee : null)
      const paid = pay ? pay.amount : 0
      let status: string
      if (pay) status = expected != null && paid < expected ? 'partial' : 'paid'
      else if (entity.billingMode === 'monthly_fixed') status = 'unpaid'
      else status = 'none' // variable: hisob yo'q, kutilmaydi
      return { month: m, expected, paid, status, paidAt: pay?.paidAt ?? null }
    })

    // Qarz faqat monthly_fixed uchun: kutilgan − to'langan (manfiy bo'lmasin)
    let totalDebt = 0
    if (entity.billingMode === 'monthly_fixed') {
      for (const row of timeline) {
        if (row.expected != null) totalDebt += Math.max(0, row.expected - row.paid)
      }
    }

    res.json({
      success: true,
      data: {
        entityId: id,
        billingMode: entity.billingMode,
        monthlyFee: entity.monthlyFee,
        contractStartMonth: entity.contractStartMonth,
        totalDebt,
        timeline,
      },
    })
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
