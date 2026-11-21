// Robot topshiriqlari: qaysi savol kimga ketadi (triage) va savol yo'qolganda
// haqiqatan hal bo'lganini tekshirish (verify). PURE — testlanadi.
import type { FindingOut, TaskStatus } from './types'
import { sortFindings } from './engine'

/** Bir inspektorga bir kunda avtomatik yuboriladigan maksimal savol */
export const PER_INSPECTOR_DAILY = 10
/** Inspektorda shuncha ochiq topshiriq bo'lsa — yangisi berilmaydi (ko'mib tashlamaslik) */
export const MAX_OPEN_PER_INSPECTOR = 30
/** Javob muddati (kun) */
export const TASK_DUE_DAYS = 3

export interface InspectorLite {
  id: string
  districtIds: string[]
  openTasks: number
  botLinked: boolean
}

export interface PlannedTask { finding: FindingOut; assigneeId: string }

/**
 * Avtomatik yuboriladigan savollar: tier=auto, tashkilotga bog'langan, hali ochiq topshirig'i yo'q.
 * Tuman inspektorlaridan eng kam ochiq topshirig'i bori (teng bo'lsa botga ulangani) tanlanadi.
 */
export function planAutoTasks(
  findings: FindingOut[],
  existingFingerprints: Set<string>,
  inspectors: InspectorLite[],
  opts: { perInspectorDaily?: number; maxOpen?: number } = {},
): PlannedTask[] {
  const daily = opts.perInspectorDaily ?? PER_INSPECTOR_DAILY
  const maxOpen = opts.maxOpen ?? MAX_OPEN_PER_INSPECTOR
  const load = new Map(inspectors.map(i => [i.id, { open: i.openTasks, today: 0 }]))
  const out: PlannedTask[] = []
  for (const f of sortFindings(findings)) {
    if (f.tier !== 'auto' || !f.entityId || !f.districtId) continue
    if (existingFingerprints.has(f.fingerprint)) continue
    const cands = inspectors
      .filter(i => i.districtIds.includes(f.districtId!))
      .filter(i => { const l = load.get(i.id)!; return l.today < daily && l.open < maxOpen })
      .sort((a, b) => load.get(a.id)!.open - load.get(b.id)!.open || Number(b.botLinked) - Number(a.botLinked) || a.id.localeCompare(b.id))
    const pick = cands[0]
    if (!pick) continue
    const l = load.get(pick.id)!
    l.open++; l.today++
    out.push({ finding: f, assigneeId: pick.id })
  }
  return out
}

export interface VerifyFacts {
  /** Tashkilotning hozirgi holati (null — o'chirilgan) */
  entityStatus: string | null
  paymentAfter: boolean
  visitAfter: boolean
  smsAfter: boolean
  /** Topshiriqdan keyin yozilgan yangi va'da sanasi (bo'lsa) */
  newPromise: string | null
}

export interface VerifyResult { status: Extract<TaskStatus, 'resolved' | 'suspicious'>; note: string }

/**
 * Savol yo'qoldi — lekin nega? Haqiqiy ish (to'lov, tashrif, ma'lumot) bo'lsa "hal qilindi",
 * aks holda "shubhali" — admin ko'radi. Masalan tashkilotni nofaol qilib qo'yish ham savolni
 * yo'qotadi, lekin bu qarz undirilgani emas.
 */
export function verifyDisappeared(ruleKey: string, x: VerifyFacts): VerifyResult {
  if (x.entityStatus == null) return { status: 'suspicious', note: "Tashkilot o'chirilgan — sababini so'rang." }
  if (x.entityStatus === 'inactive') return { status: 'suspicious', note: 'Tashkilot nofaol qilindi — qarz undirilmagan. Sababini tekshiring.' }
  if (x.entityStatus === 'blacklisted' && ruleKey.startsWith('collection.')) {
    return { status: 'resolved', note: "Tashkilot qora ro'yxatga qo'shildi." }
  }
  switch (ruleKey) {
    case 'collection.promise_broken':
      if (x.paymentAfter) return { status: 'resolved', note: "To'lov yozildi." }
      if (x.newPromise) return { status: 'resolved', note: `Yangi va'da olindi: ${x.newPromise.split('-').reverse().join('.')}.` }
      return { status: 'suspicious', note: "Savol yo'qoldi, lekin to'lov ham, yangi va'da ham yo'q." }
    case 'collection.stopped_paying':
      return x.paymentAfter
        ? { status: 'resolved', note: "Mijoz yana to'lay boshladi." }
        : { status: 'suspicious', note: "Savol yo'qoldi, lekin yangi to'lov yo'q." }
    case 'collection.critical_untouched':
      if (x.paymentAfter) return { status: 'resolved', note: "To'lov yozildi." }
      if (x.visitAfter) return { status: 'resolved', note: 'Tashrif qayd etildi.' }
      if (x.smsAfter) return { status: 'resolved', note: 'SMS yuborildi.' }
      return { status: 'suspicious', note: "Savol yo'qoldi, lekin tashrif/SMS/to'lov topilmadi." }
    case 'collection.variable_never_paid':
      return x.paymentAfter
        ? { status: 'resolved', note: "Birinchi to'lov yozildi." }
        : { status: 'resolved', note: "To'lov rejimi yoki summa o'zgartirildi." }
    default:
      return { status: 'resolved', note: "Ma'lumot to'ldirildi — savol o'z-o'zidan yo'qoldi." }
  }
}
