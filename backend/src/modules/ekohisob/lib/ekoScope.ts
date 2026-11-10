/**
 * EkoHisob — tashkilotlarga kirish doirasi (tenant + tuman) YAGONA manbasi.
 *
 * Ilgari har kontrollerda `role === 'inspector'` yoki `role !== 'admin'` alohida
 * yozilgan va ular bir-biriga zid edi: boshliq (supervisor) ro'yxatda hamma
 * tashkilotni, kartochkada esa faqat o'z tumanini ko'rardi. Endi qoida bitta:
 *
 *   admin       → butun korxona (orgId)
 *   inspector,
 *   supervisor  → FAQAT biriktirilgan tumanlar. Tumani yo'q → HECH NARSA (bo'sh).
 *
 * `organizationId: null OR` KABI shartlar HECH QACHON ishlatilmaydi (tenant leak).
 */

export interface ScopeUser {
  role: string
  orgId: string
  districtIds: string[]
}

export function isEkoAdmin(user: Pick<ScopeUser, 'role'>): boolean {
  return user.role === 'admin'
}

/**
 * Prisma `where` bo'lagi — `EkoHisobLegalEntity` uchun (yoki `entity: { ... }` ichida
 * to'lov/talon/charge uchun). orgId DOIM bor; admin bo'lmasa tuman cheklovi qo'shiladi.
 */
export function entityScopeWhere(user: ScopeUser): { orgId: string; districtId?: { in: string[] } } {
  if (!user.orgId) {
    // orgId bo'lmasa hech narsa ko'rsatilmaydi (bo'sh qator bilan mos kelib ketmasin)
    return { orgId: '__no_org__', districtId: { in: [] } }
  }
  if (isEkoAdmin(user)) return { orgId: user.orgId }
  return { orgId: user.orgId, districtId: { in: [...(user.districtIds ?? [])] } }
}

/** Alohida tashkilotga kirish mumkinmi (kartochka, to'lov, talon, SMS, kvitansiya...). */
export function canAccessEntity(
  user: ScopeUser,
  entity: { orgId: string; districtId: string } | null | undefined,
): boolean {
  if (!entity || !user.orgId) return false
  if (entity.orgId !== user.orgId) return false
  if (isEkoAdmin(user)) return true
  return (user.districtIds ?? []).includes(entity.districtId)
}

/** Tuman berilgan joyda (masalan, filtr/yaratish) shu tumanga kirish mumkinmi. */
export function canAccessDistrict(user: ScopeUser, districtId: string): boolean {
  if (!user.orgId) return false
  if (isEkoAdmin(user)) return true
  return (user.districtIds ?? []).includes(districtId)
}

/** Foydalanuvchi ko'ra oladigan tumanlar bo'yicha filtr (admin uchun cheklov yo'q → undefined). */
export function districtIdsFilter(user: ScopeUser): string[] | undefined {
  return isEkoAdmin(user) ? undefined : [...(user.districtIds ?? [])]
}
