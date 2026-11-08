// Admin tasdiqlash oynasi uchun sof tekshiruv mantiqi (DB'siz, testlangan).
// Xodim yuborgan ta'mirlash arizasi bo'yicha: takror o'rnatish, narx farqi (kirim narxiga nisbatan),
// ombor qoldig'i, dalil va usta takrori. Natija — xavf darajasi va sababli ogohlantirishlar ro'yxati.

export type ReviewRisk = 'ok' | 'check' | 'suspicious'
export type FlagLevel = 'critical' | 'warning' | 'info'

export interface ReviewFlag {
  code: 'repeat_recent' | 'repeat_early' | 'repeat_old' | 'duplicate_pending' | 'price_high' | 'stock_low' | 'no_evidence' | 'worker_repeat'
  level: FlagLevel
  text: string
  itemId?: string
}

export interface LastInstall {
  date: Date | string
  vehicleKm: number | null
  worker: string | null
  unitCost: number
  quantity: number
}

export interface ReviewItemInput {
  itemId: string
  name: string
  quantity: number
  unitCost: number
  /** Kirimdagi (katalog) narx — SparePart.unitPrice */
  refPrice: number | null
  /** Tanlangan skladdagi qoldiq; noma'lum bo'lsa null */
  stock: number | null
  /** Shu mashinaga shu qism oxirgi marta tasdiqlangan o'rnatish */
  lastOnVehicle: LastInstall | null
  /** Shu mashinadagi oldingi o'rnatish sanalari (typical oraliq uchun) */
  pastDates: (Date | string)[]
  /** Boshqa kutayotgan arizada ham shu mashinaga shu qism bor */
  alsoPending: boolean
}

export interface ReviewInput {
  installationDate: Date | string
  vehicleKm: number | null
  evidenceCount: number
  items: ReviewItemInput[]
  /** Shu usta shu mashinada oxirgi 6 oyda nechta tasdiqlangan ta'mir qilgan */
  workerRepeatCount: number
  workerName: string | null
}

export const REPEAT_CRITICAL_DAYS = 30
export const REPEAT_WARNING_DAYS = 90
export const PRICE_WARNING_PCT = 30
export const PRICE_CRITICAL_PCT = 60

export function daysBetween(later: Date | string, earlier: Date | string): number {
  return Math.floor((new Date(later).getTime() - new Date(earlier).getTime()) / 86400000)
}

/** Ketma-ket o'rnatishlar orasidagi kunlar medianasi; kamida 2 ta tarix (1 ta oraliq) kerak, aks holda null */
export function typicalGapDays(dates: (Date | string)[]): number | null {
  const ts = dates.map(d => new Date(d).getTime()).sort((a, b) => a - b)
  if (ts.length < 2) return null
  const gaps: number[] = []
  for (let i = 1; i < ts.length; i++) {
    const g = Math.round((ts[i] - ts[i - 1]) / 86400000)
    if (g > 0) gaps.push(g)
  }
  if (!gaps.length) return null
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2)
}

/** Kiritilgan narx kirim narxidan necha foiz yuqori (manfiy — arzon). Kirim narxi yo'q/0 bo'lsa null */
export function priceDiffPct(unitCost: number, refPrice: number | null): number | null {
  if (!refPrice || refPrice <= 0 || !(unitCost >= 0)) return null
  return Math.round(((unitCost - refPrice) / refPrice) * 100)
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')

export function evaluateReview(input: ReviewInput): { risk: ReviewRisk; flags: ReviewFlag[] } {
  const flags: ReviewFlag[] = []

  if (input.evidenceCount === 0) {
    flags.push({ code: 'no_evidence', level: 'critical', text: 'Dalil (foto/video) yuklanmagan' })
  }

  for (const it of input.items) {
    if (it.lastOnVehicle) {
      const days = daysBetween(input.installationDate, it.lastOnVehicle.date)
      if (days >= 0) {
        const kmPart = it.lastOnVehicle.vehicleKm != null && input.vehicleKm != null && input.vehicleKm >= it.lastOnVehicle.vehicleKm
          ? `, ${fmt(input.vehicleKm - it.lastOnVehicle.vehicleKm)} km oldin` : ''
        if (days <= REPEAT_CRITICAL_DAYS) {
          flags.push({ code: 'repeat_recent', level: 'critical', itemId: it.itemId,
            text: `"${it.name}" shu mashinaga ${days} kun oldin${kmPart} qo'yilgan edi — takror bo'lishi mumkin` })
        } else if (days <= REPEAT_WARNING_DAYS) {
          flags.push({ code: 'repeat_early', level: 'warning', itemId: it.itemId,
            text: `"${it.name}" shu mashinaga ${days} kun oldin${kmPart} qo'yilgan edi` })
        } else {
          flags.push({ code: 'repeat_old', level: 'info', itemId: it.itemId,
            text: `"${it.name}" oxirgi marta ${days} kun oldin${kmPart} qo'yilgan` })
        }
        // Odatdagi almashish oralig'idan ancha erta (takror bayrog'i yo'q bo'lsa)
        const typical = typicalGapDays(it.pastDates)
        if (typical && days > REPEAT_WARNING_DAYS && days < typical * 0.5) {
          flags.push({ code: 'repeat_early', level: 'warning', itemId: it.itemId,
            text: `"${it.name}" bu mashinada odatda ~${typical} kunda almashadi, bu safar ${days} kunda` })
        }
      }
    }

    if (it.alsoPending) {
      flags.push({ code: 'duplicate_pending', level: 'critical', itemId: it.itemId,
        text: `"${it.name}" shu mashina uchun boshqa kutayotgan arizada ham bor` })
    }

    const diff = priceDiffPct(it.unitCost, it.refPrice)
    if (diff != null && diff >= PRICE_WARNING_PCT) {
      flags.push({ code: 'price_high', level: diff >= PRICE_CRITICAL_PCT ? 'critical' : 'warning', itemId: it.itemId,
        text: `"${it.name}": kirimda ${fmt(it.refPrice!)} so'm, kiritilgan ${fmt(it.unitCost)} so'm (+${diff}%)` })
    }

    if (it.stock != null && it.stock < it.quantity) {
      flags.push({ code: 'stock_low', level: 'critical', itemId: it.itemId,
        text: `"${it.name}": omborda ${it.stock} ta, kerak ${it.quantity} ta — tasdiqlab bo'lmaydi` })
    }
  }

  if (input.workerName && input.workerRepeatCount >= 2) {
    flags.push({ code: 'worker_repeat', level: 'warning',
      text: `Usta "${input.workerName}" bu mashinani 6 oyda ${input.workerRepeatCount + 1} marta ta'mirlayapti` })
  }

  const order = { critical: 0, warning: 1, info: 2 } as const
  flags.sort((a, b) => order[a.level] - order[b.level])
  const risk: ReviewRisk = flags.some(f => f.level === 'critical') ? 'suspicious' : flags.some(f => f.level === 'warning') ? 'check' : 'ok'
  return { risk, flags }
}

export const RISK_ORDER: Record<ReviewRisk, number> = { suspicious: 0, check: 1, ok: 2 }
