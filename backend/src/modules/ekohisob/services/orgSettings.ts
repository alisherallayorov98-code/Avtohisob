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
  escalationEnabled: boolean
}

export const DEFAULT_ORG_SETTINGS: Omit<EkoOrgSettings, 'orgId'> = {
  smsMonthlyLimit: null,
  smsAutoEnabled: false,
  smsAutoDay: 10,
  smsAutoMinLevel: 'overdue',
  smsDailyMax: 200,
  smsTemplate: null,
  contactPhone: null,
  escalationEnabled: false,
}

/** Korxona sozlamalari — yozuv bo'lmasa standart qiymatlar. Hech qachon xato tashlamaydi. */
export async function getOrgSettings(orgId: string): Promise<EkoOrgSettings> {
  try {
    const s = await (prisma as any).ekoHisobOrgSettings.findUnique({ where: { orgId } })
    if (s) return { ...DEFAULT_ORG_SETTINGS, ...s, orgId }
  } catch { /* jadval yo'q yoki DB xatosi — standartga qaytamiz */ }
  return { ...DEFAULT_ORG_SETTINGS, orgId }
}
