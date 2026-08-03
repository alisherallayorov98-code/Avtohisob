import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { sumPaymentsByMonth, applyPaymentReversal } from '../lib/debtMath'
import { recordEkoPayment, loadOpenDebts, PaymentError } from '../services/paymentService'
import { logEkoAudit } from '../lib/ekoAudit'
import { ensureEkoActor } from '../lib/ekoActor'

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
    const { orgId, role, districtIds } = req.ekoUser!
    const q = req.query as Record<string, string>

    const take = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 200)
    const page = Math.max(parseInt(q.page ?? '1', 10) || 1, 1)

    // Tashkilot doirasi — tenant va tuman izolatsiyasi
    const entityWhere: any = { orgId }
    if (role !== 'admin') entityWhere.districtId = { in: districtIds }

    if (q.districtId) {
      if (role !== 'admin' && !districtIds.includes(q.districtId)) {
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
      if (!entity || entity.orgId !== orgId) {
        res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
        return
      }
      if (role !== 'admin' && !districtIds.includes(entity.districtId)) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      where.entityId = q.entityId
    }

    if (q.month && /^\d{4}-\d{2}$/.test(q.month)) where.month = q.month
    if (q.receivedBy) where.receivedBy = q.receivedBy

    // Sana oralig'i — to'lov qabul qilingan vaqt bo'yicha
    if (q.from || q.to) {
      where.paidAt = {}
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.from ?? '')) where.paidAt.gte = new Date(q.from + 'T00:00:00.000Z')
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to ?? '')) where.paidAt.lte = new Date(q.to + 'T23:59:59.999Z')
      if (Object.keys(where.paidAt).length === 0) delete where.paidAt
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
    const { orgId, role, districtIds } = req.ekoUser!
    const { entityId, month, amount, note, force } = req.body

    if (!entityId || !month || amount === undefined) {
      res.status(400).json({ success: false, error: 'entityId, month va amount talab qilinadi' })
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

    // FK kafolati: asosiy AutoHisob admin sifatida kirilgan bo'lsa ekohisob_users da
    // qator bo'lmasligi mumkin — u holda to'lov FK xatosi bilan tugardi.
    const actorId = await ensureEkoActor(req.ekoUser!)

    // Yozishning o'zi — veb va Telegram dala-boti uchun YAGONA yadro
    // (taqsimot, tranzaksiya, kvitansiya, talon yopish).
    let result
    try {
      result = await recordEkoPayment({
        entity, month: String(month), amount, note, actorId, force: Boolean(force),
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

    await logEkoAudit(req.ekoUser, {
      action: 'payment.create',
      targetType: 'payment',
      targetId: result.primary.id,
      targetName: entity.name,
      amount: result.allocations.reduce((s, a) => s + a.amount, 0),
      details: {
        month: String(month),
        receiptNumber: result.receiptNumber,
        note: note ?? null,
        talonsClosed: result.talonsClosed,
        groupId: result.groupId,
        // Qaysi oylarga taqsimlangani — keyin "pul qayerga ketdi" savoliga javob
        allocations: result.allocations.map(a => `${a.month}: ${a.amount}`),
        appliedToOlder: result.appliedToOlder,
        advance: result.advance,
        forced: Boolean(force),
      },
    })

    res.status(201).json({
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

    // Ochiq qarz oylari — modal ortiqcha to'lov qayerga ketishini oldindan ko'rsatadi
    const openDebts = await loadOpenDebts(entity, String(month))

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
        // Tanlangan oydan boshqa ochiq qarz oylari — ortiqcha summa shularga
        // (eng eskisidan) taqsimlanadi. Modal buni to'lovdan OLDIN ko'rsatadi.
        openDebts: openDebts
          .filter(d => d.month !== String(month))
          .sort((a, b) => a.month.localeCompare(b.month)),
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
 *
 * Bitta naqd to'lov bir necha oyga taqsimlangan bo'lsa (ortiqcha summa eski
 * qarzni yopgan), BUTUN guruh birga bekor qilinadi: kvitansiya bittа va u
 * to'liq summaga yozilgan — bo'lak-bo'lak bekor qilish hujjatni yolg'onga
 * aylantirardi.
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

    // Guruhdagi barcha yozuvlar (taqsimlangan to'lov) — eskilarida groupId yo'q
    const groupRows = payment.groupId
      ? await (prisma as any).ekoHisobPayment.findMany({
          where: { groupId: payment.groupId },
          select: { id: true, month: true, amount: true },
        })
      : [{ id: payment.id, month: payment.month, amount: payment.amount }]

    const result = await prisma.$transaction(async (tx: any) => {
      const chargesAfter: { month: string; paidAmount: number; status: string }[] = []
      let talonsRestored = 0

      for (const row of groupRows) {
        // 1. Hisobni (charge) qaytarish — paidAmount kamayadi, holat qayta hisoblanadi
        const charge = await tx.ekoHisobCharge.findUnique({
          where: { entityId_month: { entityId: payment.entityId, month: row.month } },
        })
        if (charge) {
          const reverted = applyPaymentReversal(charge, row.amount)
          await tx.ekoHisobCharge.update({ where: { id: charge.id }, data: reverted })
          chargesAfter.push({ month: row.month, ...reverted })
        }

        // 2. Shu to'lov orqali "to'landi" bo'lgan talonlarni qarzga qaytarish
        const restored = await tx.ekoHisobTalon.updateMany({
          where: { paymentId: row.id },
          data: { paid: false, paymentId: null },
        })
        talonsRestored += restored.count ?? 0
      }

      // 3. To'lovlarni o'chirish (kvitansiya cascade bilan ketadi — raqami auditda qoladi)
      await tx.ekoHisobPayment.deleteMany({ where: { id: { in: groupRows.map((r: any) => r.id) } } })

      return {
        chargeAfter: chargesAfter[0] ?? null,   // avvalgi javob shakli saqlanadi
        chargesAfter,
        talonsRestored,
        deletedCount: groupRows.length,
        totalAmount: groupRows.reduce((s: number, r: any) => s + r.amount, 0),
      }
    })

    await logEkoAudit(req.ekoUser, {
      action: 'payment.delete',
      targetType: 'payment',
      targetId: id,
      targetName: payment.entity.name,
      amount: result.totalAmount,
      details: {
        month: payment.month,
        reason,
        // Kvitansiya mijoz qo'lida qog'ozda qolishi mumkin — raqami tarixda saqlanadi
        receiptNumber: payment.receipt?.receiptNumber ?? null,
        groupId: payment.groupId ?? null,
        deletedRows: groupRows.map((r: any) => `${r.month}: ${r.amount}`),
        chargesAfter: result.chargesAfter,
        talonsRestored: result.talonsRestored,
      },
    })

    const parts: string[] = []
    if (result.deletedCount > 1) parts.push(`${result.deletedCount} ta oy bo'yicha yozuv bekor qilindi`)
    if (result.talonsRestored > 0) parts.push(`${result.talonsRestored} ta talon qarzga qaytarildi`)

    res.json({
      success: true,
      data: result,
      message: parts.length > 0
        ? `To'lov o'chirildi: ${parts.join(', ')}`
        : 'To\'lov o\'chirildi',
    })
  } catch (err) { next(err) }
}
