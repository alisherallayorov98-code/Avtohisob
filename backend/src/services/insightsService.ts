// Tahlil orkestratsiyasi: loader → pure dvigatel → yashirishlar → topshiriqlar → kunlik holat (trend).
import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { getOrgFilter, applyNarrowedBranchFilter } from '../lib/orgFilter'
import { AppError } from '../middleware/errorHandler'
import { loadInsightSnapshot } from './insightsLoader'
import {
  RULES, runRules, applyDismissals, summarize, scoreVehicles, diffFingerprints, ruleFingerprint, computePriority,
} from '../lib/insights/engine'
import type { FindingOut, Snapshot, AssignmentInfo } from '../lib/insights/types'
import { buildCtx, uzDay } from '../lib/insights/context'
import { answerQuestion, EXAMPLES } from '../lib/insights/ask'
import { buildDossier } from '../lib/insights/dossier'
import { THRESHOLD_META, DEFAULT_THRESHOLDS, mergeThresholds, diffFromDefaults } from '../lib/insights/thresholds'

interface AuthUserLike { id: string; role: string; branchId?: string | null }

const CACHE_TTL_MS = 3 * 60 * 1000
const CACHE_MAX = 50
interface CacheEntry { at: number; findings: FindingOut[]; ruleErrors: number; snap: Snapshot }
const cache = new Map<string, CacheEntry>()

export interface InsightScope { orgId: string; branchIds: string[]; narrowed: boolean }

/** Foydalanuvchi tashkiloti va ko'radigan filiallari. Faqat org darajasida ishlaydi (super_admin ham o'z orgida). */
export async function resolveInsightScope(user: AuthUserLike, requestedBranchId?: string): Promise<InsightScope> {
  if (!user.branchId) throw new AppError("Tahlil uchun foydalanuvchi tashkilotga biriktirilgan bo'lishi kerak", 400)
  const db = prisma as any
  const own = await db.branch.findUnique({ where: { id: user.branchId }, select: { organizationId: true } })
  const orgId: string = own?.organizationId ?? user.branchId

  let orgBranchIds: string[]
  if (user.role === 'super_admin') {
    // getOrgFilter super_admin'ga hamma narsani beradi — tahlil esa faqat bitta tashkilot doirasida
    const rows = await db.branch.findMany({ where: { organizationId: orgId }, select: { id: true } })
    orgBranchIds = rows.map((b: any) => b.id)
    if (!orgBranchIds.includes(user.branchId)) orgBranchIds.push(user.branchId)
  } else {
    const filter = await getOrgFilter(user)
    if (filter.type !== 'org') throw new AppError("Ruxsat yo'q", 403)
    orgBranchIds = filter.orgBranchIds
  }
  const narrowed = applyNarrowedBranchFilter({ type: 'org', orgBranchIds }, requestedBranchId)
  const branchIds = typeof narrowed === 'string' ? [narrowed] : (narrowed?.in ?? orgBranchIds)
  return { orgId, branchIds, narrowed: typeof narrowed === 'string' }
}

const cacheKey = (s: InsightScope) => `${s.orgId}|${[...s.branchIds].sort().join(',')}`

function invalidateOrg(orgId: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${orgId}|`)) cache.delete(k)
}

async function computeFindings(scope: InsightScope, force = false): Promise<CacheEntry & { cached: boolean }> {
  const key = cacheKey(scope)
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit, cached: true }
  const snap = await loadInsightSnapshot(scope.orgId, scope.branchIds)
  const res = runRules(snap)
  if (res.ruleErrors.length) console.error('[Insights] qoida xatolari:', res.ruleErrors)
  const entry: CacheEntry = { at: Date.now(), findings: res.findings, ruleErrors: res.ruleErrors.length, snap }
  cache.set(key, entry)
  while (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (!oldest) break
    cache.delete(oldest[0])
  }
  return { ...entry, cached: false }
}

async function activeDismissals(orgId: string) {
  return (prisma as any).insightDismissal.findMany({
    where: { orgId, OR: [{ until: null }, { until: { gt: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  })
}

function todayDate(): Date {
  return new Date(`${uzDay(new Date())}T00:00:00.000Z`)
}

async function saveSnapshot(orgId: string, visible: FindingOut[]) {
  const s = summarize(visible)
  const date = todayDate()
  const data = { total: s.total, critical: s.critical, warning: s.warning, info: s.info, fingerprints: visible.map(f => f.fingerprint) }
  await (prisma as any).insightSnapshot.upsert({ where: { orgId_date: { orgId, date } }, create: { orgId, date, ...data }, update: data })
}

/** Ochiq topshiriqlar; savol yo'qolgan bo'lsa (ma'lumot kiritildi) — avtomatik "done" */
async function loadAssignments(scope: InsightScope, allFingerprints: Set<string>): Promise<Map<string, AssignmentInfo>> {
  const db = prisma as any
  const rows = await db.insightAssignment.findMany({ where: { orgId: scope.orgId, status: 'open' } })
  const resolved = rows.filter((r: any) => !allFingerprints.has(r.fingerprint))
  // Filial tanlanganda boshqa filial savollari ro'yxatda yo'q — shuning uchun faqat to'liq ko'rinishda yopamiz
  if (!scope.narrowed && resolved.length) {
    await db.insightAssignment.updateMany({
      where: { id: { in: resolved.map((r: any) => r.id) }, orgId: scope.orgId },
      data: { status: 'done', resolvedAt: new Date() },
    })
  }
  const live = rows.filter((r: any) => allFingerprints.has(r.fingerprint))
  const userIds = [...new Set(live.map((r: any) => r.assigneeId))] as string[]
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : []
  const nameOf = new Map(users.map((u: any) => [u.id, u.fullName]))
  const now = Date.now()
  return new Map(live.map((r: any) => [r.fingerprint, {
    id: r.id, assigneeId: r.assigneeId, assigneeName: (nameOf.get(r.assigneeId) as string) || null,
    dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
    overdue: !!r.dueDate && new Date(r.dueDate).getTime() < now,
    note: r.note,
  }]))
}

/** Ko'rinadigan savollar: yashirilganlarsiz, topshiriq va ustuvorlik bilan */
async function visibleFindings(scope: InsightScope, force = false) {
  const entry = await computeFindings(scope, force)
  const dismissals = await activeDismissals(scope.orgId)
  const { visible, hidden } = applyDismissals(entry.findings, dismissals, new Date())
  const assignments = await loadAssignments(scope, new Set(entry.findings.map(f => f.fingerprint)))
  const withAssign = visible.map(f => (assignments.has(f.fingerprint) ? { ...f, assignment: assignments.get(f.fingerprint) } : f))
  return { entry, visible: withAssign, hidden }
}

export async function getInsights(user: AuthUserLike, opts: { branchId?: string; refresh?: boolean }) {
  const scope = await resolveInsightScope(user, opts.branchId)
  const { entry, visible, hidden } = await visibleFindings(scope, !!opts.refresh)

  // Trend — faqat butun tashkilot ko'rinishida (filial tanlanganda solishtirish noto'g'ri bo'ladi)
  let trend: { previousTotal: number | null; newCount: number; resolvedCount: number; series: Array<{ date: string; total: number; critical: number }> } | null = null
  let withNew: FindingOut[] = visible
  if (!scope.narrowed) {
    await saveSnapshot(scope.orgId, visible).catch(e => console.error('[Insights] snapshot xato:', e?.message))
    const db = prisma as any
    const [prev, series] = await Promise.all([
      db.insightSnapshot.findFirst({ where: { orgId: scope.orgId, date: { lt: todayDate() } }, orderBy: { date: 'desc' } }),
      db.insightSnapshot.findMany({ where: { orgId: scope.orgId }, orderBy: { date: 'desc' }, take: 14, select: { date: true, total: true, critical: true } }),
    ])
    const prevFps: string[] | null = prev && Array.isArray(prev.fingerprints) ? prev.fingerprints : null
    const { newSet, resolved } = diffFingerprints(visible.map(f => f.fingerprint), prevFps)
    withNew = visible.map(f => (newSet.has(f.fingerprint) ? { ...f, isNew: true } : f))
    trend = {
      previousTotal: prev ? prev.total : null,
      newCount: newSet.size,
      resolvedCount: resolved,
      series: series.reverse().map((s: any) => ({ date: new Date(s.date).toISOString().slice(0, 10), total: s.total, critical: s.critical })),
    }
  }

  const prioritized = withNew.map(f => ({ ...f, priority: computePriority(f) }))
  const top = [...prioritized].sort((a, b) => b.priority - a.priority).slice(0, 10).map(f => f.fingerprint)
  const branchRows = await (prisma as any).branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true } })
  const examplePlate = entry.snap.vehicles.find(v => v.status === 'active')?.plate || '30 574 OBA'

  return {
    generatedAt: new Date(entry.at).toISOString(),
    cached: entry.cached,
    ruleCount: RULES.length,
    ruleErrors: entry.ruleErrors,
    summary: summarize(prioritized),
    hiddenCount: hidden,
    assignedCount: prioritized.filter(f => f.assignment).length,
    trend,
    findings: prioritized,
    top,
    vehicles: scoreVehicles(prioritized),
    branches: branchRows,
    rules: RULES.map(r => ({ no: r.no, key: r.key, category: r.category, name: r.name })),
    examples: EXAMPLES.map(e => ({ group: e.group, q: e.q.replace('{plate}', examplePlate) })),
  }
}

export async function askInsights(user: AuthUserLike, body: any) {
  const q = String(body?.q || '').trim().slice(0, 300)
  if (!q) throw new AppError('Savolni yozing', 400)
  const scope = await resolveInsightScope(user, body?.branchId ? String(body.branchId) : undefined)
  const { entry, visible } = await visibleFindings(scope)
  const withPriority = visible.map(f => ({ ...f, priority: computePriority(f) }))
  return answerQuestion(q, buildCtx(entry.snap), withPriority)
}

export async function getVehicleDossier(user: AuthUserLike, vehicleId: string) {
  const scope = await resolveInsightScope(user)
  const v = await (prisma as any).vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
  if (!v || !scope.branchIds.includes(v.branchId)) throw new AppError('Mashina topilmadi', 404)
  const { entry, visible } = await visibleFindings(scope)
  const d = buildDossier(buildCtx(entry.snap), vehicleId, visible.map(f => ({ ...f, priority: computePriority(f) })))
  if (!d) throw new AppError('Mashina topilmadi', 404)
  return d
}

export async function dismissInsight(user: AuthUserLike, body: any) {
  const scope = await resolveInsightScope(user)
  const ruleKey = String(body?.ruleKey || '')
  if (!RULES.some(r => r.key === ruleKey)) throw new AppError("Noma'lum qoida", 400)
  const reason = String(body?.reason || '').trim()
  if (reason.length < 3) throw new AppError('Sababni yozing (kamida 3 harf)', 400)
  const days = Number(body?.days)
  if (![0, 30, 90].includes(days)) throw new AppError("Muddat noto'g'ri", 400)
  const scopeKind = body?.scope === 'rule' ? 'rule' : 'one'
  const fingerprint = scopeKind === 'rule' ? ruleFingerprint(ruleKey) : String(body?.fingerprint || '')
  const validOne = fingerprint.startsWith(`${ruleKey}|`) || fingerprint.startsWith('merge:')
  if (!fingerprint || fingerprint.length > 400 || (scopeKind === 'one' && !validOne)) {
    throw new AppError("Savol identifikatori noto'g'ri", 400)
  }
  const vehicleId = scopeKind === 'one' && body?.vehicleId ? String(body.vehicleId) : null
  if (vehicleId) {
    const v = await (prisma as any).vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
    if (!v || !scope.branchIds.includes(v.branchId)) throw new AppError("Ruxsat yo'q", 403)
  }
  return (prisma as any).insightDismissal.create({
    data: {
      orgId: scope.orgId, fingerprint, ruleKey, vehicleId,
      title: body?.title ? String(body.title).slice(0, 300) : null,
      reason: reason.slice(0, 500),
      until: days ? new Date(Date.now() + days * 86400000) : null,
      createdById: user.id,
    },
  })
}

export async function listDismissals(user: AuthUserLike) {
  const scope = await resolveInsightScope(user)
  const rows = await activeDismissals(scope.orgId)
  const userIds = [...new Set(rows.map((r: any) => r.createdById).filter(Boolean))] as string[]
  const users = userIds.length ? await (prisma as any).user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : []
  const nameOf = new Map(users.map((u: any) => [u.id, u.fullName]))
  return rows.map((r: any) => ({ ...r, createdByName: r.createdById ? nameOf.get(r.createdById) || null : null }))
}

export async function restoreDismissal(user: AuthUserLike, id: string) {
  const scope = await resolveInsightScope(user)
  // Faqat o'z tashkilotining yozuvi — aniq scope bilan o'chiriladi
  const res = await (prisma as any).insightDismissal.deleteMany({ where: { id, orgId: scope.orgId } })
  if (!res.count) throw new AppError('Topilmadi', 404)
  return { restored: true }
}

// ─── Topshiriqlar ────────────────────────────────────────────────────────────

export async function listAssignees(user: AuthUserLike) {
  const scope = await resolveInsightScope(user)
  return (prisma as any).user.findMany({
    where: { branchId: { in: scope.branchIds }, isActive: true, role: { in: ['admin', 'manager', 'branch_manager', 'operator'] } },
    select: { id: true, fullName: true, role: true, branch: { select: { name: true } } },
    orderBy: { fullName: 'asc' },
  })
}

export async function assignInsight(user: AuthUserLike, body: any) {
  const scope = await resolveInsightScope(user)
  const fingerprint = String(body?.fingerprint || '')
  const assigneeId = String(body?.assigneeId || '')
  if (!fingerprint || !assigneeId) throw new AppError("Savol va mas'ul tanlanishi shart", 400)
  const db = prisma as any
  const assignee = await db.user.findUnique({ where: { id: assigneeId }, select: { id: true, branchId: true, isActive: true } })
  if (!assignee || !assignee.isActive || !scope.branchIds.includes(assignee.branchId)) throw new AppError("Mas'ul shu tashkilotda emas", 403)
  // Savol hozir haqiqatan bor ekanini tekshiramiz (identifikatorni o'ylab topib bo'lmasin)
  const { findings } = await computeFindings(scope)
  const f = findings.find(x => x.fingerprint === fingerprint)
  if (!f) throw new AppError("Bu savol endi yo'q (ehtimol allaqachon hal qilingan)", 404)
  let dueDate: Date | null = null
  if (body?.dueDate) {
    dueDate = new Date(`${String(body.dueDate).slice(0, 10)}T18:59:59.000Z`) // UZT 23:59
    if (isNaN(dueDate.getTime())) throw new AppError("Muddat noto'g'ri", 400)
  }
  const note = body?.note ? String(body.note).trim().slice(0, 500) : null

  // Bitta savolga bitta ochiq topshiriq — qayta topshirilsa eskisi yopiladi
  await db.insightAssignment.updateMany({ where: { orgId: scope.orgId, fingerprint, status: 'open' }, data: { status: 'done', resolvedAt: new Date() } })
  const row = await db.insightAssignment.create({
    data: {
      orgId: scope.orgId, fingerprint, ruleKey: f.ruleKey, vehicleId: f.vehicleId, title: f.title.slice(0, 300),
      actionPath: f.action.path, assigneeId, assignedById: user.id, dueDate, note,
    },
  })
  await db.notification.create({
    data: {
      userId: assigneeId,
      title: 'Sizga topshiriq (Tahlil)',
      message: `${f.title}${dueDate ? ` — muddat: ${uzDay(dueDate).split('-').reverse().join('.')}` : ''}${note ? `. Izoh: ${note}` : ''}`.slice(0, 1000),
      type: 'warning',
      link: f.action.path,
    },
  }).catch((e: any) => console.error('[Insights] bildirishnoma xato:', e?.message))
  return row
}

export async function unassignInsight(user: AuthUserLike, id: string) {
  const scope = await resolveInsightScope(user)
  const res = await (prisma as any).insightAssignment.updateMany({ where: { id, orgId: scope.orgId, status: 'open' }, data: { status: 'done', resolvedAt: new Date() } })
  if (!res.count) throw new AppError('Topilmadi', 404)
  return { ok: true }
}

// ─── Sozlamalar ──────────────────────────────────────────────────────────────

export async function getInsightSettings(user: AuthUserLike) {
  const scope = await resolveInsightScope(user)
  const row = await (prisma as any).insightSettings.findUnique({ where: { orgId: scope.orgId } })
  return { values: mergeThresholds(row?.thresholds), defaults: DEFAULT_THRESHOLDS, meta: THRESHOLD_META }
}

export async function saveInsightSettings(user: AuthUserLike, body: any) {
  const scope = await resolveInsightScope(user)
  const merged = mergeThresholds(body?.values)
  const thresholds = diffFromDefaults(merged)
  await (prisma as any).insightSettings.upsert({
    where: { orgId: scope.orgId },
    create: { orgId: scope.orgId, thresholds, updatedById: user.id },
    update: { thresholds, updatedById: user.id },
  })
  invalidateOrg(scope.orgId)
  return { values: merged }
}

// ─── Excel ───────────────────────────────────────────────────────────────────

export async function buildInsightsWorkbook(user: AuthUserLike, branchId?: string): Promise<ExcelJS.Workbook> {
  const data = await getInsights(user, { branchId })
  const ruleNo = new Map(RULES.map(r => [r.key, r]))
  const SEV: Record<string, string> = { critical: 'Kritik', warning: 'Diqqat', info: "Ma'lumot" }
  const CAT: Record<string, string> = {
    engine: 'Dvigatel', service: 'Moy va xizmat', fuel: "Yoqilg'i", gps: 'GPS', documents: 'Hujjatlar', tires: 'Shinalar',
    repairs: "Ta'mir", warehouse: 'Ombor', waybills: "Yo'l varaqasi", budget: 'Byudjet', data: "Ma'lumot",
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Tahlil')
  ws.columns = [
    { header: '№', key: 'n', width: 5 },
    { header: 'Daraja', key: 'sev', width: 10 },
    { header: "Bo'lim", key: 'cat', width: 14 },
    { header: 'Qoida', key: 'rule', width: 32 },
    { header: 'Mashina', key: 'plate', width: 14 },
    { header: 'Savol', key: 'title', width: 60 },
    { header: 'Dalil', key: 'detail', width: 70 },
    { header: "Ta'sir, so'm", key: 'impact', width: 14 },
    { header: "Mas'ul", key: 'who', width: 20 },
    { header: 'Muddat', key: 'due', width: 12 },
    { header: 'Yangi', key: 'new', width: 7 },
  ]
  ws.getRow(1).font = { bold: true }
  const sorted = [...data.findings].sort((a, b) => (b.priority || 0) - (a.priority || 0))
  sorted.forEach((f, i) => {
    const row = ws.addRow({
      n: i + 1, sev: SEV[f.severity], cat: CAT[f.category], rule: `#${ruleNo.get(f.ruleKey)?.no} ${ruleNo.get(f.ruleKey)?.name || ''}`,
      plate: f.plate || '—', title: f.title, detail: [f.detail, ...(f.extra || [])].join('\n'), impact: f.impactUzs || null,
      who: f.assignment?.assigneeName || '', due: f.assignment?.dueDate ? uzDay(new Date(f.assignment.dueDate)).split('-').reverse().join('.') : '',
      new: f.isNew ? 'ha' : '',
    })
    row.alignment = { vertical: 'top', wrapText: true }
    if (f.severity === 'critical') row.getCell('sev').font = { color: { argb: 'FFDC2626' }, bold: true }
  })
  ws.getColumn('impact').numFmt = '#,##0'
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: 'A1', to: 'K1' }
  return wb
}

/** Kunlik cron: har bir tashkilot uchun holatni saqlaydi (admin kirmasa ham trend uzilmasin) */
export async function snapshotAllOrgs(): Promise<void> {
  const db = prisma as any
  const branches = await db.branch.findMany({ select: { id: true, organizationId: true } })
  const orgs = new Map<string, string[]>()
  for (const b of branches) {
    // getOrgFilter bilan bir xil: sub-filiallar (organizationId = org) + org'ning o'zi
    const org = b.organizationId ?? b.id
    orgs.set(org, [...(orgs.get(org) || []), b.id])
  }
  for (const [orgId, branchIds] of orgs) {
    try {
      const count = await db.vehicle.count({ where: { branchId: { in: branchIds } } })
      if (!count) continue
      const scope: InsightScope = { orgId, branchIds, narrowed: false }
      const { visible } = await visibleFindings(scope, true)
      await saveSnapshot(orgId, visible)
    } catch (e: any) {
      console.error(`[Insights] org=${orgId} snapshot xato:`, e?.message)
    }
  }
}
