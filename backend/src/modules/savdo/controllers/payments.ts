import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { recordSavdoPayment } from '../services/savdoPaymentService'
import { computeCustomerDebt } from '../lib/savdoDebtMath'
import { SavdoError } from '../lib/savdoError'
import { paginate, paginatedResponse, buildDateRangeFilter } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'

export async function exportPaymentsXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const where: any = { orgId }
    const dateFilter = buildDateRangeFilter(q.from, q.to)
    if (dateFilter) where.paidAt = dateFilter

    const payments = await (prisma as any).savdoPayment.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        sale: { select: { documentNumber: true } },
      },
      orderBy: { paidAt: 'desc' },
    })

    const { wb, ws } = newWorkbook("To'lovlar")
    ws.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Mijoz', key: 'customer', width: 22 },
      { header: 'Faktura', key: 'doc', width: 16 },
      { header: 'Summa', key: 'amount', width: 14 },
      { header: 'Usul', key: 'method', width: 12 },
    ]
    for (const p of payments) {
      ws.addRow({
        date: new Date(p.paidAt).toLocaleDateString('uz-UZ'),
        customer: p.customer.name, doc: p.sale?.documentNumber || 'Avans',
        amount: Number(p.amount), method: p.method,
      })
    }
    styleWorksheet(ws)
    await sendWorkbook(wb, 'tolovlar.xlsx', res)
  } catch (err) { next(err) }
}

export async function listPayments(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)

    const where: any = { orgId }
    if (q.customerId) where.customerId = q.customerId
    const dateFilter = buildDateRangeFilter(q.from, q.to)
    if (dateFilter) where.paidAt = dateFilter

    const [total, payments] = await Promise.all([
      (prisma as any).savdoPayment.count({ where }),
      (prisma as any).savdoPayment.findMany({
        where, skip, take: limit,
        include: {
          customer: { select: { id: true, name: true } },
          sale: { select: { id: true, documentNumber: true } },
        },
        orderBy: { paidAt: 'desc' },
      }),
    ])
    res.json(paginatedResponse(payments, total, page, limit))
  } catch (err) { next(err) }
}

export async function getCustomerDebtHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { customerId } = req.params

    const customer = await (prisma as any).savdoCustomer.findUnique({ where: { id: customerId } })
    if (!customer || customer.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Mijoz topilmadi' })
      return
    }

    const [sales, payments] = await Promise.all([
      (prisma as any).savdoSale.findMany({
        where: { customerId, status: 'completed' },
        select: { id: true, documentNumber: true, totalAmount: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      (prisma as any).savdoPayment.findMany({
        where: { customerId, cancelled: false },
        select: { saleId: true, amount: true },
      }),
    ])

    const debt = computeCustomerDebt(
      sales.map((s: any) => ({ id: s.id, totalAmount: Number(s.totalAmount), status: s.status })),
      payments.map((p: any) => ({ saleId: p.saleId, amount: Number(p.amount) })),
    )

    const salesWithBalance = sales.map((s: any) => ({
      ...s,
      balance: debt.saleDebts.find(d => d.saleId === s.id)?.balance ?? 0,
    }))

    res.json({ success: true, data: { ...debt, sales: salesWithBalance } })
  } catch (err) { next(err) }
}

export async function createPayment(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { customerId, amount, saleId, method, note, force } = req.body

    if (!customerId) {
      res.status(400).json({ success: false, error: 'customerId talab qilinadi' })
      return
    }

    const receivedById = await ensureSavdoActor(actor)

    const result = await recordSavdoPayment({
      orgId: actor.orgId,
      customerId,
      amount: Number(amount),
      selectedSaleId: saleId || null,
      method: method || 'cash',
      note: note || null,
      receivedById,
      force: Boolean(force),
    })

    res.status(201).json({ success: true, data: result, message: 'To\'lov qayd etildi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

// To'lovni bekor qilish — faqat admin. Yozuv o'chirilmaydi (audit), cancelled=true
// bo'ladi va qarz hisobidan chiqarib tashlanadi. Bitta kassa operatsiyasi bir
// necha fakturaga taqsimlangan bo'lsa (groupId), BUTUN guruh birga bekor qilinadi —
// aks holda "50000 to'lov 3 ga bo'lingan edi, faqat 1 tasini bekor qilaman" mantiqsiz
// holatga olib kelardi (qolgan 2 tasi qayerdan kelgani noaniq bo'lib qolardi).
export async function cancelPayment(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const actor = req.savdoUser!
    const { id } = req.params

    const payment = await (prisma as any).savdoPayment.findUnique({ where: { id } })
    if (!payment || payment.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'To\'lov topilmadi' })
      return
    }
    if (payment.cancelled) {
      res.status(400).json({ success: false, error: 'Bu to\'lov allaqachon bekor qilingan' })
      return
    }

    const cancelledById = await ensureSavdoActor(actor)
    const where = payment.groupId ? { groupId: payment.groupId, cancelled: false } : { id }

    await (prisma as any).savdoPayment.updateMany({
      where,
      data: { cancelled: true, cancelledById, cancelledAt: new Date() },
    })

    res.json({ success: true, data: null, message: 'To\'lov bekor qilindi' })
  } catch (err) { next(err) }
}
