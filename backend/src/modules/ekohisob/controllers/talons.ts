import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { talonMonth, talonPaidPart } from '../lib/debtMath'
import { logEkoAudit } from '../lib/ekoAudit'
import { ensureEkoActor } from '../lib/ekoActor'
import { canAccessEntity, entityScopeWhere } from '../lib/ekoScope'
import { daysInMonth, isValidIsoDate, isValidMonth, parseDateOnly, todayUz } from '../lib/uzt'
import { parseReason } from '../lib/money'
import { computeTalonAmount, parseVolume } from '../lib/talonPay'
import { recordEkoPayment, PaymentError } from '../services/paymentService'
import { reversePaymentGroup } from '../services/paymentReversal'

// Tashkilot org/tumaniga foydalanuvchi kira oladimi tekshiradi (lib/ekoScope — yagona manba)
async function checkEntityAccess(entityId: string, req: EkoRequest): Promise<{ ok: boolean; entity?: any; error?: string; code?: number }> {
  const user = req.ekoUser!
  const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: entityId } })
  if (!entity || entity.orgId !== user.orgId) return { ok: false, error: 'Tashkilot topilmadi', code: 404 }
  if (!canAccessEntity(user, entity)) {
    return { ok: false, error: 'Ushbu tumanga kirish taqiqlangan', code: 403 }
  }
  return { ok: true, entity }
}

/**
 * Sana chegarasi ("from"/"to"): "YYYY-MM-DD". Frontend oy filtri uchun `${month}-31`
 * yuboradi — noyabrda "2026-11-31" haqiqiy sana emas (Prisma 500 berardi). Kun oyning
 * oxirgi kunidan oshsa oy oxiriga QISQARTIRILADI. Butunlay yaroqsiz → null.
 */
export function clampRangeDay(s: string): string | null {
  const m = /^(\d{4}-\d{2})-(\d{2})$/.exec(s)
  if (!m || !isValidMonth(m[1])) return null
  const day = Number(m[2])
  if (day < 1) return null
  const last = daysInMonth(m[1])
  return `${m[1]}-${String(Math.min(day, last)).padStart(2, '0')}`
}

/**
 * GET /talons?entityId=&from=&to=&month=
 * Talon ro'yxati (tashkilot bo'yicha yoki davr bo'yicha).
 * `month=YYYY-MM` — oyning to'liq oralig'i (from/to ustidan).
 */
export async function listTalons(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const q = req.query as Record<string, string>
    const { entityId } = q
    let { from, to } = q

    const where: any = { orgId: user.orgId }
    if (entityId) {
      const access = await checkEntityAccess(entityId, req)
      if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }
      where.entityId = entityId
    } else {
      // Tuman nazorati: admin — butun korxona, qolganlar — faqat o'z tumanlari (bog'lanish filtri)
      where.entity = entityScopeWhere(user)
    }

    if (q.month) {
      if (!isValidMonth(q.month)) {
        res.status(400).json({ success: false, error: 'month formati: "YYYY-MM"' })
        return
      }
      from = `${q.month}-01`
      to = `${q.month}-${String(daysInMonth(q.month)).padStart(2, '0')}`
    }
    if (from || to) {
      where.date = {}
      if (from) {
        const f = clampRangeDay(from)
        if (!f) { res.status(400).json({ success: false, error: 'from formati: "YYYY-MM-DD"' }); return }
        where.date.gte = parseDateOnly(f)
      }
      if (to) {
        const t = clampRangeDay(to)
        if (!t) { res.status(400).json({ success: false, error: 'to formati: "YYYY-MM-DD"' }); return }
        where.date.lte = parseDateOnly(t)
      }
    }

    // Faqat to'lanmaganlarini ko'rish (qarz bo'yicha ishlash uchun)
    if (req.query.paid === 'false') where.paid = false
    if (req.query.paid === 'true') where.paid = true

    const take = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500)
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1)

    // Jamlar SAHIFALASHDAN MUSTAQIL — DB tomonida hisoblanadi.
    const [count, agg, paidAgg, talons] = await Promise.all([
      (prisma as any).ekoHisobTalon.count({ where }),
      (prisma as any).ekoHisobTalon.aggregate({ where, _sum: { amount: true, volume: true } }),
      // Qarz = Σ(amount − paidAmount) to'lanmaganlar bo'yicha (qisman to'lov hisobga olinadi)
      (prisma as any).ekoHisobTalon.aggregate({ where: { ...where, paid: false }, _sum: { amount: true, paidAmount: true } }),
      (prisma as any).ekoHisobTalon.findMany({
        where,
        include: { entity: { select: { id: true, name: true } } },
        orderBy: { date: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
    ])

    res.json({
      success: true,
      data: {
        talons,
        total: agg._sum.amount || 0,
        totalUnpaid: Math.max(0, (paidAgg._sum.amount || 0) - (paidAgg._sum.paidAmount || 0)),
        totalVolume: agg._sum.volume || 0,
        count,
      },
      meta: { total: count, page, limit: take },
    })
  } catch (err) { next(err) }
}

/**
 * POST /talons
 * { entityId, volume, date?, note? } — yangi talon (bajarilgan ish, kub)
 * Summa avtomatik: amount = volume × tashkilot cubicPrice (butun so'm, float xatosiz)
 */
export async function createTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId } = req.ekoUser!
    const { entityId, volume, date, note, paid } = req.body ?? {}

    if (!entityId || volume === undefined) {
      res.status(400).json({ success: false, error: 'entityId va volume (kub) talab qilinadi' })
      return
    }
    const parsedVolume = parseVolume(volume)
    if (parsedVolume === null) {
      res.status(400).json({ success: false, error: 'Kub (hajm) musbat son bo\'lishi kerak (ko\'pi bilan 3 xona kasr)' })
      return
    }

    const access = await checkEntityAccess(String(entityId), req)
    if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }

    const cubicPrice = access.entity.cubicPrice || 0
    if (cubicPrice <= 0) {
      res.status(400).json({ success: false, error: 'Tashkilotga bir kub narxi belgilanmagan. Avval narxni kiriting.' })
      return
    }
    const amount = computeTalonAmount(parsedVolume, cubicPrice)
    if (amount <= 0) {
      res.status(400).json({ success: false, error: 'Talon summasi 0 bo\'lib qoldi — hajmni tekshiring' })
      return
    }

    // Sana: UZT bo'yicha (berilmasa bugun); yaroqsiz sana 400 (Prisma 500 emas)
    const dateStr = date ? String(date) : todayUz()
    const talonDate = isValidIsoDate(dateStr) ? parseDateOnly(dateStr) : null
    if (!talonDate) {
      res.status(400).json({ success: false, error: 'date formati: "YYYY-MM-DD" (haqiqiy sana)' })
      return
    }

    const talon = await (prisma as any).ekoHisobTalon.create({
      data: {
        entityId, orgId,
        volume: parsedVolume,
        amount,
        date: talonDate,
        note: note ? String(note).trim().slice(0, 300) : null,
        createdBy: userId || null,
        paid: false,   // "to'landi" faqat to'lov yadrosi orqali — u rasmiy to'lov + kvitansiya yaratadi
      },
      include: { entity: { select: { id: true, name: true } } },
    })

    await logEkoAudit(req.ekoUser, {
      action: 'talon.create',
      targetType: 'talon',
      targetId: talon.id,
      targetName: access.entity.name,
      amount,
      details: { volume: parsedVolume, cubicPrice, date: talonMonth(talonDate) },
    })

    // Talon yaratilishi bilanoq to'landi deb belgilangan bo'lsa — to'lovni ham yozamiz
    if (paid) {
      let paidError: string | null = null
      const marked = await markTalonPaid(talon.id, req).catch((e) => {
        paidError = e instanceof PaymentError ? e.message : 'To\'lov yozilmadi'
        return null
      })
      if (marked) {
        res.status(201).json({ success: true, data: { ...marked.talon, cubicPrice, receiptNumber: marked.receiptNumber } })
        return
      }
      res.status(201).json({ success: true, data: { ...talon, cubicPrice, paidError } })
      return
    }

    res.status(201).json({ success: true, data: { ...talon, cubicPrice } })
  } catch (err) { next(err) }
}

/**
 * Talonni "to'landi" deb belgilaydi VA rasmiy to'lov + kvitansiya yaratadi.
 *
 * Endi mustaqil nusxa YO'Q: butun yozuv `recordEkoPayment` yadrosidan o'tadi
 * (tranzaksiya, tashkilot qulfi, talon "claim" — ikki parallel so'rov ikki to'lov
 * yaratmaydi, groupId, kvitansiya raqami teshiksiz, audit). Talon qisman to'langan
 * bo'lsa qoldig'i to'lanadi.
 */
async function markTalonPaid(
  talonId: string,
  req: EkoRequest,
): Promise<{ talon: any; receiptNumber: string | null }> {
  const user = req.ekoUser!
  const actorId = await ensureEkoActor(user)

  const talon = await (prisma as any).ekoHisobTalon.findUnique({
    where: { id: talonId },
    include: { entity: { select: { id: true, name: true } } },
  })
  if (!talon) throw new PaymentError('TALON_NOT_FOUND', 'Talon topilmadi', 404)
  const month = talonMonth(talon.date)

  const result = await recordEkoPayment({
    entity: { id: talon.entityId },
    month,
    talonId,
    note: `Talon: ${talon.volume} kub${talon.note ? ` — ${talon.note}` : ''}`.slice(0, 300),
    actorId,
    actor: user,
    source: 'talon',
  })

  const updated = await (prisma as any).ekoHisobTalon.findUnique({ where: { id: talonId } })

  await logEkoAudit(user, {
    action: 'talon.paid',
    targetType: 'talon',
    targetId: talonId,
    targetName: talon.entity?.name ?? null,
    amount: result.allocations.reduce((s, a) => s + a.amount, 0),
    details: { month, paymentId: result.primary.id, receiptNumber: result.receiptNumber, groupId: result.groupId },
  })

  return { talon: updated, receiptNumber: result.receiptNumber }
}

/**
 * Talon to'lovini bekor qiladi (to'lanmagan'ga qaytarish yoki o'chirish uchun).
 * SABAB MAJBURIY (kamida 5 belgi). Bog'langan to'lov guruhi `reversePaymentGroup` bilan
 * (deletePayment bilan BIR XIL yadro) bitta tranzaksiyada storno qilinadi.
 * Qaytaradi: reversal natijasi yoki null (talonda bog'langan to'lov yo'q).
 */
async function reverseTalonPayment(tx: any, talon: any, reason: string, orgId: string, actorId: string) {
  if (!talon.paymentId) return null
  return reversePaymentGroup(tx, {
    paymentId: talon.paymentId, orgId, reason, actorId, preferTalonIds: [talon.id],
  })
}

/**
 * PATCH /talons/:id — talon holati (paid) yoki kub (volume → amount qayta hisoblanadi).
 * paid=true → rasmiy to'lov + kvitansiya yaratiladi (qoldiq to'lanadi);
 * paid=false → bog'langan to'lov bekor qilinadi (reason majburiy).
 */
export async function updateTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params
    const { paid, volume, note } = req.body ?? {}

    const talon = await (prisma as any).ekoHisobTalon.findUnique({
      where: { id }, include: { entity: { select: { id: true, name: true, cubicPrice: true } } },
    })
    if (!talon || talon.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Talon topilmadi' })
      return
    }
    // Tuman nazorati (lib/ekoScope)
    const access = await checkEntityAccess(talon.entityId, req)
    if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }

    const hasPayment = talon.paid || talonPaidPart(talon) > 0

    // Summa/hajm o'zgarishi — to'langan (hatto qisman) talonda taqiqlanadi (to'lov summasi bilan ziddiyat)
    if (volume !== undefined && hasPayment) {
      res.status(400).json({
        success: false,
        error: 'To\'langan talon hajmini o\'zgartirib bo\'lmaydi. Avval to\'lovni bekor qiling.',
      })
      return
    }

    const data: any = {}
    if (note !== undefined) data.note = note ? String(note).trim().slice(0, 300) : null
    if (volume !== undefined) {
      const v = parseVolume(volume)
      if (v === null) {
        res.status(400).json({ success: false, error: 'Kub (hajm) musbat son bo\'lishi kerak (ko\'pi bilan 3 xona kasr)' })
        return
      }
      const newAmount = computeTalonAmount(v, talon.entity.cubicPrice || 0)
      if (newAmount <= 0) {
        res.status(400).json({ success: false, error: 'Talon summasi 0 bo\'lib qoldi — narx yoki hajmni tekshiring' })
        return
      }
      data.volume = v
      data.amount = newAmount
    }

    // ── To'lov holati ──
    const wantPaid = paid === undefined ? talon.paid : Boolean(paid)
    const unpay = !wantPaid && hasPayment && paid !== undefined
    let reason: string | null = null
    if (unpay) {
      reason = parseReason(req.body?.reason)
      if (!reason) {
        res.status(400).json({
          success: false,
          error: 'To\'lovni bekor qilish sababi majburiy (kamida 5 belgi)',
          code: 'REASON_REQUIRED',
        })
        return
      }
      if (!talon.paymentId) {
        res.status(409).json({
          success: false,
          error: 'Bu talonga bog\'langan to\'lov topilmadi. To\'lovni "To\'lovlar" ro\'yxatidan bekor qiling.',
          code: 'NO_LINKED_PAYMENT',
        })
        return
      }
    }

    if (Object.keys(data).length > 0) {
      await (prisma as any).ekoHisobTalon.update({ where: { id }, data })
      await logEkoAudit(req.ekoUser, {
        action: 'talon.update',
        targetType: 'talon',
        targetId: id,
        targetName: talon.entity?.name ?? null,
        amount: data.amount ?? talon.amount,
        details: { oldVolume: talon.volume, newVolume: data.volume, oldAmount: talon.amount },
      })
    }

    let receiptNumber: string | null = null

    if (wantPaid && !(talon.paid)) {
      try {
        const marked = await markTalonPaid(id, req)
        receiptNumber = marked.receiptNumber
      } catch (e) {
        if (e instanceof PaymentError) {
          res.status(e.status).json({ success: false, error: e.message, code: e.code })
          return
        }
        throw e
      }
    } else if (unpay) {
      const actorId = await ensureEkoActor(user)
      const rev = await prisma.$transaction(
        (tx: any) => reverseTalonPayment(tx, talon, reason!, user.orgId, actorId),
        { timeout: 20_000, maxWait: 15_000 },
      )
      await logEkoAudit(req.ekoUser, {
        action: 'talon.unpaid',
        targetType: 'talon',
        targetId: id,
        targetName: talon.entity?.name ?? null,
        amount: talon.amount,
        details: {
          revertedPaymentId: talon.paymentId ?? null,
          reason,
          alreadyReversed: rev?.alreadyReversed ?? false,
          voidedReceipts: rev?.receiptNumbers ?? [],
          reversedTotal: rev?.totalAmount ?? 0,
        },
      })
    }

    const updated = await (prisma as any).ekoHisobTalon.findUnique({ where: { id } })
    res.json({ success: true, data: { ...updated, receiptNumber } })
  } catch (err) { next(err) }
}

/**
 * DELETE /talons/:id — talonni o'chiradi. To'langan (yoki qisman to'langan) bo'lsa
 * SABAB MAJBURIY va bog'langan to'lov guruhi storno qilinadi (aks holda kassada
 * "havodan kelgan" pul qolardi). Hammasi bitta tranzaksiyada.
 */
export async function deleteTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params

    const talon = await (prisma as any).ekoHisobTalon.findUnique({
      where: { id }, include: { entity: { select: { name: true } } },
    })
    if (!talon || talon.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Talon topilmadi' })
      return
    }
    // Tuman nazorati (lib/ekoScope)
    const access = await checkEntityAccess(talon.entityId, req)
    if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }

    const hasPayment = talon.paid || talonPaidPart(talon) > 0
    let reason: string | null = null
    if (hasPayment) {
      reason = parseReason(req.body?.reason)
      if (!reason) {
        res.status(400).json({
          success: false,
          error: 'To\'langan talonni o\'chirish sababi majburiy (kamida 5 belgi)',
          code: 'REASON_REQUIRED',
        })
        return
      }
    }

    const actorId = hasPayment ? await ensureEkoActor(user) : ''
    const rev = await prisma.$transaction(async (tx: any) => {
      const r = hasPayment ? await reverseTalonPayment(tx, talon, reason!, user.orgId, actorId) : null
      await tx.ekoHisobTalon.deleteMany({ where: { id } })
      return r
    }, { timeout: 20_000, maxWait: 15_000 })

    await logEkoAudit(req.ekoUser, {
      action: 'talon.delete',
      targetType: 'talon',
      targetId: id,
      targetName: talon.entity?.name ?? null,
      amount: talon.amount,
      details: {
        volume: talon.volume, wasPaid: talon.paid, paidAmount: talonPaidPart(talon),
        revertedPaymentId: talon.paymentId ?? null, reason,
        voidedReceipts: rev?.receiptNumbers ?? [],
        // paid bo'lib, lekin bog'langan to'lovi yo'q (eski yozuv) — to'lovlar avans bo'lib qoladi
        orphanPayments: hasPayment && !talon.paymentId,
      },
    })

    res.json({
      success: true,
      data: null,
      message: hasPayment ? 'Talon va unga bog\'langan to\'lov o\'chirildi' : 'Talon o\'chirildi',
    })
  } catch (err) { next(err) }
}
