// EkoHisob qarz eskalatsiyasi — sof mantiq (DB'siz, testlanadi).
//
// Nega: `debtLevel` ilgari shunchaki yorliq edi — daraja o'zgarganda hech narsa
// sodir bo'lmasdi va qarzdorni faqat inspektor eslasa ta'qib qilinardi.
// Endi daraja OSHGANDA (pasayganda emas) sozlangan amallar bir marta bajariladi.

export type DebtLevel = 'current' | 'warning' | 'overdue' | 'critical' | 'blacklisted'
export type EscalationAction = 'sms' | 'inspector' | 'manager' | 'blacklist_suggest'

/** Darajalar tartibi — qaysi biri "yuqoriroq" ekanini solishtirish uchun */
const LEVEL_ORDER: Record<string, number> = {
  current: 0,
  warning: 1,
  overdue: 2,
  critical: 3,
  blacklisted: 4,
}

export function levelRank(level: string | null | undefined): number {
  return LEVEL_ORDER[String(level ?? 'current')] ?? 0
}

/**
 * Daraja oshdimi? Faqat oshganda eskalatsiya ishga tushadi.
 * Pasayish (to'lov qilindi) hech qanday xabar yubormaydi — bu yaxshi yangilik,
 * lekin jurnal tozalanadi (keyin yana qarzdor bo'lsa qaytadan ishlashi uchun).
 */
export function isEscalation(oldLevel: string | null | undefined, newLevel: string): boolean {
  return levelRank(newLevel) > levelRank(oldLevel)
}

/** Daraja pasaydimi (jurnalni tozalash kerakmi) */
export function isDeescalation(oldLevel: string | null | undefined, newLevel: string): boolean {
  return levelRank(newLevel) < levelRank(oldLevel)
}

export interface EscalationRule {
  level: string
  smsEnabled: boolean
  notifyInspector: boolean
  notifyManager: boolean
  suggestBlacklist: boolean
  isActive: boolean
}

/**
 * Standart qoidalar — korxona hech narsa sozlamagan bo'lsa shular ishlaydi.
 *  - warning (1 oy): hech narsa. Bir oy kechikish odatiy holat, darrov
 *    bezovta qilish mijoz bilan munosabatni buzadi.
 *  - overdue (2 oy): inspektorga xabar — borib gaplashsin.
 *  - critical (3+ oy): tashkilotga SMS + inspektor + rahbar xulosasi +
 *    qora ro'yxatga TAVSIYA (avtomatik qo'shish YO'Q — yuridik oqibati bor).
 */
export const DEFAULT_ESCALATION_RULES: EscalationRule[] = [
  { level: 'warning',  smsEnabled: false, notifyInspector: false, notifyManager: false, suggestBlacklist: false, isActive: true },
  { level: 'overdue',  smsEnabled: false, notifyInspector: true,  notifyManager: false, suggestBlacklist: false, isActive: true },
  { level: 'critical', smsEnabled: true,  notifyInspector: true,  notifyManager: true,  suggestBlacklist: true,  isActive: true },
]

/**
 * Korxona qoidalarini standart qoidalar ustiga qo'yadi.
 * Bazada yozuv bo'lmagan daraja standart holicha qoladi.
 */
export function mergeRules(dbRules: Partial<EscalationRule>[]): Record<string, EscalationRule> {
  const out: Record<string, EscalationRule> = {}
  for (const d of DEFAULT_ESCALATION_RULES) out[d.level] = { ...d }
  for (const r of dbRules) {
    if (!r.level) continue
    out[r.level] = { ...(out[r.level] ?? DEFAULT_ESCALATION_RULES[0]), ...r, level: r.level } as EscalationRule
  }
  return out
}

/**
 * Berilgan daraja uchun bajariladigan amallar ro'yxati.
 * Qoida o'chirilgan (isActive: false) bo'lsa bo'sh ro'yxat.
 */
export function decideActions(
  level: string,
  rules: Record<string, EscalationRule>,
): EscalationAction[] {
  const rule = rules[level]
  if (!rule || !rule.isActive) return []
  const actions: EscalationAction[] = []
  if (rule.smsEnabled) actions.push('sms')
  if (rule.notifyInspector) actions.push('inspector')
  if (rule.notifyManager) actions.push('manager')
  if (rule.suggestBlacklist) actions.push('blacklist_suggest')
  return actions
}

/**
 * Avto-SMS uchun: tashkilot darajasi belgilangan eng past darajaga yetdimi.
 * Masalan minLevel='overdue' bo'lsa — overdue va critical qamrab olinadi.
 */
export function meetsMinLevel(level: string | null | undefined, minLevel: string): boolean {
  return levelRank(level) >= levelRank(minLevel) && levelRank(level) > 0
}
