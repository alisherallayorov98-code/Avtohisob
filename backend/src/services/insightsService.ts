// Tahlil orkestratsiyasi: loader → pure dvigatel → yashirishlar → kunlik holat (trend).
import { prisma } from '../lib/prisma'
import { getOrgFilter, applyNarrowedBranchFilter } from '../lib/orgFilter'
import { AppError } from '../middleware/errorHandler'
import { loadInsightSnapshot } from './insightsLoader'
import {
  RULES, runRules, applyDismissals, summarize, scoreVehicles, diffFingerprints, ruleFingerprint,
} from '../lib/insights/engine'
import type { FindingOut } from '../lib/insights/types'
import { uzDay } from '../lib/insights/context'

interface AuthUserLike { id: string; role: string; branchId?: string | null }

const CACHE_TTL_MS = 3 * 60 * 1000
const cache = new Map<string, { at: number; findings: FindingOut[]; ruleErrors: number }>()

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

async function computeFindings(scope: InsightScope, force = false) {
  const key = `${scope.orgId}|${[...scope.branchIds].sort().join(',')}`
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit, cached: true }
  const snap = await loadInsightSnapshot(scope.orgId, scope.branchIds)
  const res = runRules(snap)
  if (res.ruleErrors.length) console.error('[Insights] qoida xatolari:', res.ruleErrors)
  const entry = { at: Date.now(), findings: res.findings, ruleErrors: res.ruleErrors.length }
  cache.set(key, entry)
  // Kesh cheksiz o'smasin
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
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
  await (prisma as any).insightSnapshot.upsert({
    where: { orgId_date: { orgId, date } },
    create: { orgId, date, total: s.total, critical: s.critical, warning: s.warning, info: s.info, fingerprints: visible.map(f => f.fingerprint) },
    update: { total: s.total, critical: s.critical, warning: s.warning, info: s.info, fingerprints: visible.map(f => f.fingerprint) },
  })
}

export async function getInsights(user: AuthUserLike, opts: { branchId?: string; refresh?: boolean }) {
  const scope = await resolveInsightScope(user, opts.branchId)
  const { findings, at, cached, ruleErrors } = await computeFindings(scope, !!opts.refresh)
  const dismissals = await activeDismissals(scope.orgId)
  const { visible, hidden } = applyDismissals(findings, dismissals, new Date())

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

  const vehicles = scoreVehicles(withNew)
  const branchRows = await (prisma as any).branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true } })

  return {
    generatedAt: new Date(at).toISOString(),
    cached,
    ruleCount: RULES.length,
    ruleErrors,
    summary: summarize(withNew),
    hiddenCount: hidden,
    trend,
    findings: withNew,
    vehicles,
    branches: branchRows,
    rules: RULES.map(r => ({ no: r.no, key: r.key, category: r.category, name: r.name })),
  }
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
  if (!fingerprint || fingerprint.length > 400 || (scopeKind === 'one' && !fingerprint.startsWith(`${ruleKey}|`))) {
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
      const { findings } = await computeFindings(scope, true)
      const { visible } = applyDismissals(findings, await activeDismissals(orgId), new Date())
      await saveSnapshot(orgId, visible)
    } catch (e: any) {
      console.error(`[Insights] org=${orgId} snapshot xato:`, e?.message)
    }
  }
}
