// Shina yurgan masofasi — faqat odometr farqi (GPS'siz).
// totalMileage: avvalgi o'rnatishlarda yig'ilgan km (removeTire shuni oshiradi).
// Joriy o'rnatishdagi km = mashinaning hozirgi odometri − o'rnatilgan paytdagi odometr.

export type UsageLevel = 'ok' | 'warning' | 'critical'

export interface TireUsageInput {
  status: string
  installedMileageKm: number | null | undefined
  totalMileage: number | null | undefined
  standardMileageKm: number | null | undefined
}

export interface TireUsage {
  drivenSinceInstallKm: number | null
  usedKm: number
  normKm: number
  pct: number
  level: UsageLevel
}

export const DEFAULT_TIRE_NORM_KM = 40000

export function levelForPct(pct: number): UsageLevel {
  if (pct >= 90) return 'critical'
  if (pct >= 70) return 'warning'
  return 'ok'
}

export function computeTireUsage(tire: TireUsageInput, currentMileage: number | null | undefined): TireUsage {
  const normKm = tire.standardMileageKm && tire.standardMileageKm > 0 ? tire.standardMileageKm : DEFAULT_TIRE_NORM_KM
  const past = Number(tire.totalMileage) || 0

  let drivenSinceInstallKm: number | null = null
  if (
    tire.status === 'installed' &&
    tire.installedMileageKm != null &&
    currentMileage != null &&
    Number.isFinite(Number(currentMileage))
  ) {
    drivenSinceInstallKm = Math.max(0, Math.round(Number(currentMileage)) - Number(tire.installedMileageKm))
  }

  const usedKm = past + (drivenSinceInstallKm ?? 0)
  const pct = Math.min(100, Math.round((usedKm / normKm) * 100))
  return { drivenSinceInstallKm, usedKm, normKm, pct, level: levelForPct(pct) }
}
