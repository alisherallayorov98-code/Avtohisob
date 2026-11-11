export type Status = 'active' | 'blacklisted' | 'inactive' | 'draft'
export type BillingMode = 'monthly_fixed' | 'variable' | 'talon'

/** GET /entities qatori (Prisma modeli + district/mahalla + creatorName). Qarz SUMMASI ro'yxatda yo'q. */
export interface Entity {
  id: string
  code?: string | null
  name: string
  address?: string | null
  monthlyFee: number
  status: Status
  billingMode?: BillingMode
  cubicPrice?: number
  debtLevel?: string
  phone?: string | null
  districtId: string
  mahallId?: string | null
  district?: { id: string; name: string } | null
  mahalla?: { id: string; name: string } | null
  stir?: string | null
  lat?: number | null
  lon?: number | null
  smsOptOut?: boolean
  /** Kanonik jami qarz (so'm) */
  debtAmount?: number
  debtMonths?: number
  /** ['2026-09', ...] */
  unpaidMonths?: string[]
  advance?: number
  createdBy?: string | null
  creatorName?: string | null
  createdAt?: string
}

export interface EntityFilterState {
  search: string
  districtId: string
  mahallId: string
  status: string
  debtLevel: string
  billingMode: string
  createdBy: string
}

export const EMPTY_FILTERS: EntityFilterState = {
  search: '', districtId: '', mahallId: '', status: '', debtLevel: '', billingMode: '', createdBy: '',
}

export interface UserOption { id: string; fullName: string; role: string; isActive: boolean }
