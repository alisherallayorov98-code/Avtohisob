export interface EscalationRule {
  level: string
  smsEnabled: boolean
  notifyInspector: boolean
  notifyManager: boolean
  suggestBlacklist: boolean
  isActive: boolean
}

export interface SmsPreview {
  text: string
  chars: number
  unicode: boolean
  segments: number
  issues?: { level: 'error' | 'warning'; message: string }[]
}

export type RequisiteKey =
  | 'orgOfficialName' | 'orgStir' | 'orgPhone' | 'orgAddress' | 'orgBankAccount'
  | 'orgBankName' | 'orgMfo' | 'orgDirector' | 'orgAccountant'

export interface SettingsData extends Partial<Record<RequisiteKey, string | null>> {
  smsMonthlyLimit: number
  smsMonthlyLimitEditable: boolean
  smsConfigured: boolean
  smsAutoEnabled: boolean
  smsAutoDay: number
  smsAutoMinLevel: string
  smsAutoLastMonth?: string | null
  smsDailyMax: number
  smsTemplate: string | null
  smsTemplateDefault: string
  smsPlaceholders: string[]
  smsPreview: SmsPreview
  contactPhone: string | null
  paymentDueDay?: number
  escalationEnabled: boolean
  escalationRules: EscalationRule[]
}

/** Har bo'lim: o'z ma'lumoti va saqlangach asosiy so'rovni yangilash. */
export interface SectionProps {
  data: SettingsData
  onSaved: () => void
}
