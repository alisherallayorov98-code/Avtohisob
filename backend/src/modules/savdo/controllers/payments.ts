import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { recordSavdoPayment } from '../services/savdoPaymentService'
import { computeCustomerDebt } from '../lib/savdoDebtMath'
import { SavdoError } from '../lib/savdoError'

export async function listPayments(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>

    const where: any = { orgId }
    if (q.customerId) where.customerId = q.customerId

    const payments = await (prisma as any).savdoPayment.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        sale: { select: { id: true, documentNumber: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 200,
    })
    res.json({ success: true, data: payments })
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
        where: { customerId },
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
