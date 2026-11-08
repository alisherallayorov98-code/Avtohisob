export type ReviewRisk = 'ok' | 'check' | 'suspicious'
export type FlagLevel = 'critical' | 'warning' | 'info'

export interface ReviewFlag { code: string; level: FlagLevel; text: string; itemId?: string }

export interface ReviewItemCtx {
  itemId: string
  last: { date: string; daysAgo: number; vehicleKm: number | null; kmAgo: number | null; worker: string | null; unitCost: number; quantity: number } | null
  refPrice: number | null
  priceDiffPct: number | null
  stock: number | null
  typicalGapDays: number | null
}

export interface ReviewCtx {
  risk: ReviewRisk
  flags: ReviewFlag[]
  items: ReviewItemCtx[]
  vehicle: {
    mileage: number | null
    count90: number
    lastMaintenanceAt: string | null
    recent: { id: string; date: string; worker: string | null; total: number; parts: string[] }[]
  }
}

export interface Evidence { id: string; fileUrl: string; fileSizeBytes: number; createdAt: string }

export interface PendingRecord {
  id: string
  vehicleId: string
  installationDate: string
  createdAt: string
  cost: number
  laborCost: number
  workerName?: string | null
  notes?: string | null
  vehicle: { id: string; registrationNumber: string; brand: string; model: string }
  performedBy: { id: string; fullName: string }
  items: { id: string; sparePart: { name: string; partCode: string }; quantityUsed: number; unitCost: number; warehouse?: { name: string } | null }[]
  evidence: Evidence[]
  review?: ReviewCtx
}

export const RISK_STYLE: Record<ReviewRisk, { label: string; dot: string; chip: string; banner: string; icon: string }> = {
  suspicious: {
    label: 'Diqqat', dot: 'bg-red-500',
    chip: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    banner: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
    icon: 'text-red-600 dark:text-red-400',
  },
  check: {
    label: 'Tekshiring', dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    banner: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  ok: {
    label: 'Toza', dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    banner: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
}

export const REJECT_PRESETS = ['Takror kiritilgan', 'Dalil yetarli emas', "Narx noto'g'ri", 'Ombordan chiqmagan', "Ma'lumotni aniqlashtiring"]

export const isVideoUrl = (url: string) => /\.(mp4|webm|mov)$/i.test(url)

export const daysLabel = (d: number) => (d <= 0 ? 'bugun' : d === 1 ? 'kecha' : `${d} kun oldin`)
