// Savdo — audit jurnali: saqlangan hujjatni tahrirlash/bekor qilish SABAB bilan va
// "avval → keyin" holati bilan yoziladi. Yozuv hech qachon o'chirilmaydi/o'zgartirilmaydi.

import { SavdoError } from './savdoError'

export const MIN_REASON = 5

/** Sabab majburiy: kamida 5 belgi. Bo'sh/qisqa bo'lsa SavdoError. */
export function requireReason(raw: unknown): string {
  const reason = String(raw ?? '').trim()
  if (reason.length < MIN_REASON) {
    throw new SavdoError(`Tahrirlash/bekor qilish sababini yozing (kamida ${MIN_REASON} belgi)`)
  }
  return reason.slice(0, 500)
}

export interface AuditEntry {
  orgId: string
  entity: 'purchase_doc' | 'purchase' | 'sale'
  entityId: string
  entityLabel?: string | null
  action: 'edit' | 'meta' | 'cancel'
  reason: string
  before?: unknown
  after?: unknown
  userId?: string | null
}

async function actorName(tx: any, userId?: string | null): Promise<string | null> {
  if (!userId) return null
  try {
    const u = await tx.savdoUser.findUnique({ where: { id: userId }, select: { fullName: true, email: true } })
    return u?.fullName || u?.email || null
  } catch { return null }
}

/** Audit yozuvi — chaqiruvchining tranzaksiyasi (tx) ichida yoziladi: amal bo'lsa, iz ham bor. */
export async function writeAudit(tx: any, e: AuditEntry): Promise<void> {
  await tx.savdoAuditLog.create({
    data: {
      orgId: e.orgId, entity: e.entity, entityId: e.entityId, entityLabel: e.entityLabel ?? null,
      action: e.action, reason: e.reason,
      before: e.before === undefined ? undefined : (JSON.parse(JSON.stringify(e.before)) as any),
      after: e.after === undefined ? undefined : (JSON.parse(JSON.stringify(e.after)) as any),
      userId: e.userId ?? null, userName: await actorName(tx, e.userId),
    },
  })
}
