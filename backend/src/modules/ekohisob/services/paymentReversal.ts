// EkoHisob — to'lov guruhini bekor qilish (storno) YAGONA yadrosi.
//
// deletePayment ham, talonni "to'lanmagan"ga qaytarish/o'chirish ham SHU funksiyadan
// o'tadi. Kafolatlar:
//  - BUTUN guruh (groupId) birga bekor qilinadi — kvitansiya bitta va to'liq summaga;
//  - kvitansiyalar O'CHIRILMAYDI: voidedAt/voidReason/voidedBy qo'yiladi (storno izi),
//    to'lov o'chganda paymentId FK SET NULL bo'ladi;
//  - charge.paidAmount va talon.paidAmount qaytariladi, manfiy bo'lmaydi;
//  - tashkilot bo'yicha advisory lock + qayta o'qish: ikki parallel so'rov ikki marta
//    ayirmaydi; qayta bekor qilish IDEMPOTENT ({alreadyReversed: true});
//  - hisob-kitob pure: lib/paymentPlan.planReversal (testlangan).
//
// `tx` — chaqiruvchi ochgan tranzaksiya klienti (prisma.$transaction ichida chaqiriladi).

import { planReversal } from '../lib/paymentPlan'

export interface ReverseInput {
  /** Guruhdagi istalgan to'lov id'si — guruh (groupId) shu orqali topiladi */
  paymentId: string
  /** Tenant chegarasi: to'lov shu korxonaga tegishli bo'lishi shart */
  orgId: string
  reason: string
  /** ekohisob_users id (voidedBy) */
  actorId: string
  /** Talon to'lovi birinchi navbatda shu talonlardan ayiriladi */
  preferTalonIds?: string[]
}

export interface ReverseResult {
  alreadyReversed: boolean
  entityId: string | null
  entityName: string | null
  month: string | null
  groupId: string | null
  deletedRows: { id: string; month: string; amount: number }[]
  deletedCount: number
  totalAmount: number
  receiptNumbers: string[]
  chargesAfter: { month: string; paidAmount: number; status: string }[]
  talonsRestored: number
}

const EMPTY: ReverseResult = {
  alreadyReversed: true, entityId: null, entityName: null, month: null, groupId: null,
  deletedRows: [], deletedCount: 0, totalAmount: 0, receiptNumbers: [], chargesAfter: [], talonsRestored: 0,
}

export async function reversePaymentGroup(tx: any, input: ReverseInput): Promise<ReverseResult> {
  // 1. Tashkilotni aniqlash (lock uchun) — org chegarasi bilan
  const first = await tx.ekoHisobPayment.findUnique({
    where: { id: input.paymentId },
    select: { entityId: true, entity: { select: { orgId: true } } },
  })
  if (!first || first.entity.orgId !== input.orgId) return { ...EMPTY }

  // 2. Tashkilot bo'yicha ketma-ketlik; keyin guruhni QAYTA o'qish (poygada allaqachon yo'q bo'lishi mumkin)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${first.entityId}::text))`

  const payment = await tx.ekoHisobPayment.findUnique({
    where: { id: input.paymentId },
    select: {
      id: true, entityId: true, month: true, groupId: true, amount: true,
      entity: { select: { id: true, name: true, orgId: true, billingMode: true } },
    },
  })
  if (!payment) return { ...EMPTY }

  const rows: { id: string; month: string; amount: number }[] = payment.groupId
    ? await tx.ekoHisobPayment.findMany({
        where: { groupId: payment.groupId, entityId: payment.entityId },
        select: { id: true, month: true, amount: true },
      })
    : [{ id: payment.id, month: payment.month, amount: payment.amount }]
  if (rows.length === 0) return { ...EMPTY }

  const ids = rows.map(r => r.id)
  const entityId = payment.entityId
  const months = [...new Set(rows.map(r => r.month))]

  // 3. Kvitansiyalarni storno qilish (o'chirilmaydi)
  const receipts = await tx.ekoHisobReceipt.findMany({
    where: { paymentId: { in: ids } }, select: { id: true, receiptNumber: true, voidedAt: true },
  })
  await tx.ekoHisobReceipt.updateMany({
    where: { paymentId: { in: ids }, voidedAt: null },
    data: { voidedAt: new Date(), voidReason: input.reason, voidedBy: input.actorId },
  })

  // 4. To'lovlarni o'chirish (claim): count tekshiruvi — qayta bekor qilish xavfsiz
  const del = await tx.ekoHisobPayment.deleteMany({ where: { id: { in: ids } } })
  if (del.count === 0) return { ...EMPTY }

  // 5. Hisob va talonlarni qaytarish (pure reja)
  // Faqat monthly_fixed to'lovlari charge'ga tegadi (boshqa rejimda charge'ga tegilmaydi)
  const charges = payment.entity.billingMode === 'monthly_fixed'
    ? await tx.ekoHisobCharge.findMany({
        where: { entityId, month: { in: months } },
        select: { id: true, month: true, expectedAmount: true, paidAmount: true },
      })
    : []

  let talons: any[] = []
  const remaining = new Map<string, number>()
  if (payment.entity.billingMode === 'talon') {
    talons = await tx.ekoHisobTalon.findMany({
      where: { entityId },
      select: { id: true, date: true, amount: true, paidAmount: true, paid: true },
    })
    const grouped = await tx.ekoHisobPayment.groupBy({
      by: ['month'], where: { entityId, month: { in: months } }, _sum: { amount: true },
    })
    for (const g of grouped) remaining.set(g.month, g._sum.amount ?? 0)
  }

  const plan = planReversal({
    billingMode: payment.entity.billingMode,
    rows,
    charges,
    talons,
    remainingPaymentsByMonth: remaining,
    preferTalonIds: input.preferTalonIds,
  })

  const chargesAfter: ReverseResult['chargesAfter'] = []
  for (const op of plan.chargeOps) {
    const c = charges.find((x: any) => x.month === op.month)
    if (!c) continue
    await tx.ekoHisobCharge.update({ where: { id: c.id }, data: { paidAmount: op.paidAmount, status: op.status } })
    chargesAfter.push({ month: op.month, paidAmount: op.paidAmount, status: op.status })
  }

  let talonsRestored = 0
  for (const op of plan.talonOps) {
    const before = talons.find((t: any) => t.id === op.id)
    await tx.ekoHisobTalon.update({
      where: { id: op.id },
      data: { paidAmount: op.paidAmount, paid: op.paid },
    })
    if (before && !op.paid) talonsRestored++
  }
  // Bog'liq talonlardan o'chgan to'lovga havolani olib tashlaymiz (FK yo'q — ataylab)
  await tx.ekoHisobTalon.updateMany({ where: { paymentId: { in: ids } }, data: { paymentId: null } })

  return {
    alreadyReversed: false,
    entityId,
    entityName: payment.entity.name,
    month: payment.month,
    groupId: payment.groupId ?? null,
    deletedRows: rows,
    deletedCount: del.count,
    totalAmount: rows.reduce((s, r) => s + r.amount, 0),
    receiptNumbers: receipts.map((r: any) => r.receiptNumber),
    chargesAfter,
    talonsRestored,
  }
}
