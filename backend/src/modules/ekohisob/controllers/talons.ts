import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { talonMonth } from '../lib/debtMath'
import { logEkoAudit } from '../lib/ekoAudit'
import { ensureEkoActor } from '../lib/ekoActor'
import { nextReceiptNum } from './receipts'

// Tashkilot org/tumaniga inspektor kira oladimi tekshiradi
async function checkEntityAccess(entityId: string, req: EkoRequest): Promise<{ ok: boolean; entity?: any; error?: string; code?: number }> {
  const { orgId, role, districtIds } = req.ekoUser!
  const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: entityId } })
  if (!entity || entity.orgId !== orgId) return { ok: false, error: 'Tashkilot topilmadi', code: 404 }
  if (role !== 'admin' && !districtIds.includes(entity.districtId)) {
    return { ok: false, error: 'Ushbu tumanga kirish taqiqlangan', code: 403 }
  }
  return { ok: true, entity }
}

/**
 * GET /talons?entityId=&from=&to=
 * Talon ro'yxati (tashkilot bo'yicha yoki davr bo'yicha)
 */
export async function listTalons(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { entityId, from, to } = req.query as Record<string, string>

    const where: any = { orgId }
    if (entityId) {
      const access = await checkEntityAccess(entityId, req)
      if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }
      where.entityId = entityId
    } else if (role !== 'admin') {
      // Inspektor/boshliq — faqat o'z tumanlari tashkilotlarining talonlari
      const ents = await (prisma as any).ekoHisobLegalEntity.findMany({
        where: { orgId, districtId: { in: districtIds } }, select: { id: true },
      })
      where.entityId = { in: ents.map((e: any) => e.id) }
    }
    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from + 'T00:00:00.000Z')
      if (to) where.date.lte = new Date(to + 'T00:00:00.000Z')
    }

    // Faqat to'lanmaganlarini ko'rish (qarz bo'yicha ishlash uchun)
    if (req.query.paid === 'false') where.paid = false
    if (req.query.paid === 'true') where.paid = true

    const take = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500)
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1)

    // Jamlar SAHIFALASHDAN MUSTAQIL — DB tomonida hisoblanadi. Ilgari ular
    // yuklangan 200 qator bo'yicha yig'ilardi, ya'ni undan ko'p talon bo'lsa
    // "jami" raqami noto'g'ri chiqardi.
    const [count, agg, unpaidAgg, talons] = await Promise.all([
      (prisma as any).ekoHisobTalon.count({ where }),
      (prisma as any).ekoHisobTalon.aggregate({ where, _sum: { amount: true, volume: true } }),
      (prisma as any).ekoHisobTalon.aggregate({ where: { ...where, paid: false }, _sum: { amount: true } }),
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
        totalUnpaid: unpaidAgg._sum.amount || 0,
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
 * Summa avtomatik: amount = volume × tashkilot cubicPrice
 */
export async function createTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId } = req.ekoUser!
    const { entityId, volume, date, note, paid } = req.body

    if (!entityId || volume === undefined) {
      res.status(400).json({ success: false, error: 'entityId va volume (kub) talab qilinadi' })
      return
    }
    const parsedVolume = parseFloat(String(volume))
    if (isNaN(parsedVolume) || parsedVolume <= 0) {
      res.status(400).json({ success: false, error: 'Kub (hajm) musbat son bo\'lishi kerak' })
      return
    }

    const access = await checkEntityAccess(entityId, req)
    if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }

    const cubicPrice = access.entity.cubicPrice || 0
    if (cubicPrice <= 0) {
      res.status(400).json({ success: false, error: 'Tashkilotga bir kub narxi belgilanmagan. Avval narxni kiriting.' })
      return
    }
    const amount = Math.round(parsedVolume * cubicPrice)

    const talonDate = date ? new Date(date + 'T00:00:00.000Z') : new Date()

    const talon = await (prisma as any).ekoHisobTalon.create({
      data: {
        entityId, orgId,
        volume: parsedVolume,
        amount,
        date: talonDate,
        note: note ? String(note).trim() : null,
        createdBy: userId || null,
        paid: false,   // "to'landi" faqat PATCH orqali — u rasmiy to'lov + kvitansiya yaratadi
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
      const marked = await markTalonPaid(talon.id, req).catch(() => null)
      if (marked) {
        res.status(201).json({ success: true, data: { ...marked.talon, cubicPrice, receiptNumber: marked.receiptNumber } })
        return
      }
    }

    res.status(201).json({ success: true, data: { ...talon, cubicPrice } })
  } catch (err) { next(err) }
}

/**
 * Talonni "to'landi" deb belgilaydi VA rasmiy to'lov + kvitansiya yaratadi.
 *
 * Nega: ilgari `paid=true` faqat bayroq edi — pul olingan, lekin EkoHisobPayment
 * yozuvi yo'q edi. Natijada talon puli hisobotlarda, kunlik yig'imda va inspektor
 * samaradorligida umuman ko'rinmasdi. Endi talon to'lovi ham oddiy to'lov kabi
 * hisobga tushadi (oy = talon sanasi oyi).
 */
async function markTalonPaid(
  talonId: string,
  req: EkoRequest,
): Promise<{ talon: any; receiptNumber: string | null }> {
  const { orgId } = req.ekoUser!
  const actorId = await ensureEkoActor(req.ekoUser!)

  const talon = await (prisma as any).ekoHisobTalon.findUnique({
    where: { id: talonId },
    include: { entity: { select: { id: true, name: true } } },
  })
  const month = talonMonth(talon.date)

  const payment = await (prisma as any).ekoHisobPayment.create({
    data: {
      entityId: talon.entityId,
      month,
      amount: talon.amount,
      receivedBy: actorId,
      note: `Talon: ${talon.volume} kub${talon.note ? ` — ${talon.note}` : ''}`,
    },
  })

  let receiptNumber: string | null = null
  try {
    receiptNumber = await nextReceiptNum(orgId)
    await (prisma as any).ekoHisobReceipt.create({
      data: {
        receiptNumber, orgId,
        entityId: talon.entityId,
        paymentId: payment.id,
        month,
        amount: talon.amount,
        issuedBy: actorId,
      },
    })
  } catch (receiptErr: any) {
    console.warn('EkoHisob: talon kvitansiyasi yaratilmadi (to\'lov saqlanadi):', receiptErr?.message)
    receiptNumber = null
  }

  const updated = await (prisma as any).ekoHisobTalon.update({
    where: { id: talonId },
    data: { paid: true, paymentId: payment.id },
  })

  await logEkoAudit(req.ekoUser, {
    action: 'talon.paid',
    targetType: 'talon',
    targetId: talonId,
    targetName: talon.entity?.name ?? null,
    amount: talon.amount,
    details: { month, paymentId: payment.id, receiptNumber },
  })

  return { talon: updated, receiptNumber }
}

/**
 * PATCH /talons/:id — talon holati (paid) yoki kub (volume → amount qayta hisoblanadi).
 * paid=true → rasmiy to'lov + kvitansiya yaratiladi; paid=false → o'sha to'lov bekor qilinadi.
 */
export async function updateTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { paid, volume, note } = req.body

    const talon = await (prisma as any).ekoHisobTalon.findUnique({
      where: { id }, include: { entity: { select: { id: true, name: true, cubicPrice: true } } },
    })
    if (!talon || talon.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Talon topilmadi' })
      return
    }
    // Tuman nazorati — ilgari faqat orgId tekshirilardi: bir tuman inspektori
    // boshqa tumandagi talonni o'zgartira/o'chira olardi.
    const access = await checkEntityAccess(talon.entityId, req)
    if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }

    // Summa/hajm o'zgarishi — to'langan talonda taqiqlanadi (to'lov summasi bilan ziddiyat)
    if (volume !== undefined && talon.paid) {
      res.status(400).json({
        success: false,
        error: 'To\'langan talon hajmini o\'zgartirib bo\'lmaydi. Avval to\'lovni bekor qiling.',
      })
      return
    }

    const data: any = {}
    if (note !== undefined) data.note = note ? String(note).trim() : null
    if (volume !== undefined) {
      const v = parseFloat(String(volume))
      if (isNaN(v) || v <= 0) {
        res.status(400).json({ success: false, error: 'Kub (hajm) musbat son bo\'lishi kerak' })
        return
      }
      data.volume = v
      data.amount = Math.round(v * (talon.entity.cubicPrice || 0))
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

    // ── To'lov holati ──
    const wantPaid = paid === undefined ? talon.paid : Boolean(paid)
    let receiptNumber: string | null = null

    if (wantPaid && !talon.paid) {
      const marked = await markTalonPaid(id, req)
      receiptNumber = marked.receiptNumber
    } else if (!wantPaid && talon.paid) {
      // To'lovni bekor qilish — bog'langan to'lov va kvitansiya ham o'chadi
      await prisma.$transaction(async (tx: any) => {
        if (talon.paymentId) {
          await tx.ekoHisobPayment.deleteMany({ where: { id: talon.paymentId } })
        }
        await tx.ekoHisobTalon.update({ where: { id }, data: { paid: false, paymentId: null } })
      })
      await logEkoAudit(req.ekoUser, {
        action: 'talon.unpaid',
        targetType: 'talon',
        targetId: id,
        targetName: talon.entity?.name ?? null,
        amount: talon.amount,
        details: { revertedPaymentId: talon.paymentId ?? null },
      })
    }

    const updated = await (prisma as any).ekoHisobTalon.findUnique({ where: { id } })
    res.json({ success: true, data: { ...updated, receiptNumber } })
  } catch (err) { next(err) }
}

/**
 * DELETE /talons/:id — talonni o'chiradi. To'langan bo'lsa bog'langan to'lov ham bekor
 * qilinadi (aks holda kassada "havodan kelgan" pul qolardi).
 */
export async function deleteTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 300) : null

    const talon = await (prisma as any).ekoHisobTalon.findUnique({
      where: { id }, include: { entity: { select: { name: true } } },
    })
    if (!talon || talon.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Talon topilmadi' })
      return
    }
    // Tuman nazorati (ilgari yo'q edi)
    const access = await checkEntityAccess(talon.entityId, req)
    if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }

    await prisma.$transaction(async (tx: any) => {
      if (talon.paymentId) {
        await tx.ekoHisobPayment.deleteMany({ where: { id: talon.paymentId } })
      }
      await tx.ekoHisobTalon.delete({ where: { id } })
    })

    await logEkoAudit(req.ekoUser, {
      action: 'talon.delete',
      targetType: 'talon',
      targetId: id,
      targetName: talon.entity?.name ?? null,
      amount: talon.amount,
      details: { volume: talon.volume, wasPaid: talon.paid, revertedPaymentId: talon.paymentId ?? null, reason },
    })

    res.json({
      success: true,
      data: null,
      message: talon.paid ? 'Talon va unga bog\'langan to\'lov o\'chirildi' : 'Talon o\'chirildi',
    })
  } catch (err) { next(err) }
}
