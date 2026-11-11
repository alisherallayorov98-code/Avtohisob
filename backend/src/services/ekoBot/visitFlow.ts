// "To'lamadi" qaydi — pure qism.
import { addDaysIso, parseVisitInput } from '../../modules/ekohisob/lib/visitMath'
import { isValidIsoDate } from '../../modules/ekohisob/lib/uzt'

export const REASONS: Record<string, string> = {
  cash: "Pul yo'q",
  absent: "Egasi yo'q",
  refused: 'Rad etdi',
  later: "Keyin to'laydi",
}

export const PROMISE_PRESETS = [3, 7, 14] as const

export function presetDate(today: string, days: number): string {
  return addDaysIso(today, days)
}

/** "dd.mm.yyyy" (nuqta, / yoki - ajratgich) -> "YYYY-MM-DD" yoki null. */
export function parsePromiseText(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text.trim())
  if (!m) return null
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return isValidIsoDate(iso) ? iso : null
}

export interface VisitDraft {
  reason: string | null
  promisedDate: string | null
  photoFileId: string | null
  lat: number | null
  lon: number | null
}

export function buildVisitBody(d: VisitDraft) {
  return {
    kind: d.promisedDate ? 'promised' : 'not_paid',
    reason: d.reason ?? (d.promisedDate ? undefined : "Sabab ko'rsatilmadi"),
    promisedDate: d.promisedDate ?? undefined,
    lat: d.lat ?? undefined,
    lon: d.lon ?? undefined,
    photoFileId: d.photoFileId ?? undefined,
  }
}

export function validateVisit(d: VisitDraft, today: string) {
  return parseVisitInput(buildVisitBody(d), today)
}
