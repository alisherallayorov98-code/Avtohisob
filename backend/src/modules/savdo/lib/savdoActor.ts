// Asosiy AutoHisob hisobi bilan Savdo'ga kirgan admin uchun "soya" yozuv.
// EkoHisob'dagi ensureEkoActor bilan bir xil maqsad: keyingi bosqichlarda
// yoziladigan yozuvlarda (masalan to'lov qabul qildi, sotuv qildi) savdo_users
// jadvaliga FK talab qilinadi — asosiy AutoHisob admin'ning id'si u yerda yo'q.

import { prisma } from '../../../lib/prisma'
import { SavdoUserPayload } from '../middleware/savdoAuth'

export async function ensureSavdoActor(actor: SavdoUserPayload): Promise<string> {
  const existing = await (prisma as any).savdoUser.findUnique({
    where: { id: actor.id },
    select: { id: true },
  })
  if (existing) return existing.id

  try {
    const created = await (prisma as any).savdoUser.create({
      data: {
        id: actor.id,
        email: actor.email || `mirror-${actor.id}`,
        passwordHash: '',            // bu yozuv bilan tizimga kirib bo'lmaydi
        fullName: actor.email || 'Tizim admini',
        role: 'admin',
        orgId: actor.orgId,
        isMirror: true,
      },
      select: { id: true },
    })
    return created.id
  } catch {
    const byEmail = await (prisma as any).savdoUser.findFirst({
      where: { email: actor.email, orgId: actor.orgId },
      select: { id: true },
    })
    if (byEmail) return byEmail.id
    throw new Error('Foydalanuvchi Savdo tizimida topilmadi — administrator bilan bog\'laning')
  }
}
