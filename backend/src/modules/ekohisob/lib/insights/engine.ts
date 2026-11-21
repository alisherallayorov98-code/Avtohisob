// EkoHisob robot dvigateli: qoidalarni ishga tushiradi, fingerprint beradi, ko'rinishni
// rol bo'yicha cheklaydi, shovqinni yig'adi va tartiblaydi. PURE — Prisma'siz, testlanadi.
import type { Rule, Finding, FindingOut, Snapshot, Severity, Category, Confidence, RuleAccuracy } from './types'
import { buildCtx, table } from './ctx'
import { moneyRules } from './rules/money'
import { collectionRules } from './rules/collection'
import { dataRules, systemRules } from './rules/data'
import { staffRules } from './rules/staff'

export const RULES: Rule[] = [...moneyRules, ...collectionRules, ...dataRules, ...systemRules, ...staffRules]
  .sort((a, b) => a.no - b.no)

export const RULE_BY_KEY = new Map(RULES.map(r => [r.key, r]))

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
const CONF_RANK: Record<Confidence, number> = { fact: 0, strong: 1, guess: 2 }

export const CATEGORY_LABEL: Record<Category, string> = {
  money: 'Pul nazorati', collection: 'Qarz undirish', data: "Ma'lumot", system: 'Tizim', staff: 'Xodimlar',
}

export function fingerprintOf(f: Pick<Finding, 'ruleKey' | 'entityId' | 'subjectKey'>): string {
  return `${f.ruleKey}|${f.entityId || ''}|${f.subjectKey || ''}`
}

/** Butun qoidani yashirish uchun maxsus fingerprint */
export const ruleFingerprint = (ruleKey: string) => `rule:${ruleKey}`

/** Rol bo'yicha qaysi mavzular ko'rinadi */
export function visibleCategories(role: string): Category[] {
  if (role === 'admin') return ['money', 'collection', 'data', 'system', 'staff']
  if (role === 'supervisor') return ['money', 'collection', 'data']
  return ['collection', 'data'] // inspector
}

export function priorityOf(f: Pick<FindingOut, 'severity' | 'confidence' | 'impactUzs'>): number {
  const sev = (2 - SEVERITY_RANK[f.severity]) * 1_000_000
  const conf = (2 - CONF_RANK[f.confidence || 'fact']) * 100_000
  const money = Math.min(99_999, Math.round(Math.log10(1 + (f.impactUzs || 0)) * 10_000))
  return sev + conf + money
}

export interface RunResult {
  findings: FindingOut[]
  ruleErrors: Array<{ ruleKey: string; error: string }>
}

/** Barcha qoidalar — yig'ilmagan (collapse'siz) holda. Triage shu ro'yxat bilan ishlaydi. */
export function runRules(s: Snapshot, rules: Rule[] = RULES): RunResult {
  const c = buildCtx(s)
  const out: FindingOut[] = []
  const ruleErrors: RunResult['ruleErrors'] = []
  for (const rule of rules) {
    let found: Finding[]
    try {
      found = rule.run(c)
    } catch (e: any) {
      ruleErrors.push({ ruleKey: rule.key, error: e?.message || String(e) })
      continue
    }
    for (const f of found) {
      const e = f.entityId ? c.entity.get(f.entityId) : undefined
      const confidence = f.confidence ?? rule.confidence
      const fo: FindingOut = {
        ...f,
        confidence,
        basis: f.basis ?? (confidence === 'fact' ? "Ma'lumotning o'zi shunday — taxmin emas." : undefined),
        fingerprint: fingerprintOf(f),
        entityName: e?.name ?? null,
        districtId: e?.districtId ?? null,
        districtName: e?.districtName ?? null,
        tier: rule.tier,
        priority: 0,
      }
      fo.priority = priorityOf(fo)
      out.push(fo)
    }
  }
  return { findings: sortFindings(out), ruleErrors }
}

export function sortFindings<T extends Pick<FindingOut, 'priority' | 'title'>>(xs: T[]): T[] {
  return [...xs].sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
}

/** Yig'ish chegarasi: shuncha tashkilotda chiqsa — bitta umumiy savol */
export const COLLAPSE_MIN = 25

/**
 * Ko'rsatish uchun: collapse'li qoida ko'p tashkilotda chiqsa — bitta tizimli savol.
 * Topshiriq (task) yoki hukmi bor savollar yig'ilmaydi — ular alohida kuzatiladi.
 */
export function collapseFindings(xs: FindingOut[], min = COLLAPSE_MIN): FindingOut[] {
  const byRule = new Map<string, FindingOut[]>()
  for (const f of xs) {
    const l = byRule.get(f.ruleKey)
    if (l) l.push(f)
    else byRule.set(f.ruleKey, [f])
  }
  const out: FindingOut[] = []
  for (const [key, list] of byRule) {
    const rule = RULE_BY_KEY.get(key)
    const pool = list.filter(f => f.entityId && !f.task && !f.verdict)
    if (!rule?.collapse || pool.length < min) { out.push(...list); continue }
    const keep = list.filter(f => !pool.includes(f))
    const impact = pool.reduce((s, f) => s + (f.impactUzs || 0), 0)
    const top = sortFindings(pool)
    const merged: FindingOut = {
      ruleKey: key, category: rule.category,
      severity: rule.collapse.severity || 'warning',
      entityId: null, subjectKey: 'collapsed',
      title: rule.collapse.title(pool.length),
      detail: `Bu bitta-ikkita tashkilot emas, tizimli muammo. Masalan: ${top.slice(0, 5).map(f => f.entityName).join(', ')}` +
        `${pool.length > 5 ? ` va yana ${pool.length - 5} ta` : ''}.`,
      action: rule.collapse.action,
      impactUzs: impact || undefined,
      evidence: table(['Tashkilot', 'Tuman', 'Savol'], top.slice(0, 200).map(f => [f.entityName, f.districtName, f.title]),
        pool.length > 200 ? `Birinchi 200 tasi, jami ${pool.length} ta.` : `Jami ${pool.length} ta.`,
        top.slice(0, 200).map(f => f.entityId)),
      confidence: pool[0].confidence, basis: pool[0].basis,
      fingerprint: `${key}||collapsed`,
      entityName: null, districtId: null, districtName: null,
      tier: rule.tier, priority: 0,
    }
    merged.priority = priorityOf(merged)
    out.push(merged, ...keep)
  }
  return sortFindings(out)
}

// ─── Aniqlik (admin hukmlaridan) ─────────────────────────────────────────────

export const MIN_JUDGED = 3

export function accuracyOf(confirmed: number, wrong: number, normal: number): RuleAccuracy {
  const judged = confirmed + wrong
  const pct = judged >= MIN_JUDGED ? Math.round((confirmed / judged) * 100) : null
  return { confirmed, wrong, normal, pct, low: wrong >= MIN_JUDGED && confirmed / judged < 0.5 }
}

/** Aniqligi past qoida o'chirilmaydi: "Taxmin"ga tushadi va ro'yxat oxiriga suriladi */
export function applyAccuracy(xs: FindingOut[], stats: Map<string, RuleAccuracy>): FindingOut[] {
  return xs.map(f => {
    const a = stats.get(f.ruleKey)
    if (!a) return f
    if (!a.low) return { ...f, ruleAccuracy: a }
    const g: FindingOut = {
      ...f, ruleAccuracy: a, lowAccuracy: true, confidence: 'guess',
      basis: `Bu turdagi savollar ko'pincha noto'g'ri chiqqan (${a.confirmed} to'g'ri, ${a.wrong} noto'g'ri) — "Taxmin"ga tushirildi. ${f.basis || ''}`.trim(),
    }
    g.priority = priorityOf(g) - 100
    return g
  })
}

// ─── Yashirish ───────────────────────────────────────────────────────────────

export interface DismissalLite { fingerprint: string; until: Date | null }

export function isDismissed(f: Pick<FindingOut, 'fingerprint' | 'ruleKey'>, ds: DismissalLite[], now: Date): boolean {
  return ds.some(d => (!d.until || d.until > now) && (d.fingerprint === f.fingerprint || d.fingerprint === ruleFingerprint(f.ruleKey)))
}
