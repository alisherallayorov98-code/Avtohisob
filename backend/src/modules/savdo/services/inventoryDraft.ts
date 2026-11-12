// Savdo — inventarizatsiya QORALAMASI: sanashni saqlab, keyin davom ettirish.
// Qoralama qoldiqni O'ZGARTIRMAYDI. Tasdiqlanganda confirmInventoryCount
// qatorlarni joriy qoldiq bilan qayta solishtirib tuzatadi (yagona yadro).

import { prisma } from '../../../lib/prisma'
import { SavdoError } from '../lib/savdoError'
import { qn } from '../lib/qty'
import { previewInventoryCount, confirmInventoryCount, CountLineInput } from './inventoryService'

export interface SaveDraftInput {
  orgId: string
  warehouseId: string
  countedById: string
  draftId?: string | null
  notes?: string | null
  lines: CountLineInput[]
}

export async function saveInventoryDraft(input: SaveDraftInput) {
  const { orgId, warehouseId } = input
  if (!input.lines || input.lines.length === 0) throw new SavdoError('Kamida bitta qator kerak')
  const warehouse = await (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse || warehouse.orgId !== orgId) throw new SavdoError('Ombor topilmadi', 404)

  const preview = await previewInventoryCount(orgId, warehouseId, input.lines)

  return prisma.$transaction(async (tx: any) => {
    let draftId = input.draftId || null
    if (draftId) {
      const existing = await tx.savdoInventoryCount.findUnique({ where: { id: draftId } })
      if (!existing || existing.orgId !== orgId || existing.status !== 'draft') {
        throw new SavdoError('Qoralama topilmadi', 404)
      }
      await tx.savdoInventoryCountLine.deleteMany({ where: { countId: draftId } })
      await tx.savdoInventoryCount.update({
        where: { id: draftId },
        data: { warehouseId, notes: input.notes || null, countedById: input.countedById },
      })
    } else {
      const created = await tx.savdoInventoryCount.create({
        data: { orgId, warehouseId, countedById: input.countedById, notes: input.notes || null, status: 'draft' },
      })
      draftId = created.id as string
    }
    await tx.savdoInventoryCountLine.createMany({
      data: preview.map(p => ({
        countId: draftId, productId: p.productId, systemQty: p.systemQty, countedQty: p.countedQty,
        diffQty: p.diffQty, unitCost: p.unitCost, diffValue: p.diffValue,
      })),
    })
    return tx.savdoInventoryCount.findUnique({ where: { id: draftId! }, include: { lines: true } })
  })
}

/** Qoralamani tasdiqlaydi: qoldiq tuzatiladi, qoralama o'chadi (yangi tasdiqlangan hujjat yaratiladi). */
export async function confirmInventoryDraft(orgId: string, draftId: string, countedById: string) {
  const draft = await (prisma as any).savdoInventoryCount.findUnique({ where: { id: draftId }, include: { lines: true } })
  if (!draft || draft.orgId !== orgId || draft.status !== 'draft') throw new SavdoError('Qoralama topilmadi', 404)

  const result = await confirmInventoryCount({
    orgId, warehouseId: draft.warehouseId, countedById, notes: draft.notes,
    lines: draft.lines.map((l: any) => ({ productId: l.productId, countedQty: qn(l.countedQty) })),
  })
  await (prisma as any).savdoInventoryCount.delete({ where: { id: draftId } }) // qatorlar cascade
  return result
}

export async function deleteInventoryDraft(orgId: string, draftId: string) {
  const draft = await (prisma as any).savdoInventoryCount.findUnique({ where: { id: draftId } })
  if (!draft || draft.orgId !== orgId || draft.status !== 'draft') throw new SavdoError('Qoralama topilmadi', 404)
  await (prisma as any).savdoInventoryCount.delete({ where: { id: draftId } })
}
