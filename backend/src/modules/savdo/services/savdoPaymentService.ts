// Savdo — to'lovni yozishning YAGONA yadrosi (CLAUDE.md talabi: mustaqil
// nusxa yozilmasin, yangi to'lov yozadigan joy shu funksiyani chaqirsin —
// EkoHisob'ning recordEkoPayment'i bilan bir xil qoida).
//
// FIFO taqsimot (savdoPaymentAllocation.ts) + bitta tranzaksiya + groupId
// bilan bog'langan yozuvlar (bitta kassa operatsiyasi bir necha fakturaga
// taqsimlansa ham birgalikda bekor qilinadi).

import { randomUUID } from 'crypto'
import { prisma } from '../../../lib/prisma'
import { computeSaleDebts } from '../lib/savdoDebtMath'
import { allocatePaymentToSales } from '../lib/savdoPaymentAllocation'
import { SavdoError } from '../lib/savdoError'

// Bir to'lovning yuqori chegarasi — buxgalteriya cheklovi emas, bir nol
// ortiq yozilganini (5 000 000 → 50 000 000) jimgina o'tkazib yubormaslik
// uchun (EkoHisob MAX_PAYMENT bilan bir xil sabab).
export const MAX_PAYMENT = 500_000_000

// Takroriy to'lov qorovuli oynasi: shu vaqt ichida bir xil mijoz+summa
// ikkinchi marta kelsa to'lov YARATILMAYDI (tugmani ikki marta bosish yoki
// tarmoq qayta urinishi ikkita to'lov yozib qo'ymasin). Haqiqatan ikkinchi
// to'lov bo'lsa — `force` bilan o'tkaziladi.
export const DUPLICATE_WINDOW_MS = 3 * 60 * 1000

export interface RecordSavdoPaymentInput {
  orgId: string
  customerId: string
  amount: number
  selectedSaleId?: string | null
  method?: string
  note?: string | null
  receivedById: string
  force?: boolean
}

export async function recordSavdoPayment(input: RecordSavdoPaymentInput) {
  const { orgId, customerId, amount } = input

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SavdoError('Summa musbat son bo\'lishi kerak')
  }
  if (amount > MAX_PAYMENT) {
    throw new SavdoError(
      `To'lov summasi juda katta (${amount.toLocaleString('ru-RU')}). Raqamni tekshiring yoki to'lovni bo'lib qayd eting.`,
    )
  }

  const customer = await (prisma as any).savdoCustomer.findUnique({ where: { id: customerId } })
  if (!customer || customer.orgId !== orgId) {
    throw new SavdoError('Mijoz topilmadi', 404)
  }
  if (!customer.isActive) {
    throw new SavdoError('Deaktiv mijozga to\'lov qilish mumkin emas')
  }

  if (!input.force) {
    const recent = await (prisma as any).savdoPayment.findFirst({
      where: {
        customerId, amount,
        paidAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      orderBy: { paidAt: 'desc' },
    })
    if (recent) {
      throw new SavdoError(
        'Bu mijozga aynan shunday to\'lov bir necha daqiqa oldin qayd etilgan. Haqiqatan ham qayta yozish kerak bo\'lsa, tasdiqlang.',
        409,
      )
    }
  }

  if (input.selectedSaleId) {
    const sale = await (prisma as any).savdoSale.findUnique({ where: { id: input.selectedSaleId } })
    if (!sale || sale.customerId !== customerId) {
      throw new SavdoError('Faktura topilmadi', 404)
    }
  }

  const [sales, payments] = await Promise.all([
    (prisma as any).savdoSale.findMany({
      where: { customerId, status: 'completed' },
      select: { id: true, totalAmount: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    (prisma as any).savdoPayment.findMany({
      where: { customerId, cancelled: false },
      select: { saleId: true, amount: true },
    }),
  ])

  const saleDebts = computeSaleDebts(
    sales.map((s: any) => ({ id: s.id, totalAmount: Number(s.totalAmount), status: s.status })),
    payments.map((p: any) => ({ saleId: p.saleId, amount: Number(p.amount) })),
  )

  // Ochiq (balance>0) fakturalar, eng eskisidan (sales allaqachon createdAt asc)
  const openSales = sales
    .map((s: any) => saleDebts.find(d => d.saleId === s.id))
    .filter((d: any): d is NonNullable<typeof d> => !!d && d.balance > 0)
    .map((d: any) => ({ saleId: d.saleId, balance: d.balance }))

  const { allocations, advance } = allocatePaymentToSales(amount, openSales, input.selectedSaleId)

  const groupId = randomUUID()

  const created = await prisma.$transaction(async (tx: any) => {
    const rows: any[] = []
    for (const alloc of allocations) {
      const payment = await tx.savdoPayment.create({
        data: {
          orgId, customerId, saleId: alloc.saleId, amount: alloc.amount,
          method: input.method || 'cash', note: input.note || null,
          receivedById: input.receivedById, groupId,
        },
      })
      rows.push(payment)
    }
    if (advance > 0) {
      const payment = await tx.savdoPayment.create({
        data: {
          orgId, customerId, saleId: null, amount: advance,
          method: input.method || 'cash', note: input.note || null,
          receivedById: input.receivedById, groupId,
        },
      })
      rows.push(payment)
    }
    return rows
  })

  return { payments: created, allocations, advance, groupId }
}
