// Tahlil hukmlari: admin har savolga "to'g'ri — muammo bor", "savol noto'g'ri" yoki "normal" deydi.
// Har hukm jurnalga yoziladi (kim, qachon, nega, qanday ishonch darajasida). Javobgarlik himoyasi:
// taxmin/kuchli belgini tasdiqlashdan oldin manbani ko'rib chiqish va sabab yozish majburiy;
// taxminda standart yechim — avval tushuntirish so'rash.
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { RULES } from '../lib/insights/engine'
import { RULE_CONFIDENCE } from '../lib/insights/confidence'
import { accuracyOf, type RuleAccuracy } from '../lib/insights/accuracy'
import { resolveInsightScope } from './insightsService'

interface AuthUserLike { id: string; role: string; branchId?: string | null; fullName?: string }

const db = () => prisma as any
const VERDICTS = ['confirmed', 'wrong', 'normal'] as const
const STATS_DAYS = 180

/** Qoidalar aniqligi (oxirgi 180 kun hukmlari) */
export async function ruleAccuracyMap(orgId: string): Promise<Map<string, RuleAccuracy>> {
  const rows = await db().insightVerdict.groupBy({
    by: ['ruleKey', 'verdict'],
    where: { orgId, createdAt: { gte: new Date(Date.now() - STATS_DAYS * 86400000) } },
    _count: { _all: true },
  })
  const acc = new Map<string, { c: number; w: number; n: number }>()
  for (const r of rows) {
    const x = acc.get(r.ruleKey) || { c: 0, w: 0, n: 0 }
    if (r.verdict === 'confirmed') x.c += r._count._all
    else if (r.verdict === 'wrong') x.w += r._count._all
    else x.n += r._count._all
    acc.set(r.ruleKey, x)
  }
  return new Map([...acc.entries()].map(([k, x]) => [k, accuracyOf(x.c, x.w, x.n)]))
}

/** Savol bo'yicha eng so'nggi "tasdiqlangan" hukm (ro'yxatda belgi uchun) */
export async function confirmedVerdicts(orgId: string): Promise<Map<string, { at: string; by: string | null; reason: string; resolution: string | null }>> {
  const rows = await db().insightVerdict.findMany({
    where: { orgId, verdict: 'confirmed', createdAt: { gte: new Date(Date.now() - STATS_DAYS * 86400000) } },
    orderBy: { createdAt: 'desc' }, take: 1000,
  })
  const names = await userNames(rows.map((r: any) => r.createdById))
  const m = new Map<string, { at: string; by: string | null; reason: string; resolution: string | null }>()
  for (const r of rows) if (!m.has(r.fingerprint)) m.set(r.fingerprint, { at: new Date(r.createdAt).toISOString(), by: names.get(r.createdById) || null, reason: r.reason, resolution: r.resolution })
  return m
}

async function userNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))] as string[]
  if (!uniq.length) return new Map()
  const users = await db().user.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true } })
  return new Map(users.map((u: any) => [u.id, u.fullName]))
}

/** "Normal holat" yashirishi ham jurnalga tushadi (aniqlik statistikasi uchun) */
export async function recordNormalVerdict(orgId: string, userId: string, d: { fingerprint: string; ruleKey: string; vehicleId: string | null; title: string | null; reason: string; dismissalId: string }) {
  await db().insightVerdict.create({
    data: { orgId, ...d, confidence: RULE_CONFIDENCE[d.ruleKey]?.[0] ?? null, verdict: 'normal', createdById: userId },
  }).catch((e: any) => console.error('[Insights] hukm yozish xato:', e?.message))
}

export async function saveVerdict(user: AuthUserLike, body: any) {
  const scope = await resolveInsightScope(user)
  const verdict = String(body?.verdict || '') as typeof VERDICTS[number]
  if (verdict !== 'confirmed' && verdict !== 'wrong') throw new AppError("Hukm noto'g'ri (normal holat uchun yashirish oynasidan foydalaning)", 400)
  const ruleKey = String(body?.ruleKey || '')
  if (!RULES.some(r => r.key === ruleKey)) throw new AppError("Noma'lum qoida", 400)
  const fingerprint = String(body?.fingerprint || '')
  if (!fingerprint || fingerprint.length > 400 || !(fingerprint.startsWith(`${ruleKey}|`) || fingerprint.startsWith('merge:') || fingerprint === `rule:${ruleKey}`)) {
    throw new AppError("Savol identifikatori noto'g'ri", 400)
  }
  const vehicleId = body?.vehicleId ? String(body.vehicleId) : null
  if (vehicleId) {
    const v = await db().vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
    if (!v || !scope.branchIds.includes(v.branchId)) throw new AppError("Ruxsat yo'q", 403)
  }
  // Ishonch darajasi serverda aniqlanadi (mijozga ishonmaymiz); past aniqlik ham hisobga olinadi
  const stats = await ruleAccuracyMap(scope.orgId)
  const confidence = stats.get(ruleKey)?.low ? 'guess' : (RULE_CONFIDENCE[ruleKey]?.[0] ?? 'guess')
  const reason = String(body?.reason || '').trim().slice(0, 1000)
  const title = body?.title ? String(body.title).slice(0, 300) : null

  if (verdict === 'wrong') {
    if (reason.length < 3) throw new AppError("Nega noto'g'ri ekanini yozing", 400)
    // Noto'g'ri savol yashiriladi (doimiy) — qayta chiqib, vaqt olmasin
    const dis = await db().insightDismissal.create({
      data: { orgId: scope.orgId, fingerprint, ruleKey, vehicleId, title, reason: `Savol noto'g'ri: ${reason}`.slice(0, 500), until: null, createdById: user.id },
    })
    const v = await db().insightVerdict.create({
      data: { orgId: scope.orgId, fingerprint, ruleKey, vehicleId, title, confidence, verdict, reason, dismissalId: dis.id, createdById: user.id },
    })
    return { id: v.id, verdict }
  }

  // confirmed — javobgarlik himoyasi
  if (confidence !== 'fact' && body?.reviewed !== true) {
    throw new AppError("Avval manbani ko'rib chiqing va buni belgilang — bu savol aniq fakt emas", 400)
  }
  const minLen = confidence === 'guess' ? 10 : 3
  if (reason.length < minLen) throw new AppError(confidence === 'guess' ? "Taxmin savolni tasdiqlash uchun nimani tekshirganingizni yozing (kamida 10 harf)" : 'Sababni yozing', 400)
  const resolution = ['request', 'note'].includes(body?.resolution) ? body.resolution : (confidence === 'fact' ? 'note' : 'request')

  const v = await db().insightVerdict.create({
    data: { orgId: scope.orgId, fingerprint, ruleKey, vehicleId, title, confidence, verdict, reason, resolution, createdById: user.id },
  })
  let request: unknown = null
  if (resolution === 'request') {
    // Tushuntirish huquqi: filial (va haydovchi) avval javob beradi
    const { sendRequests } = await import('./insightRequestsService')
    request = await sendRequests(user, {
      fingerprints: [fingerprint], dueDate: body?.dueDate,
      note: `Markaz tekshirdi va muammo deb hisobladi: ${reason}\nIltimos, tushuntirish bering.`,
    }).catch((e: any) => ({ error: e?.message }))
  }
  return { id: v.id, verdict, resolution, request }
}

export async function listVerdicts(user: AuthUserLike) {
  const scope = await resolveInsightScope(user)
  const rows = await db().insightVerdict.findMany({ where: { orgId: scope.orgId }, orderBy: { createdAt: 'desc' }, take: 300 })
  const names = await userNames(rows.map((r: any) => r.createdById))
  const stats = await ruleAccuracyMap(scope.orgId)
  const ruleName = new Map(RULES.map(r => [r.key, r.name]))
  return {
    verdicts: rows.map((r: any) => ({ ...r, createdByName: names.get(r.createdById) || null, ruleName: ruleName.get(r.ruleKey) || r.ruleKey })),
    rules: [...stats.entries()]
      .map(([key, a]) => ({ key, name: ruleName.get(key) || key, ...a }))
      .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || b.wrong - a.wrong),
  }
}

/** Hukmni bekor qilish — yashirilgan savol qaytadi */
export async function deleteVerdict(user: AuthUserLike, id: string) {
  const scope = await resolveInsightScope(user)
  const v = await db().insightVerdict.findFirst({ where: { id, orgId: scope.orgId } })
  if (!v) throw new AppError('Topilmadi', 404)
  if (v.dismissalId) await db().insightDismissal.deleteMany({ where: { id: v.dismissalId, orgId: scope.orgId } })
  await db().insightVerdict.deleteMany({ where: { id, orgId: scope.orgId } })
  return { deleted: true }
}
