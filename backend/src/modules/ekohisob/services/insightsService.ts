// EkoHisob robot yordamchi — xizmat qatlami: savollarni hisoblash, yashirish, hukmlar,
// inspektor topshiriqlari (avtomatik yuborish + savol yo'qolganda tekshirish).
import { prisma } from '../../../lib/prisma'
import { sendEkoMessage } from '../../../services/ekoFieldBot'
import { ScopeUser, isEkoAdmin, canAccessDistrict } from '../lib/ekoScope'
import { loadInsightsSnapshot } from './insightsLoader'
import {
  runRules, collapseFindings, applyAccuracy, accuracyOf, isDismissed, visibleCategories,
  ruleFingerprint, RULE_BY_KEY, RULES, CATEGORY_LABEL, type DismissalLite,
} from '../lib/insights/engine'
import { planAutoTasks, verifyDisappeared, TASK_DUE_DAYS, type InspectorLite } from '../lib/insights/triage'
import type { FindingOut, RuleAccuracy, TaskInfo, TaskStatus } from '../lib/insights/types'
import { uzDate } from '../lib/dateFormat'
import { isInSendWindow } from '../lib/smsBudget'
import { uztParts } from '../lib/uzt'

const p = prisma as any
const DAY = 86_400_000
export const ACTIVE_TASK = ['open', 'answered'] as const

// ── Kesh: bir foydalanuvchi uchun 60 s (sahifa qayta ochilganda bazani qayta yuklamaslik) ──
const cache = new Map<string, { at: number; data: InsightsResult }>()
const CACHE_MS = 60_000
export function invalidateInsights(orgId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${orgId}|`)) cache.delete(k)
}

export interface InsightsUser extends ScopeUser { id: string }

export interface InsightsResult {
  generatedAt: string
  role: string
  findings: FindingOut[]
  counts: { total: number; critical: number; warning: number; info: number; byCategory: Record<string, number> }
  hidden: number
  ruleErrors: Array<{ ruleKey: string; error: string }>
}

function toTaskInfo(t: any, names: Map<string, string>, now: Date): TaskInfo {
  return {
    id: t.id, status: t.status, assigneeId: t.assigneeId, assigneeName: names.get(t.assigneeId) ?? null,
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
    overdue: t.status === 'open' && !!t.dueDate && new Date(t.dueDate) < now,
    answer: t.answer ?? null, autoSent: !!t.autoSent, verifyNote: t.verifyNote ?? null,
  }
}

async function userNames(orgId: string): Promise<Map<string, string>> {
  const us = await p.ekoHisobUser.findMany({ where: { orgId }, select: { id: true, fullName: true } })
  return new Map(us.map((u: any) => [u.id, u.fullName]))
}

async function ruleAccuracyMap(orgId: string): Promise<Map<string, RuleAccuracy>> {
  const rows = await p.ekoHisobInsightVerdict.groupBy({ by: ['ruleKey', 'verdict'], where: { orgId }, _count: { _all: true } })
  const acc = new Map<string, { c: number; w: number; n: number }>()
  for (const r of rows) {
    const a = acc.get(r.ruleKey) ?? { c: 0, w: 0, n: 0 }
    if (r.verdict === 'confirmed') a.c += r._count._all
    else if (r.verdict === 'wrong') a.w += r._count._all
    else a.n += r._count._all
    acc.set(r.ruleKey, a)
  }
  return new Map([...acc].map(([k, a]) => [k, accuracyOf(a.c, a.w, a.n)]))
}

async function activeDismissals(orgId: string, now: Date): Promise<DismissalLite[]> {
  const ds = await p.ekoHisobInsightDismissal.findMany({
    where: { orgId, OR: [{ until: null }, { until: { gt: now } }] },
    select: { fingerprint: true, until: true },
  })
  return ds
}

/** Savollar ro'yxati — foydalanuvchi ko'zi bilan (tuman doirasi, rol bo'yicha mavzular). */
export async function computeInsights(user: InsightsUser, opts: { fresh?: boolean } = {}): Promise<InsightsResult> {
  const key = `${user.orgId}|${user.id}|${user.role}`
  const hit = cache.get(key)
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data

  const now = new Date()
  const snap = await loadInsightsSnapshot(user, now)
  const { findings: raw, ruleErrors } = runRules(snap)

  const [dismissals, stats, verdicts, tasks, names] = await Promise.all([
    activeDismissals(user.orgId, now),
    ruleAccuracyMap(user.orgId),
    p.ekoHisobInsightVerdict.findMany({
      where: { orgId: user.orgId, verdict: 'confirmed' }, orderBy: { createdAt: 'desc' },
      select: { fingerprint: true, createdAt: true, createdByName: true, reason: true, resolution: true },
    }),
    p.ekoHisobInsightTask.findMany({
      where: { orgId: user.orgId, status: { in: [...ACTIVE_TASK] } },
      orderBy: { createdAt: 'desc' },
    }),
    userNames(user.orgId),
  ])

  // Butun korxona ko'zi bilan hisoblanganda — yo'qolgan savollar topshiriqlarini tekshiramiz
  if (snap.fullScope) {
    await syncTasks(user.orgId, raw, dismissals, now).catch(e => console.error('[EkoInsights] sync:', e?.message ?? e))
  }

  const cats = new Set(visibleCategories(user.role))
  const verdictBy = new Map<string, any>()
  for (const v of verdicts) if (!verdictBy.has(v.fingerprint)) verdictBy.set(v.fingerprint, v)
  const taskBy = new Map<string, any>()
  for (const t of tasks) if (!taskBy.has(t.fingerprint)) taskBy.set(t.fingerprint, t)

  let hidden = 0
  const visible: FindingOut[] = []
  for (const f of raw) {
    if (!cats.has(f.category)) continue
    if (isDismissed(f, dismissals, now)) { hidden++; continue }
    const out: FindingOut = { ...f }
    const v = verdictBy.get(f.fingerprint)
    if (v) out.verdict = { verdict: 'confirmed', at: v.createdAt.toISOString(), by: v.createdByName, reason: v.reason, resolution: v.resolution ?? null }
    const t = taskBy.get(f.fingerprint)
    // Inspektor faqat o'ziga berilgan topshiriqni ko'radi
    if (t && (user.role !== 'inspector' || t.assigneeId === user.id)) out.task = toTaskInfo(t, names, now)
    visible.push(out)
  }

  const findings = collapseFindings(applyAccuracy(visible, stats))
  const counts = { total: findings.length, critical: 0, warning: 0, info: 0, byCategory: {} as Record<string, number> }
  for (const f of findings) {
    counts[f.severity]++
    counts.byCategory[f.category] = (counts.byCategory[f.category] ?? 0) + 1
  }
  const data: InsightsResult = { generatedAt: now.toISOString(), role: user.role, findings, counts, hidden, ruleErrors }
  cache.set(key, { at: Date.now(), data })
  if (cache.size > 500) cache.delete(cache.keys().next().value as string)
  return data
}

/** Bitta savolni joriy holatdan topish (yashirish/hukm/topshiriq uchun — mijoz yuborgan matnga ishonmaymiz). */
export async function findCurrent(user: InsightsUser, fingerprint: string): Promise<FindingOut | null> {
  const res = await computeInsights(user)
  const f = res.findings.find(x => x.fingerprint === fingerprint)
  if (f) return f
  // Yashirilgan yoki yig'ilgan bo'lishi mumkin — xom ro'yxatdan qidiramiz
  const snap = await loadInsightsSnapshot(user)
  const raw = runRules(snap).findings.filter(x => visibleCategories(user.role).includes(x.category))
  return raw.find(x => x.fingerprint === fingerprint) ?? null
}

// ── Topshiriqlarni tekshirish (savol yo'qoldimi — nega?) ─────────────────────

export async function syncTasks(orgId: string, raw: FindingOut[], dismissals: DismissalLite[], now: Date): Promise<number> {
  const open = await p.ekoHisobInsightTask.findMany({ where: { orgId, status: { in: [...ACTIVE_TASK] } } })
  if (open.length === 0) return 0
  const present = new Set(raw.map(f => f.fingerprint))
  const gone = open.filter((t: any) => !present.has(t.fingerprint))
  let changed = 0
  for (const t of gone) {
    let status: TaskStatus, note: string
    if (isDismissed({ fingerprint: t.fingerprint, ruleKey: t.ruleKey }, dismissals, now)) {
      status = 'closed'; note = 'Admin savolni yashirdi.'
    } else {
      const facts = await verifyFacts(orgId, t.entityId, t.createdAt)
      const r = verifyDisappeared(t.ruleKey, facts)
      status = r.status; note = r.note
    }
    await p.ekoHisobInsightTask.update({
      where: { id: t.id },
      data: { status, verifiedAt: now, verifyNote: note, ...(status === 'closed' ? { closedAt: now } : {}) },
    })
    changed++
  }
  return changed
}

async function verifyFacts(orgId: string, entityId: string | null, since: Date) {
  if (!entityId) return { entityStatus: 'active', paymentAfter: false, visitAfter: false, smsAfter: false, newPromise: null }
  const [e, pay, visit, sms, promise] = await Promise.all([
    p.ekoHisobLegalEntity.findFirst({ where: { id: entityId, orgId }, select: { status: true } }),
    p.ekoHisobPayment.findFirst({ where: { entityId, paidAt: { gte: since } }, select: { id: true } }),
    p.ekoHisobVisit.findFirst({ where: { orgId, entityId, createdAt: { gte: since } }, select: { id: true } }),
    p.ekoHisobSmsLog.findFirst({ where: { orgId, entityId, status: 'sent', createdAt: { gte: since } }, select: { id: true } }),
    p.ekoHisobVisit.findFirst({ where: { orgId, entityId, kind: 'promised', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, select: { promisedDate: true } }),
  ])
  return {
    entityStatus: e?.status ?? null,
    paymentAfter: !!pay, visitAfter: !!visit, smsAfter: !!sms,
    newPromise: promise?.promisedDate ? new Date(promise.promisedDate).toISOString().slice(0, 10) : null,
  }
}

// ── Avtomatik yuborish (robot → tuman inspektori) ───────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function robotUrl(): string | null {
  const front = process.env.FRONTEND_URL?.trim().replace(/\/+$/, '')
  return front ? `${front}/ekohisob/robot` : null
}

async function notifyAssignee(assigneeId: string, titles: string[], due: Date | null): Promise<boolean> {
  const link = await p.ekoHisobBotLink.findUnique({ where: { userId: assigneeId }, select: { chatId: true } })
  if (!link?.chatId) return false
  const url = robotUrl()
  const lines = [
    `🤖 <b>Robot yordamchi</b>: sizga ${titles.length} ta yangi savol${due ? ` (javob muddati ${uzDate(due)})` : ''}`,
    '',
    ...titles.slice(0, 10).map((t, i) => `${i + 1}. ${esc(t)}`),
    ...(titles.length > 10 ? [`… va yana ${titles.length - 10} ta`] : []),
    '',
    url ? `Javob berish: <a href="${url}">Robot sahifasi</a>` : "Javob berish: EkoHisob → Robot bo'limi",
  ]
  return sendEkoMessage(link.chatId, lines.join('\n'))
}

export interface TriageResult { created: number; verified: number; notified: number; skippedNoInspector: number }

/** Bitta korxona: tekshirish + yangi savollarni tuman inspektorlariga taqsimlash + Telegram. */
export async function runAutoTriage(orgId: string, opts: { notify?: boolean; now?: Date } = {}): Promise<TriageResult> {
  const now = opts.now ?? new Date()
  const admin: ScopeUser = { role: 'admin', orgId, districtIds: [] }
  const snap = await loadInsightsSnapshot(admin, now)
  const { findings: raw } = runRules(snap)
  const dismissals = await activeDismissals(orgId, now)
  const verified = await syncTasks(orgId, raw, dismissals, now)

  const candidates = raw.filter(f => !isDismissed(f, dismissals, now))
  const existing = await p.ekoHisobInsightTask.findMany({
    where: { orgId, OR: [{ status: { in: [...ACTIVE_TASK] } }, { createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }] },
    select: { fingerprint: true, assigneeId: true, status: true },
  })
  // Yaqinda (7 kun) yopilgan savol qayta-qayta yuborilmasin
  const existingFps = new Set<string>(existing.map((t: any) => t.fingerprint))
  const openBy = new Map<string, number>()
  for (const t of existing) if ((ACTIVE_TASK as readonly string[]).includes(t.status)) openBy.set(t.assigneeId, (openBy.get(t.assigneeId) ?? 0) + 1)

  const inspectors: InspectorLite[] = snap.users
    .filter(u => u.isActive && u.role === 'inspector' && u.districtIds.length > 0)
    .map(u => ({ id: u.id, districtIds: u.districtIds, openTasks: openBy.get(u.id) ?? 0, botLinked: u.botLinked }))

  const plan = planAutoTasks(candidates, existingFps, inspectors)
  const autoCount = candidates.filter(f => f.tier === 'auto' && f.entityId && !existingFps.has(f.fingerprint)).length
  const due = new Date(now.getTime() + TASK_DUE_DAYS * DAY)

  const byAssignee = new Map<string, string[]>()
  for (const { finding: f, assigneeId } of plan) {
    await p.ekoHisobInsightTask.create({
      data: {
        orgId, fingerprint: f.fingerprint, ruleKey: f.ruleKey, entityId: f.entityId, districtId: f.districtId,
        title: f.title, detail: f.detail, evidence: f.evidence ?? undefined,
        assigneeId, assignedBy: null, autoSent: true, status: 'open', dueDate: due,
      },
    })
    const l = byAssignee.get(assigneeId) ?? []
    l.push(f.title)
    byAssignee.set(assigneeId, l)
  }

  let notified = 0
  if (opts.notify !== false) {
    for (const [assigneeId, titles] of byAssignee) {
      if (await notifyAssignee(assigneeId, titles, due).catch(() => false)) {
        notified++
        await p.ekoHisobInsightTask.updateMany({ where: { orgId, assigneeId, notifiedAt: null, status: 'open' }, data: { notifiedAt: now } })
      }
    }
  }
  invalidateInsights(orgId)
  return { created: plan.length, verified, notified, skippedNoInspector: Math.max(0, autoCount - plan.length) }
}

/** Scheduler: inspektori bor barcha korxonalar. Bitta korxona xatosi boshqalarni to'xtatmaydi. */
export async function runAutoTriageAllOrgs(now: Date = new Date()): Promise<void> {
  if (!isInSendWindow(uztParts(now)!.hour)) {
    console.log('[EkoInsights] yuborish oynasidan (10–18 UZT) tashqari, o\'tkazildi')
    return
  }
  const orgs = await p.ekoHisobUser.findMany({
    where: { role: 'inspector', isActive: true }, select: { orgId: true }, distinct: ['orgId'],
  }).catch(() => [] as any[])
  for (const o of orgs) {
    try {
      const r = await runAutoTriage(o.orgId, { now })
      if (r.created || r.verified) console.log(`[EkoInsights] ${o.orgId}: +${r.created} topshiriq, ${r.verified} tekshirildi, ${r.notified} xabar`)
    } catch (e: any) {
      console.error(`[EkoInsights] ${o.orgId} triage xatosi:`, e?.message ?? e)
    }
  }
}

// ── Qo'lda topshiriq ─────────────────────────────────────────────────────────

export async function assignTask(
  user: InsightsUser, finding: FindingOut, assigneeId: string, note: string | null,
): Promise<{ ok: true; task: any; notified: boolean } | { ok: false; error: string }> {
  const a = await p.ekoHisobUser.findFirst({
    where: { id: assigneeId, orgId: user.orgId, isActive: true, isMirror: false },
    select: { id: true, role: true, districts: { select: { districtId: true } } },
  })
  if (!a) return { ok: false, error: 'Xodim topilmadi' }
  if (a.role === 'admin') return { ok: false, error: 'Topshiriq inspektor yoki boshliqqa beriladi' }
  if (finding.districtId) {
    const scope: ScopeUser = { role: a.role, orgId: user.orgId, districtIds: a.districts.map((d: any) => d.districtId) }
    if (!canAccessDistrict(scope, finding.districtId)) return { ok: false, error: 'Bu xodimga tashkilot tumani biriktirilmagan' }
  }
  const dup = await p.ekoHisobInsightTask.findFirst({ where: { orgId: user.orgId, fingerprint: finding.fingerprint, status: { in: [...ACTIVE_TASK] } } })
  if (dup) return { ok: false, error: 'Bu savol bo\'yicha ochiq topshiriq allaqachon bor' }
  const due = new Date(Date.now() + TASK_DUE_DAYS * DAY)
  const task = await p.ekoHisobInsightTask.create({
    data: {
      orgId: user.orgId, fingerprint: finding.fingerprint, ruleKey: finding.ruleKey,
      entityId: finding.entityId, districtId: finding.districtId,
      title: finding.title, detail: note ? `${finding.detail}\n\nAdmin izohi: ${note}` : finding.detail,
      evidence: finding.evidence ?? undefined, assigneeId, assignedBy: user.id, autoSent: false, status: 'open', dueDate: due,
    },
  })
  const notified = await notifyAssignee(assigneeId, [finding.title], due).catch(() => false)
  if (notified) await p.ekoHisobInsightTask.update({ where: { id: task.id }, data: { notifiedAt: new Date() } })
  invalidateInsights(user.orgId)
  return { ok: true, task, notified }
}

/** Topshiriqlar ro'yxati: admin — hammasi, boshliq — o'z tumanlari, inspektor — faqat o'ziniki. */
export async function listTasks(user: InsightsUser, status?: string): Promise<any[]> {
  const where: any = { orgId: user.orgId }
  if (status === 'active') where.status = { in: [...ACTIVE_TASK] }
  else if (status === 'done') where.status = { in: ['resolved', 'closed'] }
  else if (status && ['open', 'answered', 'resolved', 'suspicious', 'closed'].includes(status)) where.status = status
  if (user.role === 'inspector') where.assigneeId = user.id
  else if (!isEkoAdmin(user)) where.districtId = { in: user.districtIds.length ? user.districtIds : ['__none__'] }
  const [rows, names] = await Promise.all([
    p.ekoHisobInsightTask.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 300 }),
    userNames(user.orgId),
  ])
  const entIds = [...new Set<string>(rows.map((r: any) => r.entityId).filter(Boolean))]
  const ents = entIds.length
    ? await p.ekoHisobLegalEntity.findMany({ where: { orgId: user.orgId, id: { in: entIds } }, select: { id: true, name: true, district: { select: { name: true } } } })
    : []
  const entBy = new Map<string, any>(ents.map((e: any) => [e.id, e]))
  const now = new Date()
  return rows.map((r: any) => ({
    id: r.id, fingerprint: r.fingerprint, ruleKey: r.ruleKey, ruleName: RULE_BY_KEY.get(r.ruleKey)?.name ?? r.ruleKey,
    category: RULE_BY_KEY.get(r.ruleKey)?.category ?? null,
    entityId: r.entityId, entityName: entBy.get(r.entityId)?.name ?? null, districtName: entBy.get(r.entityId)?.district?.name ?? null,
    title: r.title, detail: r.detail, evidence: r.evidence ?? null,
    assigneeId: r.assigneeId, assigneeName: names.get(r.assigneeId) ?? null,
    assignedByName: r.assignedBy ? names.get(r.assignedBy) ?? null : 'Robot',
    autoSent: r.autoSent, status: r.status,
    dueDate: r.dueDate, overdue: r.status === 'open' && !!r.dueDate && new Date(r.dueDate) < now,
    answer: r.answer, answeredAt: r.answeredAt, verifiedAt: r.verifiedAt, verifyNote: r.verifyNote,
    closedAt: r.closedAt, closedByName: r.closedBy ? names.get(r.closedBy) ?? null : null,
    notifiedAt: r.notifiedAt, createdAt: r.createdAt,
  }))
}

/** Qoidalar katalogi + aniqlik (Hukmlar oynasi uchun) */
export async function rulesWithAccuracy(orgId: string) {
  const stats = await ruleAccuracyMap(orgId)
  return RULES.map(r => ({
    key: r.key, no: r.no, name: r.name, category: r.category, categoryLabel: CATEGORY_LABEL[r.category],
    confidence: r.confidence, tier: r.tier, accuracy: stats.get(r.key) ?? null,
  }))
}

export { ruleFingerprint }
