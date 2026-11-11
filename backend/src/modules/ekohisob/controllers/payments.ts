import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { sumPaymentsByMonth } from '../lib/debtMath'
import { recordEkoPayment, loadOpenDebts, PaymentError } from '../services/paymentService'
import { reversePaymentGroup } from '../services/paymentReversal'
import { logEkoAudit } from '../lib/ekoAudit'
import { ensureEkoActor } from '../lib/ekoActor'
import { canAccessDistrict, canAccessEntity, entityScopeWhere } from '../lib/ekoScope'
import { dayBoundsUz, isValidIsoDate } from '../lib/uzt'
import { isValidMonth } from '../lib/months'
import { parseReason } from '../lib/money'

/**
 * GET /payments — to'lovlar ro'yxati.
 *
 * Filtrlar: entityId, districtId, mahallId, month, from/to (sana), receivedBy, search.
 * Sahifalash: page/limit (standart 50, maksimal 200).
 *
 * Ilgari cheklov UMUMAN yo'q edi: korxonadagi barcha to'lovlar bir so'rovda
 * qaytarilardi. Bundan tashqari tashkilot id'lari xotiraga yuklanib
 * `IN (10 000 ta id)` ro'yxatiga solinardi — endi bog'lanish filtri ishlatiladi.
 */
export async function listPayments(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const q = req.query as Record<string, string>

    const take = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 200)
    const page = Math.max(parseInt(q.page ?? '1', 10) || 1, 1)

    // Tashkilot doirasi — tenant va tuman izolatsiyasi (lib/ekoScope yagona manba)
    const entityWhere: any = { ...entityScopeWhere(user) }

    if (q.districtId) {
      if (!canAccessDistrict(user, q.districtId)) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      entityWhere.districtId = q.districtId
    }
    if (q.mahallId) entityWhere.mahallId = q.mahallId
    if (q.search) {
      const s = q.search.trim()
      entityWhere.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { stir: { contains: s, mode: 'insensitive' } },
      ]
    }

    const where: any = { entity: entityWhere }

    if (q.entityId) {
      // Bitta tashkilot so'ralganda uning o'zi ham doiradan chiqmasligi kerak
      const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
        where: { id: q.entityId },
        select: { orgId: true, districtId: true },
      })
      if (!entity || entity.orgId !== user.orgId) {
        res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
        return
      }
      if (!canAccessEntity(user, entity)) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      where.entityId = q.entityId
    }

    if (q.month) {
      if (!isValidMonth(q.month)) {
        res.status(400).json({ success: false, error: 'month formati: "YYYY-MM"' })
        return
      }
      where.month = q.month
    }
    if (q.receivedBy) where.receivedBy = q.receivedBy

    // Sana oralig'i — to'lov qabul qilingan vaqt bo'yicha, O'zbekiston kuni (UTC+5) chegarasida
    if (q.from || q.to) {
      if ((q.from && !isValidIsoDate(q.from)) || (q.to && !isValidIsoDate(q.to))) {
        res.status(400).json({ success: false, error: 'from/to formati: "YYYY-MM-DD" (haqiqiy sana)' })
        return
      }
      where.paidAt = {}
      if (q.from) where.paidAt.gte = dayBoundsUz(q.from)!.start
      if (q.to) where.paidAt.lt = dayBoundsUz(q.to)!.end
    }

    const [total, sumAgg, payments] = await Promise.all([
      (prisma as any).ekoHisobPayment.count({ where }),
      (prisma as any).ekoHisobPayment.aggregate({ where, _sum: { amount: true } }),
      (prisma as any).ekoHisobPayment.findMany({
        where,
        include: {
          entity: { select: { id: true, name: true, districtId: true } },
          receiver: { select: { id: true, fullName: true } },
          receipt: { select: { receiptNumber: true } },
        },
        orderBy: { paidAt: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
    ])

    res.json({
      success: true,
      data: payments,
      // Jami summa sahifalashdan MUSTAQIL — foydalanuvchi filtr bo'yicha
      // umumiy summani ko'radi, faqat shu sahifadagini emas.
      meta: { total, page, limit: take, totalAmount: sumAgg._sum.amount || 0 },
    })
  } catch (err) { next(err) }
}

export async function recordPayment(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { entityId, month, amount, note, force, method } = req.body ?? {}

    if (!entityId || !month || amount === undefined) {
      res.status(400).json({ success: false, error: 'entityId, month va amount talab qilinadi' })
      return
    }
    if (typeof entityId !== 'string') {
      res.status(400).json({ success: false, error: 'entityId noto\'g\'ri' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id: entityId },
      select: { id: true, orgId: true, districtId: true, name: true },
    })
    if (!entity || entity.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, entity)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    // FK kafolati: asosiy AutoHisob admin sifatida kirilgan bo'lsa ekohisob_users da
    // qator bo'lmasligi mumkin — u holda to'lov FK xatosi bilan tugardi.
    const actorId = await ensureEkoActor(user)

    // Idempotentlik kaliti: sarlavha (Idempotency-Key) yoki body.idempotencyKey
    const headerKey = req.header('idempotency-key')
    const idempotencyKey = (headerKey || req.body?.idempotencyKey || null) as string | null

    // Yozishning o'zi — veb va Telegram dala-boti uchun YAGONA yadro
    // (tranzaksiya+lock, taqsimot, kvitansiya, talon yopish, audit).
    let result
    try {
      result = await recordEkoPayment({
        entity, month: String(month), amount, note, actorId, force: Boolean(force),
        method, idempotencyKey, actor: user, source: 'web',
      })
    } catch (e) {
      if (e instanceof PaymentError) {
        res.status(e.status).json({
          success: false, error: e.message, code: e.code, data: e.data ?? undefined,
        })
        return
      }
      throw e
    }

    res.status(result.idempotentReplay ? 200 : 201).json({
      success: true,
      data: {
        ...result.primary,
        receiptNumber: result.receiptNumber,
        receiptId: result.receiptId,
        charge: result.charge,
        talonsClosed: result.talonsClosed,
        groupId: result.groupId,
        // Taqsimot — modal "eski qarzga o'tdi" deb ko'rsatadi
        allocations: result.allocations,
        appliedToOlder: result.appliedToOlder,
        advance: result.advance,
        // YANGI maydonlar
        remaining: result.remaining,
        verifyToken: result.verifyToken,
        idempotentReplay: result.idempotentReplay,
      },
    })
  } catch (err) { next(err) }
}

/**
 * GET /payments/charge-status?entityId=&month=
 * Tanlangan oy uchun: kutilgan summa, to'langan, qolgan qarz.
 * Qisman to'lov modali uchun.
 */
export async function getChargeStatus(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { entityId, month } = req.query
    if (!entityId || !month) {
      res.status(400).json({ success: false, error: 'entityId va month talab qilinadi' })
      return
    }
    const monthStr = String(month)
    if (!isValidMonth(monthStr)) {
      res.status(400).json({ success: false, error: 'month formati: "YYYY-MM"' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: String(entityId) } })
    if (!entity || entity.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, entity)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const charge = await (prisma as any).ekoHisobCharge.findUnique({
      where: { entityId_month: { entityId: String(entityId), month: monthStr } },
    })

    // Shu oy uchun barcha to'lovlar (tarix)
    const payments = await (prisma as any).ekoHisobPayment.findMany({
      where: { entityId: String(entityId), month: monthStr },
      include: { receiver: { select: { fullName: true } } },
      orderBy: { paidAt: 'asc' },
    })

    // Ochiq qarz oylari — kanonik manba (avans eng eski qarzni qoplaydi, talon qisman to'lovi hisobda).
    // Modal ortiqcha to'lov qayerga ketishini oldindan ko'rsatadi.
    const openDebts = await loadOpenDebts(entity, monthStr)
    const monthDebt = openDebts.find(d => d.month === monthStr)?.debt ?? 0

    // Talon rejimida "kutilgan summa" = shu oydagi to'lanmagan talonlar qoldig'i.
    // Ilgari monthlyFee (talonda 0) qaytarilardi va to'lov modali 0 so'm taklif qilardi.
    const isTalon = entity.billingMode === 'talon'
    const expectedAmount = isTalon ? monthDebt : (charge?.expectedAmount ?? entity.monthlyFee ?? 0)

    // Charge yo'q bo'lsa haqiqiy to'lovlar yig'indisidan (bir oyda bir necha to'lov bo'lishi mumkin)
    const monthPaid = sumPaymentsByMonth(payments).get(monthStr)?.paid ?? 0
    const paidAmount = isTalon ? monthPaid : (charge?.paidAmount ?? monthPaid)
    const remaining = entity.billingMode === 'variable'
      ? Math.max(0, expectedAmount - paidAmount)
      : monthDebt

    res.json({
      success: true,
      data: {
        expectedAmount,
        paidAmount,
        remaining,
        status: charge?.status ?? (paidAmount > 0 ? (remaining > 0 ? 'partial' : 'paid') : 'open'),
        billingMode: entity.billingMode,
        // Tanlangan oydan boshqa ochiq qarz oylari — ortiqcha summa shularga
        // (eng eskisidan) taqsimlanadi. Modal buni to'lovdan OLDIN ko'rsatadi.
        openDebts: openDebts
          .filter(d => d.month !== monthStr)
          .sort((a, b) => a.month.localeCompare(b.month)),
        payments: payments.map((p: any) => ({
          id: p.id, amount: p.amount, paidAt: p.paidAt,
          note: p.note, receiver: p.receiver?.fullName,
          method: p.method,
        })),
      },
    })
  } catch (err) { next(err) }
}

/**
 * DELETE /payments/:id — to'lovni bekor qiladi (admin only, SABAB MAJBURIY: kamida 5 belgi).
 *
 * Bekor qilish `reversePaymentGroup` orqali (talonni "to'lanmagan"ga qaytarish bilan
 * BIR XIL yadro): butun guruh (groupId) bitta tranzaksiyada, tashkilot bo'yicha lock
 * bilan; hisob/talon to'lovi qaytariladi; kvitansiya O'CHIRILMAYDI — storno (voidedAt,
 * voidReason, voidedBy) qilinadi. Qayta bekor qilish xavfsiz (idempotent).
 */
export async function deletePayment(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params
    const reason = parseReason(req.body?.reason)
    if (!reason) {
      res.status(400).json({
        success: false,
        error: 'Bekor qilish sababi majburiy (kamida 5 belgi)',
        code: 'REASON_REQUIRED',
      })
      return
    }

    const payment = await (prisma as any).ekoHisobPayment.findUnique({
      where: { id },
      include: {
        entity: { select: { id: true, orgId: true, districtId: true, name: true } },
        receipt: { select: { id: true, receiptNumber: true } },
      },
    })

    if (!payment || payment.entity.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'To\'lov topilmadi' })
      return
    }
    if (!canAccessEntity(user, payment.entity)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const actorId = await ensureEkoActor(user)

    const result = await prisma.$transaction(
      (tx: any) => reversePaymentGroup(tx, { paymentId: id, orgId: user.orgId, reason, actorId }),
      { timeout: 20_000, maxWait: 15_000 },
    )

    if (result.alreadyReversed) {
      res.json({
        success: true,
        data: {
          alreadyReversed: true, chargeAfter: null, chargesAfter: [], talonsRestored: 0,
          deletedCount: 0, totalAmount: 0,
        },
        message: 'To\'lov allaqachon bekor qilingan',
      })
      return
    }

    await logEkoAudit(user, {
      action: 'payment.delete',
      targetType: 'payment',
      targetId: id,
      targetName: payment.entity.name,
      amount: result.totalAmount,
      details: {
        month: payment.month,
        reason,
        // Kvitansiya mijoz qo'lida qog'ozda qolishi mumkin — raqami tarixda saqlanadi (storno qilingan)
        receiptNumber: payment.receipt?.receiptNumber ?? null,
        voidedReceipts: result.receiptNumbers,
        groupId: result.groupId,
        deletedRows: result.deletedRows.map(r => `${r.month}: ${r.amount}`),
        chargesAfter: result.chargesAfter,
        talonsRestored: result.talonsRestored,
      },
    })

    const parts: string[] = []
    if (result.deletedCount > 1) parts.push(`${result.deletedCount} ta oy bo'yicha yozuv bekor qilindi`)
    if (result.talonsRestored > 0) parts.push(`${result.talonsRestored} ta talon qarzga qaytarildi`)

    res.json({
      success: true,
      data: {
        chargeAfter: result.chargesAfter[0] ?? null,   // avvalgi javob shakli saqlanadi
        chargesAfter: result.chargesAfter,
        talonsRestored: result.talonsRestored,
        deletedCount: result.deletedCount,
        totalAmount: result.totalAmount,
        voidedReceipts: result.receiptNumbers,
      },
      message: parts.length > 0
        ? `To'lov o'chirildi: ${parts.join(', ')}`
        : 'To\'lov o\'chirildi',
    })
  } catch (err) { next(err) }
}
