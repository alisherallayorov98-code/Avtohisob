// EkoHisob korxona sozlamalari — o'qish yordamchilari.
// Sozlama yozuvi bo'lmasa standart qiymatlar qaytadi (yozuv talab qilinmaydi).

import { prisma } from '../../../lib/prisma'

export interface EkoOrgSettings {
  orgId: string
  smsMonthlyLimit: number | null
  smsAutoEnabled: boolean
  smsAutoDay: number
  smsAutoMinLevel: string
  smsDailyMax: number
  smsTemplate: string | null
  contactPhone: string | null
  /** Avto-SMS oxirgi to'liq ishlagan oy "YYYY-MM" (qayta urinish uchun) */
  smsAutoLastMonth: string | null
  /** To'lov muddati (oyning kuni, 1–28); 1 = hozirgi xatti-harakat */
  paymentDueDay: number
  escalationEnabled: boolean
  // Rasmiy hujjat rekvizitlari (akt sverka, faktura)
  orgOfficialName: string | null
  orgStir: string | null
  orgAddress: string | null
  orgPhone: string | null
  orgBankAccount: string | null
  orgBankName: string | null
  orgMfo: string | null
  orgDirector: string | null
  orgAccountant: string | null
}

export const DEFAULT_ORG_SETTINGS: Omit<EkoOrgSettings, 'orgId'> = {
  smsMonthlyLimit: null,
  smsAutoEnabled: false,
  smsAutoDay: 10,
  smsAutoMinLevel: 'overdue',
  smsDailyMax: 200,
  smsTemplate: null,
  contactPhone: null,
  smsAutoLastMonth: null,
  paymentDueDay: 1,
  escalationEnabled: false,
  orgOfficialName: null,
  orgStir: null,
  orgAddress: null,
  orgPhone: null,
  orgBankAccount: null,
  orgBankName: null,
  orgMfo: null,
  orgDirector: null,
  orgAccountant: null,
}

/** Korxona sozlamalari — yozuv bo'lmasa standart qiymatlar. Hech qachon xato tashlamaydi. */
export async function getOrgSettings(orgId: string): Promise<EkoOrgSettings> {
  try {
    const s = await (prisma as any).ekoHisobOrgSettings.findUnique({ where: { orgId } })
    if (s) return { ...DEFAULT_ORG_SETTINGS, ...s, orgId }
  } catch { /* jadval yo'q yoki DB xatosi — standartga qaytamiz */ }
  return { ...DEFAULT_ORG_SETTINGS, orgId }
}

const DEFAULT_SMS_MONTHLY_LIMIT = 1000

/** ENV (EKO_SMS_MONTHLY_LIMIT) yoki standart 1000 — korxona limiti bo'lmasa. Birligi: SEGMENT. */
export function envSmsLimit(): number {
  const v = parseInt(process.env.EKO_SMS_MONTHLY_LIMIT || '', 10)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SMS_MONTHLY_LIMIT
}

/** Korxonaning amaldagi oylik SMS limiti (segment) — yagona manba. */
export function effectiveSmsLimit(s: Pick<EkoOrgSettings, 'smsMonthlyLimit'>): number {
  return s.smsMonthlyLimit && s.smsMonthlyLimit > 0 ? s.smsMonthlyLimit : envSmsLimit()
}
