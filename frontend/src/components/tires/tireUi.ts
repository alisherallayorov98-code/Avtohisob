export const POSITIONS: { value: string; label: string }[] = [
  { value: 'Front-Left', label: 'Old chap' },
  { value: 'Front-Right', label: "Old o'ng" },
  { value: 'Rear-Left', label: 'Orqa chap' },
  { value: 'Rear-Right', label: "Orqa o'ng" },
  { value: 'Spare', label: 'Zaxira' },
]

export const positionLabel = (p?: string | null) =>
  (p && POSITIONS.find(x => x.value === p)?.label) || p || "Joyi ko'rsatilmagan"

export type UsageLevel = 'ok' | 'warning' | 'critical'

export const LEVEL_STYLE: Record<UsageLevel, { dot: string; bar: string; text: string; chip: string; label: string }> = {
  ok: {
    dot: 'bg-emerald-500', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', label: 'Yaxshi',
  },
  warning: {
    dot: 'bg-amber-500', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', label: 'Diqqat',
  },
  critical: {
    dot: 'bg-red-500', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400',
    chip: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300', label: 'Almashtirish kerak',
  },
}

export const EVENT_STYLE: Record<string, { label: string; dot: string; chip: string }> = {
  installed: { label: "O'rnatildi", dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  removed: { label: 'Olib olindi', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  returned: { label: 'Qaytarildi', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  written_off: { label: 'Hisobdan chiqarildi', dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  purchased: { label: 'Tizimga kiritildi', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  deduction_applied: { label: 'Ushlab qolish', dot: 'bg-yellow-500', chip: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
}

export const eventStyle = (type: string) =>
  EVENT_STYLE[type] || { label: type, dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600' }

export const fmtKm = (n: number | string | null | undefined) =>
  n == null || n === '' ? '—' : `${Math.round(Number(n)).toLocaleString('uz-UZ')} km`

export const isUnknown = (v?: string | null) => !v || v === "Noma'lum" || v === 'N/A'

export const tireTitle = (t: { brand?: string | null; model?: string | null; size?: string | null }) => {
  const parts = [t.brand, t.model].filter(x => !isUnknown(x))
  const name = parts.join(' ')
  const size = isUnknown(t.size) ? '' : t.size
  return [name, size].filter(Boolean).join(' · ') || "Brend/model kiritilmagan"
}

export interface OverviewTire {
  id: string
  serialCode: string
  brand?: string | null
  model?: string | null
  size?: string | null
  position?: string | null
  installationDate?: string | null
  installedMileageKm?: number | null
  standardMileageKm?: number | null
  drivenSinceInstallKm: number | null
  usedKm: number
  usedPct: number
  usageLevel: UsageLevel
  driver?: { fullName: string } | null
}

export interface OverviewRow {
  vehicle: { id: string; registrationNumber: string; brand: string; model: string; currentMileage: number; branchName: string | null }
  tires: OverviewTire[]
  criticalCount: number
  warningCount: number
}

export const todayISO = () => new Date().toISOString().slice(0, 10)
