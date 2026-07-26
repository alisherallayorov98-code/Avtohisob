// Asosiy AutoHisob hisobi bilan EkoHisob'ga kirgan foydalanuvchi uchun "soya" yozuv.
//
// Muammo: EkoHisobPayment.receivedBy va EkoHisobReceipt.issuedBy — ekohisob_users
// jadvaliga MAJBURIY FK. Asosiy AutoHisob admin/super_admin EkoHisob'ga kirsa
// (EkoHisobApp buni ataylab qo'llab-quvvatlaydi), uning id'si ekohisob_users da
// yo'q — to'lov qabul qilishga urinish FK xatosi (500) bilan tugardi.
//
// Yechim: shu id bilan isMirror=true yozuv yaratiladi. U ro'yxatlarda ko'rinmaydi
// (listUsers isMirror=false filtri), tizimga kira olmaydi (passwordHash bo'sh),
// lekin FK va hisobotlar (kim qabul qildi) to'g'ri ishlaydi.

import { prisma } from '../../../lib/prisma'
import { EkoUserPayload } from '../middleware/ekoAuth'

/**
 * Foydalanuvchi uchun ekohisob_users da qator borligini kafolatlaydi va uning
 * id'sini qaytaradi. Real EkoHisob foydalanuvchisi bo'lsa hech narsa yaratmaydi.
 */
export async function ensureEkoActor(actor: EkoUserPayload): Promise<string> {
  const existing = await (prisma as any).ekoHisobUser.findUnique({
    where: { id: actor.id },
    select: { id: true },
  })
  if (existing) return existing.id

  try {
    const created = await (prisma as any).ekoHisobUser.create({
      data: {
        id: actor.id,
        email: actor.email || `mirror-${actor.id}`,
        passwordHash: '',            // bu yozuv bilan tizimga kirib bo'lmaydi
        fullName: actor.email || 'Tizim admini',
        role: actor.role === 'admin' ? 'admin' : 'inspector',
        orgId: actor.orgId,
        isMirror: true,
      },
      select: { id: true },
    })
    return created.id
  } catch {
    // [email, orgId] unikal cheklovi — shu email bilan real foydalanuvchi bor.
    // O'shani ishlatamiz (bir odam, ikki kirish usuli).
    const byEmail = await (prisma as any).ekoHisobUser.findFirst({
      where: { email: actor.email, orgId: actor.orgId },
      select: { id: true },
    })
    if (byEmail) return byEmail.id
    throw new Error('Foydalanuvchi EkoHisob tizimida topilmadi — administrator bilan bog\'laning')
  }
}
