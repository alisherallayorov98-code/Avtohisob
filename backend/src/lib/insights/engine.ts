// Tahlil dvigateli: barcha qoidalarni ishga tushiradi, shovqinni yig'adi (collapse),
// barqaror fingerprint beradi, yashirilganlarni (dismissal) ajratadi va tartiblaydi.
// PURE — Prisma'siz, to'liq testlanadi.
import type { Rule, Finding, FindingOut, Snapshot, Severity, Category } from './types'
import { buildCtx } from './context'
import { engineRules } from './rules/engine'
import { serviceRules } from './rules/service'
import { fuelRules } from './rules/fuel'
import { gpsRules } from './rules/gps'
import { documentRules } from './rules/documents'
import { tireRules } from './rules/tires'
import { repairRules } from './rules/repairs'
import { warehouseRules } from './rules/warehouse'
import { waybillRules } from './rules/waybills'
import { budgetRules } from './rules/budget'
import { dataRules } from './rules/dataQuality'

export const RULES: Rule[] = [
  ...engineRules, ...serviceRules, ...fuelRules, ...gpsRules, ...documentRules, ...tireRules,
  ...repairRules, ...warehouseRules, ...waybillRules, ...budgetRules, ...dataRules,
].sort((a, b) => a.no - b.no)

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

export function fingerprintOf(f: Pick<Finding, 'ruleKey' | 'vehicleId' | 'subjectKey'>): string {
  return `${f.ruleKey}|${f.vehicleId || ''}|${f.subjectKey || ''}`
}

/** Butun qoidani yashirish uchun maxsus fingerprint */
export const ruleFingerprint = (ruleKey: string) => `rule:${ruleKey}`

/** Tizimli muammo chegarasi: shuncha mashinada chiqsa — bitta umumiy savol */
export function collapseThreshold(activeCount: number): number {
  return Math.max(10, Math.ceil(activeCount * 0.6))
}

export interface RunResult {
  findings: FindingOut[]
  ruleErrors: Array<{ ruleKey: string; error: string }>
}

export function runRules(s: Snapshot, rules: Rule[] = RULES): RunResult {
  const c = buildCtx(s)
  const out: FindingOut[] = []
  const ruleErrors: RunResult['ruleErrors'] = []
  const threshold = collapseThreshold(c.active.length)

  for (const rule of rules) {
    let found: Finding[]
    try {
      found = rule.run(c)
    } catch (e: any) {
      // Bitta xato qoida butun sahifani yiqitmasin
      ruleErrors.push({ ruleKey: rule.key, error: e?.message || String(e) })
      continue
    }
    if (rule.collapse) {
      const perVehicle = found.filter(f => f.vehicleId)
      if (perVehicle.length >= threshold) {
        const rest = found.filter(f => !f.vehicleId)
        found = [...rest, {
          ruleKey: rule.key, category: rule.category,
          severity: rule.collapse.severity || 'info',
          vehicleId: null, subjectKey: 'org',
          title: rule.collapse.title(perVehicle.length),
          detail: `Bu bitta-ikkita mashina emas, tizimli muammo. Masalan: ${perVehicle.slice(0, 5).map(f => c.plate(f.vehicleId!)).join(', ')}` +
            `${perVehicle.length > 5 ? ` va yana ${perVehicle.length - 5} ta` : ''}.`,
          action: rule.collapse.action,
          impactUzs: perVehicle.reduce((sum, f) => sum + (f.impactUzs || 0), 0) || undefined,
        }]
      }
    }
    for (const f of found) {
      const v = f.vehicleId ? c.vehicle.get(f.vehicleId) : undefined
      out.push({
        ...f,
        impactUzs: f.impactUzs && f.impactUzs > 0 ? Math.round(f.impactUzs) : undefined,
        fingerprint: fingerprintOf(f),
        plate: v?.plate ?? null,
        branchId: v?.branchId ?? null,
      })
    }
  }

  // Bir xil fingerprint ikki marta chiqmasin (masalan ikki manbadan)
  const seen = new Set<string>()
  const unique = out.filter(f => (seen.has(f.fingerprint) ? false : (seen.add(f.fingerprint), true)))
  return { findings: sortFindings(unique), ruleErrors }
}

export function sortFindings<T extends Pick<Finding, 'severity' | 'impactUzs' | 'ruleKey'>>(xs: T[]): T[] {
  const no = new Map(RULES.map(r => [r.key, r.no]))
  return [...xs].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || (b.impactUzs || 0) - (a.impactUzs || 0)
    || (no.get(a.ruleKey) || 0) - (no.get(b.ruleKey) || 0))
}

export interface DismissalLike { fingerprint: string; until: Date | null }

/** Faol yashirishlarni qo'llaydi: aniq fingerprint yoki butun qoida (rule:<key>) */
export function applyDismissals<T extends { fingerprint: string; ruleKey: string }>(
  findings: T[], dismissals: DismissalLike[], now: Date,
): { visible: T[]; hidden: number } {
  const active = new Set(dismissals.filter(d => !d.until || d.until > now).map(d => d.fingerprint))
  const visible = findings.filter(f => !active.has(f.fingerprint) && !active.has(ruleFingerprint(f.ruleKey)))
  return { visible, hidden: findings.length - visible.length }
}

export interface Summary {
  total: number
  critical: number
  warning: number
  info: number
  impactUzs: number
  byCategory: Record<Category, number>
}

export function summarize(findings: Array<Pick<Finding, 'severity' | 'category' | 'impactUzs'>>): Summary {
  const byCategory = {
    engine: 0, service: 0, fuel: 0, gps: 0, documents: 0, tires: 0,
    repairs: 0, warehouse: 0, waybills: 0, budget: 0, data: 0,
  } as Record<Category, number>
  let critical = 0, warning = 0, info = 0, impactUzs = 0
  for (const f of findings) {
    if (f.severity === 'critical') critical++
    else if (f.severity === 'warning') warning++
    else info++
    byCategory[f.category]++
    impactUzs += f.impactUzs || 0
  }
  return { total: findings.length, critical, warning, info, impactUzs, byCategory }
}

export interface VehicleScore {
  vehicleId: string
  plate: string
  critical: number
  warning: number
  info: number
  score: number
}

/** Mashinalar bo'yicha dosye reytingi — eng muammolisi birinchi */
export function scoreVehicles(findings: FindingOut[]): VehicleScore[] {
  const m = new Map<string, VehicleScore>()
  for (const f of findings) {
    if (!f.vehicleId) continue
    const row = m.get(f.vehicleId) || { vehicleId: f.vehicleId, plate: f.plate || '—', critical: 0, warning: 0, info: 0, score: 0 }
    row[f.severity]++
    row.score += f.severity === 'critical' ? 10 : f.severity === 'warning' ? 3 : 1
    m.set(f.vehicleId, row)
  }
  return [...m.values()].sort((a, b) => b.score - a.score || a.plate.localeCompare(b.plate))
}

/** Kechagi holat bilan solishtirish: yangi paydo bo'lgan va hal qilingan */
export function diffFingerprints(current: string[], previous: string[] | null): { newSet: Set<string>; resolved: number } {
  if (!previous) return { newSet: new Set(), resolved: 0 }
  const prev = new Set(previous)
  const cur = new Set(current)
  const newSet = new Set(current.filter(f => !prev.has(f)))
  const resolved = previous.filter(f => !cur.has(f)).length
  return { newSet, resolved }
}
