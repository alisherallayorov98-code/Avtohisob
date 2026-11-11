// STIR takrori topilganda boshqa tumandagi tashkilot nomi sizib chiqmasin (tuman doirasi).
import { ScopeUser, canAccessEntity } from './ekoScope'

export interface DupHit {
  id: string
  name: string
  status: string
  orgId?: string
  districtId?: string
}

/** Foydalanuvchi ko'ra olmaydigan tashkilotning nomi yashiriladi; id/holat saqlanadi (takror ekani ma'lum bo'lsin). */
export function maskDuplicateForUser(
  user: ScopeUser,
  dup: DupHit,
): { id: string; name: string; status: string; restricted?: boolean } {
  const visible = canAccessEntity(user, { orgId: dup.orgId ?? user.orgId, districtId: dup.districtId ?? '' })
  if (visible) return { id: dup.id, name: dup.name, status: dup.status }
  return { id: dup.id, name: 'Boshqa tumandagi tashkilot', status: dup.status, restricted: true }
}
