// EkoHisob — to'lovni qayd etishning YAGONA yadrosi.
//
// Nega kerak: to'lov ikki joyda mustaqil yozilardi — veb (`controllers/payments.ts`)
// va Telegram dala-boti (`services/ekoFieldBot.ts`). Ular bir xil emas edi:
// bot talon rejimidagi tashkilotning talonlarini UMUMAN yopmasdi, ya'ni pulini
// to'lagan tashkilot botdan to'laganda qarzdor bo'lib qolaverardi. Bundan
// tashqari botda tranzaksiya, takroriy to'lov qorovuli va ortiqcha summani
// taqsimlash yo'q edi.
//
// Endi ikkalasi shu funksiyani chaqiradi. Huquq tekshiruvi (rol, tuman)
// chaqiruvchida qoladi — u yerda kontekst boshqacha.

import { randomUUID } from 'crypto'
import { prisma } from '../../../lib/prisma'
import { nextReceiptNum } from '../controllers/receipts'
import { chargeRowStatus, groupTalonsByMonth } from '../lib/debtMath'
import { allocatePayment, Allocation, DebtMonth } from '../lib/paymentAllocation'
import { addMonths, getCurrentMonth } from '../lib/months'

/**
 * Bitta to'lovning yuqori chegarasi. Bu buxgalteriya cheklovi emas — bir nol
 * ortiq yozilganini (2 000 000 → 20 000 000) jimgina o'tkazib yubormaslik uchun.
 */
export const MAX_PAYMENT = 500_000_000

/**
 * Takroriy to'lov qorovuli oynasi: shu vaqt ichida bir xil tashkilot+oy+summa
 * ikkinchi marta kelsa to'lov YARATILMAYDI. Tugmani ikki marta bosish, tarmoq
 * qayta urinishi yoki ikki qurilmadan yozish 2 ta to'lov + 2 ta kvitansiya
 * yaratardi. Haqiqatan ikkinchi to'lov bo'lsa — `force` bilan o'tkaziladi.
 */
export const DUPLICATE_WINDOW_MS = 3 * 60 * 1000

export type PaymentErrorCode =
  | 'INVALID_MONTH'
  | 'FUTURE_MONTH'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_TOO_LARGE'
  | 'ENTITY_INACTIVE'
  | 'DUPLICATE_PAYMENT'

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
  /** To'liq tashkilot yozuvi: id, orgId, status, billingMode, monthlyFee */
  entity: any
  month: string
  amount: number | string
  note?: string | null
  /** ekohisob_users dagi haqiqiy id (ensureEkoActor natijasi) */
  actorId: string
  /** takroriy to'lov ogohlantirishini o'tkazib yuborish */
  force?: boolean
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
  /** Tanlangan oyda to'lovdan keyin qolgan qarz (bot xabari uchun) */
  remaining: number
}

/** Oy chegaralari — "YYYY-MM" → [boshi, keyingi oy boshi) */
function monthBounds(month: string): { start: Date; end: Date } {
  const start = new Date(month + '-01T00:00:00.000Z')
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { start, end }
}

/**
 * Tashkilotning ochiq qarzi — oylar kesimida, rejimga qarab.
 *  - monthly_fixed: ochiq/qisman hisoblar (charge);
 *  - talon: to'lanmagan talonlar, sanasi bo'yicha oyga guruhlangan;
 *  - variable: qarz to'planmaydi — bo'sh.
 * Tanlangan oyda hali hisob yozuvi bo'lmasa (hisoblar generatsiya qilinmagan),
 * belgilangan oylik to'lov qarz sifatida qo'shiladi.
 */
export async function loadOpenDebts(entity: any, selectedMonth: string): Promise<DebtMonth[]> {
  if (entity.billingMode === 'monthly_fixed') {
    const charges = await (prisma as any).ekoHisobCharge.findMany({
      where: { entityId: entity.id, status: { in: ['open', 'partial'] } },
      select: { month: true, expectedAmount: true, paidAmount: true },
      orderBy: { month: 'asc' },
    })
    const debts: DebtMonth[] = charges
      .map((c: any) => ({ month: c.month, debt: Math.max(0, c.expectedAmount - c.paidAmount) }))
      .filter((d: DebtMonth) => d.debt > 0)

    if (!charges.some((c: any) => c.month === selectedMonth) && entity.monthlyFee > 0) {
      // Hisob hali yaratilmagan oy — to'lov paytida yaratiladi
      const exists = await (prisma as any).ekoHisobCharge.findUnique({
        where: { entityId_month: { entityId: entity.id, month: selectedMonth } },
        select: { id: true },
      })
      if (!exists) debts.push({ month: selectedMonth, debt: entity.monthlyFee })
    }
    return debts
  }

  if (entity.billingMode === 'talon') {
    const talons = await (prisma as any).ekoHisobTalon.findMany({
      where: { entityId: entity.id, paid: false },
      select: { date: true, amount: true, paid: true },
    })
    return [...groupTalonsByMonth(talons)]
      .map(([month, s]) => ({ month, debt: s.unpaid }))
      .filter(d => d.debt > 0)
  }

  return []
}

/**
 * To'lovni qayd etadi: taqsimlaydi (FIFO), hisobni yangilaydi, talonlarni
 * yopadi va kvitansiya yozadi — BITTA tranzaksiyada.
 *
 * Ortiqcha summa avval tanlangan oyni, so'ng eng eski qarzni yopadi; hammasi
 * yopilgach avans bo'lib tanlangan oyda qoladi. Har oy uchun alohida to'lov
 * yozuvi yaratiladi (oylik hisobot va akt sverka to'g'ri chiqishi uchun),
 * ular bitta `groupId` va bitta kvitansiya bilan bog'lanadi.
 */
export async function recordEkoPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const { entity, actorId, force } = input
  const selectedMonth = String(input.month)

  if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
    throw new PaymentError('INVALID_MONTH', 'month formati: "YYYY-MM" (masalan: 2026-01)')
  }
  // Kelajak oyi: keyingi oygacha ruxsat (oldindan to'lov), undan narigisi —
  // deyarli har doim terish xatosi (2027 o'rniga 2072 kabi).
  const maxMonth = addMonths(getCurrentMonth(), 1)
  if (selectedMonth > maxMonth) {
    throw new PaymentError(
      'FUTURE_MONTH',
      `Kelajakdagi oyga to'lov qayd etib bo'lmaydi (eng kechi: ${maxMonth})`,
    )
  }
  if (entity.status === 'inactive') {
    throw new PaymentError('ENTITY_INACTIVE', 'Deaktiv tashkilotga to\'lov qilish mumkin emas')
  }

  const amount = parseInt(String(input.amount))
  if (isNaN(amount) || amount <= 0) {
    throw new PaymentError('INVALID_AMOUNT', 'amount musbat son bo\'lishi kerak')
  }
  if (amount > MAX_PAYMENT) {
    throw new PaymentError(
      'AMOUNT_TOO_LARGE',
      `To'lov summasi juda katta (${amount.toLocaleString('ru-RU')}). `
        + 'Raqamni tekshiring yoki to\'lovni bo\'lib qayd eting.',
    )
  }

  if (!force) {
    const recent = await (prisma as any).ekoHisobPayment.findFirst({
      where: {
        entityId: entity.id,
        month: selectedMonth,
        amount,
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

  const debts = await loadOpenDebts(entity, selectedMonth)
  const { allocations, advance, appliedToOlder } = allocatePayment(amount, selectedMonth, debts)

  // Kvitansiya raqami tranzaksiyadan OLDIN olinadi: u o'z ichida atomik
  // (INSERT ... ON CONFLICT) va uzoq tranzaksiyani navbatda ushlab turmasin.
  const receiptNumber = await nextReceiptNum(entity.orgId)
  const groupId = randomUUID()
  const entityId = entity.id

  // Ilgari to'lov, hisob, kvitansiya va talon 4 ta alohida so'rov edi: o'rtada
  // uzilish hisobi yangilanmagan yoki kvitansiyasiz to'lov qoldirardi.
  const result = await prisma.$transaction(async (tx: any) => {
    const created: any[] = []
    let talonsClosed = 0

    for (const alloc of allocations) {
      // Birinchi qator — asosiy: kvitansiya va izoh shunga bog'lanadi.
      // Taqsimot tanlangan oydan boshlanadi; tanlangan oyda qarz bo'lmasa —
      // eng eski qarz oyi asosiy bo'ladi.
      const isPrimary = created.length === 0
      const payment = await tx.ekoHisobPayment.create({
        data: {
          entityId,
          month: alloc.month,
          amount: alloc.amount,
          receivedBy: actorId,
          groupId,
          note: isPrimary
            ? (input.note ? String(input.note).trim().slice(0, 300) : null)
            : `Ortiqcha to'lovdan eski qarzga (kvitansiya ${receiptNumber})`,
        },
        include: {
          entity: { select: { id: true, name: true } },
          receiver: { select: { id: true, fullName: true } },
        },
      })
      created.push(payment)

      // Hisob (charge) — mavjudini yangilaymiz, bo'lmasa fixed rejimda yaratamiz
      const charge = await tx.ekoHisobCharge.findUnique({
        where: { entityId_month: { entityId, month: alloc.month } },
      })
      if (charge) {
        const paidAmount = charge.paidAmount + alloc.amount
        await tx.ekoHisobCharge.update({
          where: { id: charge.id },
          data: { paidAmount, status: chargeRowStatus(charge.expectedAmount, paidAmount) },
        })
      } else if (entity.billingMode === 'monthly_fixed' && entity.monthlyFee > 0) {
        await tx.ekoHisobCharge.create({
          data: {
            entityId,
            month: alloc.month,
            expectedAmount: entity.monthlyFee,
            paidAmount: alloc.amount,
            status: chargeRowStatus(entity.monthlyFee, alloc.amount),
          },
        })
      }

      // Talon rejimi: shu oyning to'lanmagan talonlari eskisidan boshlab yopiladi.
      // Bo'lmasa talon "to'lanmagan" qolib, to'lagan tashkilot qarzdor ko'rinardi.
      if (entity.billingMode === 'talon') {
        const { start, end } = monthBounds(alloc.month)
        const openTalons = await tx.ekoHisobTalon.findMany({
          where: { entityId, paid: false, date: { gte: start, lt: end } },
          orderBy: { date: 'asc' },
          select: { id: true, amount: true },
        })
        let left = alloc.amount
        const toClose: string[] = []
        for (const t of openTalons) {
          if (left < t.amount) break     // qisman qoplangan talon ochiq qoladi
          left -= t.amount
          toClose.push(t.id)
        }
        if (toClose.length > 0) {
          const upd = await tx.ekoHisobTalon.updateMany({
            where: { id: { in: toClose } },
            data: { paid: true, paymentId: payment.id },
          })
          talonsClosed += upd.count ?? 0
        }
      }
    }

    // Kvitansiya — butun kassa operatsiyasiga BITTA, to'liq summaga.
    const primary = created[0]
    const receipt = await tx.ekoHisobReceipt.create({
      data: {
        receiptNumber,
        orgId: entity.orgId,
        entityId,
        paymentId: primary.id,
        // Kvitansiya davri asosiy yozuv oyi bilan bir xil bo'lishi shart —
        // aks holda hujjatdagi oy bog'langan to'lov oyidan farq qiladi.
        month: primary.month,
        amount,
        issuedBy: actorId,
      },
      select: { id: true },
    })

    const ch = await tx.ekoHisobCharge.findUnique({
      where: { entityId_month: { entityId, month: selectedMonth } },
    })

    return { created, primary, receiptId: receipt.id, talonsClosed, charge: ch }
  })

  const charge = result.charge
    ? {
        expectedAmount: result.charge.expectedAmount,
        paidAmount: result.charge.paidAmount,
        remaining: Math.max(0, result.charge.expectedAmount - result.charge.paidAmount),
        status: result.charge.status,
      }
    : null

  // Talon rejimida "qolgan qarz" hisobdan emas, yopilmagan talonlardan keladi
  let remaining = charge?.remaining ?? 0
  if (entity.billingMode === 'talon') {
    const openAfter = await loadOpenDebts(entity, selectedMonth)
    remaining = openAfter.reduce((s, d) => s + d.debt, 0)
  }

  return {
    primary: result.primary,
    receiptNumber,
    receiptId: result.receiptId,
    groupId,
    allocations,
    appliedToOlder,
    advance,
    talonsClosed: result.talonsClosed,
    charge,
    remaining,
  }
}
