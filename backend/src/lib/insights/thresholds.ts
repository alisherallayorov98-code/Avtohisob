// Tashkilot sozlay oladigan chegaralar. Karyer mashinasi bilan Damas uchun bir xil chegara
// ishlamaydi — admin Tahlil sozlamalaridan o'zgartiradi (insight_settings.thresholds).

export interface Thresholds {
  fuelOverNormPct: number
  fuelOwnAvgPct: number
  fuelModelPct: number
  gpsNoSignalDays: number
  idleDays: number
  docWarnDays: number
  repeatPartDays: number
  bigRepairUzs: number
  pendingApprovalDays: number
  oilOverdueCriticalKm: number
  engineCriticalUzs: number
  monthlyKmDropPct: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  fuelOverNormPct: 20,
  fuelOwnAvgPct: 25,
  fuelModelPct: 30,
  gpsNoSignalDays: 3,
  idleDays: 14,
  docWarnDays: 14,
  repeatPartDays: 60,
  bigRepairUzs: 1_000_000,
  pendingApprovalDays: 3,
  oilOverdueCriticalKm: 1000,
  engineCriticalUzs: 2_000_000,
  monthlyKmDropPct: 40,
}

export interface ThresholdMeta { key: keyof Thresholds; label: string; unit: string; min: number; max: number; group: string }

export const THRESHOLD_META: ThresholdMeta[] = [
  { key: 'fuelOverNormPct', label: "Sarf normadan oshsa", unit: '%', min: 5, max: 100, group: "Yoqilg'i" },
  { key: 'fuelOwnAvgPct', label: "Sarf o'z o'rtachasidan oshsa", unit: '%', min: 5, max: 100, group: "Yoqilg'i" },
  { key: 'fuelModelPct', label: "Sarf shu model medianasidan oshsa", unit: '%', min: 5, max: 100, group: "Yoqilg'i" },
  { key: 'gpsNoSignalDays', label: "GPS signal yo'q", unit: 'kun', min: 1, max: 30, group: 'GPS' },
  { key: 'idleDays', label: "Mashina joyidan qo'zg'almasa", unit: 'kun', min: 3, max: 60, group: 'GPS' },
  { key: 'monthlyKmDropPct', label: 'Oylik km kamaysa', unit: '%', min: 10, max: 90, group: 'GPS' },
  { key: 'docWarnDays', label: 'Hujjat tugashidan oldin ogohlantirish', unit: 'kun', min: 3, max: 60, group: 'Hujjatlar' },
  { key: 'repeatPartDays', label: 'Bir xil detal qayta almashtirilsa', unit: 'kun ichida', min: 7, max: 365, group: "Ta'mir" },
  { key: 'bigRepairUzs', label: "Katta ta'mir chegarasi (rasm talab qilinadi)", unit: "so'm", min: 100_000, max: 100_000_000, group: "Ta'mir" },
  { key: 'pendingApprovalDays', label: "Ta'mir tasdiqlanmasa", unit: 'kun', min: 1, max: 30, group: "Ta'mir" },
  { key: 'engineCriticalUzs', label: "Dvigatel ta'miri kritik hisoblanadi", unit: "so'mdan", min: 100_000, max: 100_000_000, group: 'Dvigatel' },
  { key: 'oilOverdueCriticalKm', label: "Moy muddati kritik hisoblanadi", unit: 'km oshsa', min: 100, max: 10_000, group: 'Moy' },
]

/** Saqlangan qiymatlarni tekshirib, chegaradan tashqarisini rad etib, default bilan birlashtiradi */
export function mergeThresholds(over: unknown): Thresholds {
  const out: Thresholds = { ...DEFAULT_THRESHOLDS }
  if (!over || typeof over !== 'object') return out
  for (const m of THRESHOLD_META) {
    const raw = (over as Record<string, unknown>)[m.key]
    const n = typeof raw === 'string' ? Number(raw) : raw
    if (typeof n === 'number' && Number.isFinite(n) && n >= m.min && n <= m.max) out[m.key] = n
  }
  return out
}

/** Faqat defaultdan farq qiladigan qiymatlarni saqlash uchun */
export function diffFromDefaults(t: Thresholds): Partial<Thresholds> {
  const out: Partial<Thresholds> = {}
  for (const m of THRESHOLD_META) if (t[m.key] !== DEFAULT_THRESHOLDS[m.key]) out[m.key] = t[m.key]
  return out
}
