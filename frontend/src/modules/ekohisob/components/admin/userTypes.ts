export type EkoRole = 'admin' | 'inspector' | 'supervisor'

export interface BotLinkInfo {
  chatId?: string
  tgUsername: string | null
  tgFirstName: string | null
  linkedAt: string
}

export interface EkoUserRow {
  id: string
  fullName: string
  email: string
  role: EkoRole
  isActive: boolean
  districtIds: string[]
  botLink: BotLinkInfo | null
  mustChangePassword: boolean
  lockedUntil: string | null
}

export const ROLE_LABEL: Record<EkoRole, string> = {
  admin: 'Admin',
  inspector: 'Inspektor',
  supervisor: 'Boshliq (nazoratchi)',
}

export function mapUser(u: any): EkoUserRow {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    // Backend `districts: [{ district: {id,name} }]` -> districtIds
    districtIds: Array.isArray(u.districts)
      ? u.districts.map((d: any) => d.district?.id ?? d.districtId).filter(Boolean)
      : (u.districtIds ?? []),
    botLink: u.botLink ?? null,
    mustChangePassword: !!u.mustChangePassword,
    lockedUntil: u.lockedUntil ?? null,
  }
}

export const isLockedNow = (u: EkoUserRow) => !!u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()
