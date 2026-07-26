import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { nextReceiptNum } from './receipts'
import { sumPaymentsByMonth, chargeRowStatus, applyPaymentReversal } from '../lib/debtMath'
import { logEkoAudit } from '../lib/ekoAudit'
import { ensureEkoActor } from '../lib/ekoActor'

export async function listPayments(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { entityId, month, districtId } = req.query

    const where: any = {}

    if (entityId) {
      // Verify entity belongs to org
      const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: String(entityId) } })
      if (!entity || entity.orgId !== orgId) {
        res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
        return
      }
      if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      where.entityId = String(entityId)
    } else {
      // Filter by org through entities
      const entityWhere: any = { orgId }
      if (role === 'inspector') {
        entityWhere.districtId = { in: districtIds }
      }
      if (districtId) {
        if (role === 'inspector' && !districtIds.includes(String(districtId))) {
          res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
          return
        }
        entityWhere.districtId = String(districtId)
      }
      const orgEntities = await (prisma as any).ekoHisobLegalEntity.findMany({
        where: entityWhere,
        select: { id: true },
      })
      where.entityId = { in: orgEntities.map((e: any) => e.id) }
    }

    if (month) {
      where.month = String(month)
    }

    const payments = await (prisma as any).ekoHisobPayment.findMany({
      where,
      include: {
        entity: { select: { id: true, name: true, districtId: true } },
        receiver: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
    })

    res.json({ success: true, data: payments })
  } catch (err) { next(err) }
}

export async function recordPayment(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId, role, districtIds } = req.ekoUser!
    const { entityId, month, amount, note } = req.body

    if (!entityId || !month || amount === undefined) {
      res.status(400).json({ success: false, error: 'entityId, month va amount talab qilinadi' })
      return
    }

    // Validate month format: "2026-01"
    if (!/^\d{4}-\d{2}$/.test(String(month))) {
      res.status(400).json({ success: false, error: 'month formati: "YYYY-MM" (masalan: 2026-01)' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: entityId } })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }
    if (entity.status === 'inactive') {
      res.status(400).json({ success: false, error: 'Deaktiv tashkilotga to\'lov qilish mumkin emas' })
      return
    }

    const parsedAmount = parseInt(String(amount))
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ success: false, error: 'amount musbat son bo\'lishi kerak' })
      return
    }

    // FK kafolati: asosiy AutoHisob admin sifatida kirilgan bo'lsa ekohisob_users da
    // qator bo'lmasligi mumkin — u holda to'lov FK xatosi bilan tugardi.
    const actorId = await ensureEkoActor(req.ekoUser!)

    const payment = await (prisma as any).ekoHisobPayment.create({
      data: {
        entityId,
        month: String(month),
        amount: parsedAmount,
        receivedBy: actorId,
        note: note ? String(note).trim() : null,
      },
      include: {
        entity: { select: { id: true, name: true } },
        receiver: { select: { id: true, fullName: true } },
      },
    })

    // monthly_fixed tashkilotda shu oy uchun hisob (charge) bo'lsa — uni hisob-kitob qilamiz.
    // Charge mavjud bo'lsa: paidAmount += to'lov, status paid/partial. Mavjud bo'lmasa va
    // tashkilot fixed bo'lsa — charge yaratamiz (qarz to'g'ri ko'rinishi uchun).
    const existingCharge = await (prisma as any).ekoHisobCharge.findUnique({
      where: { entityId_month: { entityId, month: String(month) } },
    })
    if (existingCharge) {
      const paidAmount = existingCharge.paidAmount + parsedAmount
      await (prisma as any).ekoHisobCharge.update({
        where: { id: existingCharge.id },
        data: {
          paidAmount,
          status: chargeRowStatus(existingCharge.expectedAmount, paidAmount),
        },
      })
    } else if (entity.billingMode === 'monthly_fixed' && entity.monthlyFee > 0) {
      await (prisma as any).ekoHisobCharge.create({
        data: {
          entityId,
          month: String(month),
          expectedAmount: entity.monthlyFee,
          paidAmount: parsedAmount,
          status: chargeRowStatus(entity.monthlyFee, parsedAmount),
        },
      })
    }

    // Kvitansiya raqami — atomik ketma-ket (orgId bo'yicha, yillik)
    let receiptNumber: string | null = null
    let receiptId: string | null = null
    try {
      receiptNumber = await nextReceiptNum(orgId)
      const rec = await (prisma as any).ekoHisobReceipt.create({
        data: {
          receiptNumber,
          orgId,
          entityId,
          paymentId: payment.id,
          month: String(month),
          amount: parsedAmount,
          issuedBy: actorId,
        },
        select: { id: true },
      })
      receiptId = rec.id
    } catch (receiptErr: any) {
      console.warn('EkoHisob: kvitansiya yaratishda xato (to\'lov saqlanadi):', receiptErr?.message)
      receiptNumber = null
    }

    // Qisman to'lov holatini javobga qo'shamiz (frontend progress uchun)
    let chargeInfo: { expectedAmount: number; paidAmount: number; remaining: number; status: string } | null = null
    const ch = await (prisma as any).ekoHisobCharge.findUnique({
      where: { entityId_month: { entityId, month: String(month) } },
    })
    if (ch) {
      chargeInfo = {
        expectedAmount: ch.expectedAmount,
        paidAmount: ch.paidAmount,
        remaining: Math.max(0, ch.expectedAmount - ch.paidAmount),
        status: ch.status,
      }
    }

    // Talon rejimi: to'lov shu oydagi to'lanmagan talonlarni eskisidan boshlab yopadi.
    // Bo'lmasa talon "to'lanmagan" qolib, to'lov qilingan tashkilot qarzdor ko'rinardi.
    let talonsClosed = 0
    if (entity.billingMode === 'talon') {
      const monthStart = new Date(String(month) + '-01T00:00:00.000Z')
      const monthEnd = new Date(monthStart)
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
      const openTalons = await (prisma as any).ekoHisobTalon.findMany({
        where: { entityId, paid: false, date: { gte: monthStart, lt: monthEnd } },
        orderBy: { date: 'asc' },
        select: { id: true, amount: true },
      })
      let left = parsedAmount
      const toClose: string[] = []
      for (const t of openTalons) {
        if (left < t.amount) break     // qisman qoplangan talon ochiq qoladi
        left -= t.amount
        toClose.push(t.id)
      }
      if (toClose.length > 0) {
        const upd = await (prisma as any).ekoHisobTalon.updateMany({
          where: { id: { in: toClose } },
          data: { paid: true, paymentId: payment.id },
        })
        talonsClosed = upd.count ?? 0
      }
    }

    await logEkoAudit(req.ekoUser, {
      action: 'payment.create',
      targetType: 'payment',
      targetId: payment.id,
      targetName: entity.name,
      amount: parsedAmount,
      details: { month: String(month), receiptNumber, note: note ?? null, talonsClosed },
    })

    res.status(201).json({
      success: true,
      data: { ...payment, receiptNumber, receiptId, charge: chargeInfo, talonsClosed },
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
    const { orgId, role, districtIds } = req.ekoUser!
    const { entityId, month } = req.query
    if (!entityId || !month) {
      res.status(400).json({ success: false, error: 'entityId va month talab qilinadi' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: String(entityId) } })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const charge = await (prisma as any).ekoHisobCharge.findUnique({
      where: { entityId_month: { entityId: String(entityId), month: String(month) } },
    })

    // Shu oy uchun barcha to'lovlar (tarix)
    const payments = await (prisma as any).ekoHisobPayment.findMany({
      where: { entityId: String(entityId), month: String(month) },
      include: { receiver: { select: { fullName: true } } },
      orderBy: { paidAt: 'asc' },
    })

    // Talon rejimida "kutilgan summa" = shu oydagi to'lanmagan talonlar yig'indisi.
    // Ilgari monthlyFee (talonda 0) qaytarilardi va to'lov modali 0 so'm taklif qilardi.
    let expectedAmount = charge?.expectedAmount ?? entity.monthlyFee ?? 0
    if (entity.billingMode === 'talon') {
      const monthStart = new Date(String(month) + '-01T00:00:00.000Z')
      const monthEnd = new Date(monthStart)
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
      const agg = await (prisma as any).ekoHisobTalon.aggregate({
        where: { entityId: String(entityId), paid: false, date: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
      })
      expectedAmount = agg._sum.amount || 0
    }

    // Charge yo'q bo'lsa haqiqiy to'lovlar yig'indisidan (bir oyda bir necha to'lov bo'lishi mumkin)
    const monthPaid = sumPaymentsByMonth(payments).get(String(month))?.paid ?? 0
    const paidAmount = entity.billingMode === 'talon'
      ? monthPaid
      : (charge?.paidAmount ?? monthPaid)
    const remaining = entity.billingMode === 'talon'
      ? expectedAmount   // to'lanmagan talonlar allaqachon "qolgan" summa
      : Math.max(0, expectedAmount - paidAmount)

    res.json({
      success: true,
      data: {
        expectedAmount,
        paidAmount,
        remaining,
        status: charge?.status ?? (paidAmount > 0 ? (remaining > 0 ? 'partial' : 'paid') : 'open'),
        billingMode: entity.billingMode,
        payments: payments.map((p: any) => ({
          id: p.id, amount: p.amount, paidAt: p.paidAt,
          note: p.note, receiver: p.receiver?.fullName,
        })),
      },
    })
  } catch (err) { next(err) }
}

/**
 * DELETE /payments/:id — to'lovni bekor qiladi (admin only).
 *
 * MUHIM: shu bilan birga hisob (charge) HAM qaytariladi. Ilgari faqat to'lov
 * o'chirilardi, charge.paidAmount esa shishgan holida qolardi — natijada xato
 * to'lovni o'chirgan tashkilot abadiy "to'langan" bo'lib qolar va qarzdorlar
 * ro'yxatiga hech qachon tushmasdi. Bog'langan talon ham qarzga qaytariladi.
 * Barchasi bitta tranzaksiyada — yarim bajarilgan holat qolmasin.
 */
export async function deletePayment(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 300) : null

    const payment = await (prisma as any).ekoHisobPayment.findUnique({
      where: { id },
      include: {
        entity: { select: { id: true, orgId: true, name: true } },
        receipt: { select: { id: true, receiptNumber: true } },
      },
    })

    if (!payment || payment.entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'To\'lov topilmadi' })
      return
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Hisobni (charge) qaytarish — paidAmount kamayadi, holat qayta hisoblanadi
      let chargeAfter: { paidAmount: number; status: string } | null = null
      const charge = await tx.ekoHisobCharge.findUnique({
        where: { entityId_month: { entityId: payment.entityId, month: payment.month } },
      })
      if (charge) {
        const reverted = applyPaymentReversal(charge, payment.amount)
        await tx.ekoHisobCharge.update({ where: { id: charge.id }, data: reverted })
        chargeAfter = reverted
      }

      // 2. Shu to'lov orqali "to'landi" bo'lgan talonlarni qarzga qaytarish
      const talonsRestored = await tx.ekoHisobTalon.updateMany({
        where: { paymentId: id },
        data: { paid: false, paymentId: null },
      })

      // 3. To'lovni o'chirish (kvitansiya cascade bilan ketadi — raqami auditda qoladi)
      await tx.ekoHisobPayment.delete({ where: { id } })

      return { chargeAfter, talonsRestored: talonsRestored.count ?? 0 }
    })

    await logEkoAudit(req.ekoUser, {
      action: 'payment.delete',
      targetType: 'payment',
      targetId: id,
      targetName: payment.entity.name,
      amount: payment.amount,
      details: {
        month: payment.month,
        reason,
        // Kvitansiya mijoz qo'lida qog'ozda qolishi mumkin — raqami tarixda saqlanadi
        receiptNumber: payment.receipt?.receiptNumber ?? null,
        chargeAfter: result.chargeAfter,
        talonsRestored: result.talonsRestored,
      },
    })

    res.json({
      success: true,
      data: result,
      message: result.talonsRestored > 0
        ? `To'lov o'chirildi, ${result.talonsRestored} ta talon qarzga qaytarildi`
        : 'To\'lov o\'chirildi',
    })
  } catch (err) { next(err) }
}
