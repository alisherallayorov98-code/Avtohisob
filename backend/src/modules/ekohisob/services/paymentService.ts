// EkoHisob — to'lovni qayd etishning YAGONA yadrosi.
//
// Nega kerak: to'lov ikki joyda mustaqil yozilardi — veb (`controllers/payments.ts`)
// va Telegram dala-boti (`services/ekoFieldBot.ts`). Ular bir xil emas edi:
// bot talon rejimidagi tashkilotning talonlarini UMUMAN yopmasdi, ya'ni pulini
// to'lagan tashkilot botdan to'laganda qarzdor bo'lib qolaverardi.
//
// Endi ikkalasi shu funksiyani chaqiradi. Kafolatlar:
//  - BUTUN operatsiya bitta tranzaksiyada; tashkilot bo'yicha pg_advisory_xact_lock
//    bilan ketma-ketlashtirilgan (parallel veb+bot to'lovda lost-update yo'q);
//  - qarzlar tranzaksiya ICHIDA o'qiladi (lock olingandan keyin);
//  - idempotencyKey: bir kalit — bir to'lov (qayta yuborish yangisini yaratmaydi);
//  - takroriy to'lov qorovuli (3 daqiqa) lock ichida tekshiriladi;
//  - kvitansiya raqami tranzaksiya ichida (teshiksiz), tekshiruv tokeni bilan;
//  - audit yozuvi shu yerda (bot ham auditga tushadi), xatosi to'lovni yiqitmaydi.
//
// Huquq (rol, tuman): `actor` berilsa shu yerda ekoScope.canAccessEntity bilan tekshiriladi.
// Pul mantiqining o'zi pure: lib/paymentPlan.ts (testlangan).

import { randomUUID } from 'crypto'
import { prisma } from '../../../lib/prisma'
import { EkoUserPayload } from '../middleware/ekoAuth'
import { chargeRowStatus, talonMonth } from '../lib/debtMath'
import { Allocation, DebtMonth } from '../lib/paymentAllocation'
import { computeOpenDebts, planPayment } from '../lib/paymentPlan'
import { addMonths, getCurrentMonth, isValidMonth } from '../lib/months'
import { parseIdempotencyKey, parseMoneyAmount, parsePaymentMethod } from '../lib/money'
import { generateVerifyToken, nextReceiptNumberTx } from '../lib/receiptNumber'
import { canAccessEntity } from '../lib/ekoScope'
import { logEkoAudit } from '../lib/ekoAudit'

/**
 * Bitta to'lovning yuqori chegarasi. Bu buxgalteriya cheklovi emas — bir nol
 * ortiq yozilganini (2 000 000 → 20 000 000) jimgina o'tkazib yubormaslik uchun.
 */
export const MAX_PAYMENT = 500_000_000

/**
 * Takroriy to'lov qorovuli oynasi: shu vaqt ichida bir xil tashkilot+oy+summa
 * ikkinchi marta kelsa to'lov YARATILMAYDI. Haqiqatan ikkinchi to'lov bo'lsa —
 * `force` bilan o'tkaziladi.
 */
export const DUPLICATE_WINDOW_MS = 3 * 60 * 1000

export type PaymentErrorCode =
  | 'INVALID_MONTH'
  | 'FUTURE_MONTH'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_TOO_LARGE'
  | 'INVALID_METHOD'
  | 'INVALID_KEY'
  | 'ENTITY_INACTIVE'
  | 'ENTITY_NOT_FOUND'
  | 'FORBIDDEN'
  | 'DUPLICATE_PAYMENT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'TALON_NOT_FOUND'
  | 'TALON_ALREADY_PAID'

/** Chaqiruvchi HTTP status yoki bot xabariga aylantiradigan xato. */
export class PaymentError extends Error {
  constructor(
    public code: PaymentErrorCode,
    message: string,
    public status: number = 400,
    public data: unknown = null,
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}

export interface RecordPaymentInput {
  /** Tashkilot yozuvi; faqat `id` ishonchli — qolgani tranzaksiyada qayta o'qiladi */
  entity: any
  month: string
  /** Faqat musbat butun son. `talonId` rejimida e'tiborga olinmaydi (talon qoldig'i to'lanadi). */
  amount?: number | string
  note?: string | null
  /** ekohisob_users dagi haqiqiy id (ensureEkoActor natijasi) */
  actorId: string
  /** takroriy to'lov ogohlantirishini o'tkazib yuborish */
  force?: boolean
  /** cash | card | transfer | online (default cash) */
  method?: string
  /** Klient kaliti: shu kalit bilan to'lov bor bo'lsa YANGISI yaratilmaydi, o'sha natija qaytadi */
  idempotencyKey?: string | null
  /** Berilsa: org/tuman huquqi canAccessEntity bilan tekshiriladi va audit shu foydalanuvchiga yoziladi */
  actor?: EkoUserPayload
  /** audit uchun manba: 'web' | 'bot' | 'talon' */
  source?: string
  /** Aynan shu talonning qoldig'ini to'laydi (talon "to'landi" belgilash) */
  talonId?: string
}

export interface RecordPaymentResult {
  /** Asosiy (kvitansiya bog'langan) to'lov yozuvi */
  primary: any
  receiptNumber: string
  receiptId: string
  groupId: string
  allocations: Allocation[]
  appliedToOlder: number
  advance: number
  talonsClosed: number
  charge: { expectedAmount: number; paidAmount: number; remaining: number; status: string } | null
  /** To'lovdan keyin JAMI qolgan qarz (barcha oylar bo'yicha) */
  remaining: number
  /** YANGI: kvitansiya ochiq tekshiruv tokeni */
  verifyToken: string | null
  /** YANGI: true — bu idempotencyKey bo'yicha oldingi natija (yangi to'lov yaratilmadi) */
  idempotentReplay: boolean
}

/** DB klienti (prisma yoki tranzaksiya) bo'yicha tashkilotning ochiq qarzlarini yuklaydi. */
export async function loadOpenDebts(entity: any, selectedMonth: string, db: any = prisma): Promise<DebtMonth[]> {
  if (entity.billingMode === 'monthly_fixed') {
    const charges = await db.ekoHisobCharge.findMany({
      where: { entityId: entity.id },
      select: { month: true, expectedAmount: true, paidAmount: true },
    })
    return computeOpenDebts({
      billingMode: 'monthly_fixed', monthlyFee: entity.monthlyFee ?? 0, selectedMonth, charges,
    })
  }
  if (entity.billingMode === 'talon') {
    const talons = await db.ekoHisobTalon.findMany({
      where: { entityId: entity.id, paid: false },
      select: { id: true, date: true, amount: true, paidAmount: true, paid: true },
    })
    return computeOpenDebts({ billingMode: 'talon', monthlyFee: 0, selectedMonth, talons })
  }
  return []
}

const sum = (rows: { debt: number }[]) => rows.reduce((s, d) => s + d.debt, 0)

async function buildReplay(tx: any, existing: any): Promise<RecordPaymentResult> {
  const rows = existing.groupId
    ? await tx.ekoHisobPayment.findMany({ where: { groupId: existing.groupId }, orderBy: { paidAt: 'asc' } })
    : [existing]
  const primary = rows.find((r: any) => r.id === existing.id) ?? existing
  const receipt = await tx.ekoHisobReceipt.findFirst({
    where: { paymentId: primary.id }, select: { id: true, receiptNumber: true, verifyToken: true },
  })
  const entity = await tx.ekoHisobLegalEntity.findUnique({
    where: { id: primary.entityId }, select: { id: true, billingMode: true, monthlyFee: true },
  })
  const ch = await tx.ekoHisobCharge.findUnique({
    where: { entityId_month: { entityId: primary.entityId, month: primary.month } },
  })
  const ids = rows.map((r: any) => r.id)
  const talonsClosed = await tx.ekoHisobTalon.count({ where: { paymentId: { in: ids }, paid: true } })
  const open = entity ? await loadOpenDebts(entity, primary.month, tx) : []
  const allocations: Allocation[] = rows.map((r: any) => ({ month: r.month, amount: r.amount }))
  return {
    primary,
    receiptNumber: receipt?.receiptNumber ?? '',
    receiptId: receipt?.id ?? '',
    groupId: primary.groupId ?? primary.id,
    allocations,
    appliedToOlder: rows.filter((r: any) => r.month !== primary.month).reduce((s: number, r: any) => s + r.amount, 0),
    advance: 0,
    talonsClosed,
    charge: ch ? {
      expectedAmount: ch.expectedAmount, paidAmount: ch.paidAmount,
      remaining: Math.max(0, ch.expectedAmount - ch.paidAmount), status: ch.status,
    } : null,
    remaining: sum(open),
    verifyToken: receipt?.verifyToken ?? null,
    idempotentReplay: true,
  }
}

/**
 * To'lovni qayd etadi: taqsimlaydi (FIFO), hisobni/talonni yangilaydi va kvitansiya
 * yozadi — BITTA tranzaksiyada, tashkilot bo'yicha ketma-ket.
 *
 * Ortiqcha summa avval tanlangan oyni, so'ng eng eski qarzni yopadi; hammasi
 * yopilgach avans bo'lib tanlangan oyda qoladi. Har oy uchun alohida to'lov
 * yozuvi yaratiladi, ular bitta `groupId` va bitta kvitansiya bilan bog'lanadi.
 */
export async function recordEkoPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const { actorId, force } = input
  const talonMode = !!input.talonId
  let selectedMonth = String(input.month ?? '')

  // ── Kirish validatsiyasi (DB'siz) ──
  if (!talonMode || selectedMonth) {
    if (!isValidMonth(selectedMonth)) {
      throw new PaymentError('INVALID_MONTH', 'month formati: "YYYY-MM" (masalan: 2026-01)')
    }
    // Kelajak oyi: keyingi oygacha ruxsat (oldindan to'lov), undan narigisi —
    // deyarli har doim terish xatosi (2027 o'rniga 2072 kabi). UZT bo'yicha.
    const maxMonth = addMonths(getCurrentMonth(), 1)
    if (!talonMode && selectedMonth > maxMonth) {
      throw new PaymentError(
        'FUTURE_MONTH',
        `Kelajakdagi oyga to'lov qayd etib bo'lmaydi (eng kechi: ${maxMonth})`,
      )
    }
  }

  let amount = 0
  if (!talonMode) {
    const parsed = parseMoneyAmount(input.amount)
    if (parsed === null) {
      throw new PaymentError('INVALID_AMOUNT', 'amount musbat BUTUN son bo\'lishi kerak (masalan: 150000)')
    }
    if (parsed > MAX_PAYMENT) {
      throw new PaymentError(
        'AMOUNT_TOO_LARGE',
        `To'lov summasi juda katta (${parsed.toLocaleString('ru-RU')}). `
          + 'Raqamni tekshiring yoki to\'lovni bo\'lib qayd eting.',
      )
    }
    amount = parsed
  }

  const method = parsePaymentMethod(input.method)
  if (method === null) {
    throw new PaymentError('INVALID_METHOD', 'method: cash | card | transfer | online')
  }
  let key: string | null = null
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null && input.idempotencyKey !== '') {
    key = parseIdempotencyKey(input.idempotencyKey)
    if (!key) throw new PaymentError('INVALID_KEY', 'idempotencyKey: 8-100 belgi (harf, raqam, . _ : -)')
  }
  const entityId: string | undefined = input.entity?.id
  if (!entityId) throw new PaymentError('ENTITY_NOT_FOUND', 'Tashkilot topilmadi', 404)

  const groupId = randomUUID()

  const run = (): Promise<any> => prisma.$transaction(async (tx: any) => {
    // 1. Tashkilot bo'yicha ketma-ketlik — parallel to'lovlar navbat bilan o'tadi
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${entityId}::text))`

    // 2. Idempotentlik: shu kalit bilan to'lov bor bo'lsa — o'sha natija
    if (key) {
      const existing = await tx.ekoHisobPayment.findUnique({ where: { idempotencyKey: key } })
      if (existing) {
        if (existing.entityId !== entityId) {
          throw new PaymentError('IDEMPOTENCY_CONFLICT', 'Bu idempotencyKey boshqa tashkilot to\'lovi uchun ishlatilgan', 409)
        }
        return { replay: await buildReplay(tx, existing) }
      }
    }

    // 3. Yangi holat (lock ichida)
    const entity = await tx.ekoHisobLegalEntity.findUnique({
      where: { id: entityId },
      select: { id: true, name: true, orgId: true, districtId: true, status: true, billingMode: true, monthlyFee: true },
    })
    if (!entity) throw new PaymentError('ENTITY_NOT_FOUND', 'Tashkilot topilmadi', 404)
    if (input.actor) {
      if (entity.orgId !== input.actor.orgId) throw new PaymentError('ENTITY_NOT_FOUND', 'Tashkilot topilmadi', 404)
      if (!canAccessEntity(input.actor, entity)) {
        throw new PaymentError('FORBIDDEN', 'Ushbu tumanga kirish taqiqlangan', 403)
      }
    }
    if (entity.status === 'inactive') {
      throw new PaymentError('ENTITY_INACTIVE', 'Deaktiv tashkilotga to\'lov qilish mumkin emas')
    }

    // talon rejimi: aynan bitta talon qoldig'i
    let talonRow: any = null
    let payAmount = amount
    let month = selectedMonth
    if (talonMode) {
      talonRow = await tx.ekoHisobTalon.findUnique({ where: { id: input.talonId } })
      if (!talonRow || talonRow.entityId !== entityId) {
        throw new PaymentError('TALON_NOT_FOUND', 'Talon topilmadi', 404)
      }
      const paidPart = talonRow.paid ? talonRow.amount : Math.min(talonRow.amount, talonRow.paidAmount ?? 0)
      payAmount = talonRow.amount - paidPart
      if (payAmount <= 0) {
        throw new PaymentError('TALON_ALREADY_PAID', 'Talon allaqachon to\'langan', 409)
      }
      month = talonMonth(talonRow.date)
    }

    // 4. Takroriy to'lov qorovuli (lock ichida — parallel so'rovlar ham ushlanadi)
    if (!force && !talonMode) {
      const recent = await tx.ekoHisobPayment.findFirst({
        where: {
          entityId, month, amount: payAmount,
          paidAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        },
        include: { receipt: { select: { receiptNumber: true } } },
        orderBy: { paidAt: 'desc' },
      })
      if (recent) {
        throw new PaymentError(
          'DUPLICATE_PAYMENT',
          'Bu tashkilotga shu oy uchun aynan shunday to\'lov bir necha daqiqa oldin qayd etilgan.',
          409,
          {
            paymentId: recent.id,
            paidAt: recent.paidAt,
            amount: recent.amount,
            receiptNumber: recent.receipt?.receiptNumber ?? null,
          },
        )
      }
    }

    // 5. Reja (pure) — qarzlar shu tranzaksiyada o'qiladi
    const charges = entity.billingMode === 'monthly_fixed'
      ? await tx.ekoHisobCharge.findMany({
          where: { entityId }, select: { month: true, expectedAmount: true, paidAmount: true },
        })
      : []
    const talons = entity.billingMode === 'talon' && !talonMode
      ? await tx.ekoHisobTalon.findMany({
          where: { entityId, paid: false },
          select: { id: true, date: true, amount: true, paidAmount: true, paid: true },
        })
      : []

    let plan
    if (talonMode) {
      const total = talonRow.amount as number
      plan = {
        debtsBefore: [], allocations: [{ month, amount: payAmount }], advance: 0, appliedToOlder: 0,
        chargeOps: [] as any[], talonsClosed: 1,
        talonOps: [{ id: talonRow.id, delta: payAmount, paidAmount: total, paid: true, month }],
      }
    } else {
      plan = planPayment({
        billingMode: entity.billingMode, monthlyFee: entity.monthlyFee ?? 0,
        selectedMonth: month, amount: payAmount, charges, talons,
      })
    }

    // 6. Yozuvlar
    const created: any[] = []
    const paymentByMonth = new Map<string, string>()
    for (const alloc of plan.allocations) {
      const isPrimary = created.length === 0
      const payment = await tx.ekoHisobPayment.create({
        data: {
          entityId,
          month: alloc.month,
          amount: alloc.amount,
          receivedBy: actorId,
          groupId,
          method,
          idempotencyKey: isPrimary ? key : null,
          note: isPrimary
            ? (input.note ? String(input.note).trim().slice(0, 300) : null)
            : 'Ortiqcha to\'lovdan eski qarzga',
        },
        include: {
          entity: { select: { id: true, name: true } },
          receiver: { select: { id: true, fullName: true } },
        },
      })
      created.push(payment)
      paymentByMonth.set(alloc.month, payment.id)
    }

    for (const op of plan.chargeOps) {
      // Hisob yo'q bo'lsa yaratamiz — ON CONFLICT DO NOTHING: cron bilan poygada ham tranzaksiya buzilmaydi
      if (op.createExpected != null) {
        await tx.ekoHisobCharge.createMany({
          data: [{ entityId, month: op.month, expectedAmount: op.createExpected, paidAmount: 0, status: 'open' }],
          skipDuplicates: true,
        })
      }
      const upd = await tx.ekoHisobCharge.updateMany({
        where: { entityId, month: op.month },
        data: { paidAmount: { increment: op.amount } },
      })
      if (upd.count > 0) {
        const c = await tx.ekoHisobCharge.findUnique({ where: { entityId_month: { entityId, month: op.month } } })
        if (c) {
          await tx.ekoHisobCharge.update({
            where: { id: c.id },
            data: { status: chargeRowStatus(c.expectedAmount, c.paidAmount) },
          })
        }
      }
    }

    for (const op of plan.talonOps) {
      await tx.ekoHisobTalon.update({
        where: { id: op.id },
        data: { paidAmount: op.paidAmount, paid: op.paid, paymentId: paymentByMonth.get(op.month) ?? null },
      })
    }

    // 7. Kvitansiya — butun kassa operatsiyasiga BITTA, to'liq summaga.
    // Raqam ENG OXIRIDA olinadi: seq qatori qulfi tranzaksiya oxirigacha ushlanadi.
    const primary = created[0]
    const total = plan.allocations.reduce((s, a) => s + a.amount, 0)
    const receiptNumber = await nextReceiptNumberTx(tx, entity.orgId)
    const verifyToken = generateVerifyToken()
    const receipt = await tx.ekoHisobReceipt.create({
      data: {
        receiptNumber,
        orgId: entity.orgId,
        entityId,
        paymentId: primary.id,
        // Kvitansiya davri asosiy yozuv oyi bilan bir xil bo'lishi shart
        month: primary.month,
        amount: total,
        issuedBy: actorId,
        verifyToken,
      },
      select: { id: true },
    })

    const ch = await tx.ekoHisobCharge.findUnique({
      where: { entityId_month: { entityId, month: primary.month } },
    })
    const open = await loadOpenDebts(entity, primary.month, tx)

    return {
      replay: null as RecordPaymentResult | null,
      entity, plan, created, primary, receiptId: receipt.id, receiptNumber, verifyToken, ch,
      remaining: sum(open), total,
    }
  }, { timeout: 20_000, maxWait: 15_000 })

  let out: Awaited<ReturnType<typeof run>>
  try {
    out = await run()
  } catch (e: any) {
    // Parallel bir xil kalit: biri yutdi, ikkinchisi unique P2002 oldi — g'olib natijasini qaytaramiz
    if (key && e?.code === 'P2002') {
      const existing = await (prisma as any).ekoHisobPayment.findUnique({ where: { idempotencyKey: key } })
      if (existing && existing.entityId === entityId) {
        return buildReplay(prisma, existing)
      }
    }
    throw e
  }

  if (out.replay) return out.replay

  const { entity, plan, created, primary } = out as any
  const charge = out.ch
    ? {
        expectedAmount: out.ch.expectedAmount,
        paidAmount: out.ch.paidAmount,
        remaining: Math.max(0, out.ch.expectedAmount - out.ch.paidAmount),
        status: out.ch.status,
      }
    : null

  // Audit — tranzaksiyadan KEYIN (rollback bo'lsa yozilmaydi); xatosi to'lovni yiqitmaydi
  const auditActor: EkoUserPayload = input.actor
    ? { ...input.actor, id: actorId }
    : { id: actorId, email: '', role: 'inspector', orgId: entity.orgId, districtIds: [], eko: true }
  await logEkoAudit(auditActor, {
    action: 'payment.create',
    targetType: 'payment',
    targetId: primary.id,
    targetName: entity.name,
    amount: out.total,
    details: {
      month: primary.month,
      receiptNumber: out.receiptNumber,
      note: input.note ?? null,
      talonsClosed: plan.talonsClosed,
      groupId,
      method,
      source: input.source ?? (input.actor ? 'web' : 'bot'),
      allocations: plan.allocations.map((a: Allocation) => `${a.month}: ${a.amount}`),
      appliedToOlder: plan.appliedToOlder,
      advance: plan.advance,
      forced: Boolean(force),
      idempotencyKey: key,
    },
  })

  return {
    primary,
    receiptNumber: out.receiptNumber,
    receiptId: out.receiptId,
    groupId,
    allocations: plan.allocations,
    appliedToOlder: plan.appliedToOlder,
    advance: plan.advance,
    talonsClosed: plan.talonsClosed,
    charge,
    remaining: out.remaining,
    verifyToken: out.verifyToken,
    idempotentReplay: false,
  }
}
