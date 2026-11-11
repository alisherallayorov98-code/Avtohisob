export interface Missing { key: string; label: string }

export interface CardEntity {
  id: string; name: string; code?: string | null; stir?: string | null; address?: string | null
  phone?: string | null; contactName?: string | null; contractNumber?: string | null
  contractStartMonth?: string | null; lat?: number | null; lon?: number | null
  status: 'active' | 'blacklisted' | 'inactive' | 'draft'
  entityType?: 'legal' | 'ip' | 'person'
  billingMode: 'monthly_fixed' | 'variable' | 'talon'
  monthlyFee: number; cubicPrice: number; debtLevel: string
  smsOptOut?: boolean
  districtId: string; mahallId?: string | null
  district?: { id: string; name: string }; mahalla?: { id: string; name: string } | null
  blacklist?: { status: string; reason: string } | null
  createdAt: string
}

export interface Card {
  entity: CardEntity
  completeness: { percent: number; missingRequired: Missing[]; missingOptional: Missing[]; isReady: boolean }
  debt: { totalDebt: number; debtMonths: number; unpaidMonths: string[]; level: string }
  payments: Array<{
    id: string; month: string; amount: number; paidAt: string
    receiver?: { fullName: string }; receipt?: { id: string; receiptNumber: string } | null
  }>
  talons: Array<{ id: string; date: string; volume: number; amount: number; paid: boolean }>
  smsLogs: Array<{ id: string; status: string; createdAt: string }>
}

export interface EntityCardActions {
  onPay: (e: CardEntity) => void
  onLedger: (e: CardEntity) => void
  onTalons: (e: CardEntity) => void
  onProof: (e: CardEntity) => void
  onSms: (e: CardEntity) => void
  onBlacklist: (e: CardEntity) => void
  onPickLocation: (e: CardEntity) => void
  onAkt: (id: string) => void
}
