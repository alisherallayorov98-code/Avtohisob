// Tahlil savolini filialga so'rov sifatida yuborish. Har filialda bitta mas'ul javob beradi:
// ma'lumot kiritadi (savol o'zi yo'qoladi → "resolved") yoki matnli javob yozadi (→ "answered").
// Menyudagi raqam: filialga — javob kutayotganlar, adminga — javob kelganlar.
// Tenant: filial foydalanuvchisi FAQAT o'z filiali (user.branchId) so'rovlarini ko'radi.
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { resolveInsightScope, computeFindings, type InsightScope } from './insightsService'
import type { FindingOut, RequestInfo } from '../lib/insights/types'
import { uzDay } from '../lib/insights/context'

interface AuthUserLike { id: string; role: string; branchId?: string | null; fullName?: string }

const ADMIN_ROLES = ['admin', 'super_admin']
const ACTIVE = ['open', 'answered']
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const db = () => prisma as any

const fmtDay = (d: Date) => uzDay(d).split('-').reverse().join('.')
const esc = (s: string) => s.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]!))

/** Telegram xabari — bot o'chiq yoki foydalanuvchi bog'lanmagan bo'lsa jim */
async function telegram(userIds: string[], text: string) {
  if (!userIds.length) return
  try {
    const { sendToUser } = await import('./telegramBot')
    for (const id of userIds) await sendToUser(id, text).catch(() => 0)
  } catch { /* bot yo'q — sayt ichidagi raqam baribir ko'rinadi */ }
}

async function branchResponsibles(branchId: string): Promise<string[]> {
  const users = await db().user.findMany({
    where: { branchId, isActive: true, role: { in: ['branch_manager', 'operator', 'manager'] } },
    select: { id: true },
  })
  return users.map((u: any) => u.id)
}

async function orgAdmins(orgId: string): Promise<string[]> {
  const branches = await db().branch.findMany({ where: { OR: [{ id: orgId }, { organizationId: orgId }] }, select: { id: true } })
  const users = await db().user.findMany({
    where: { isActive: true, role: 'admin', branchId: { in: branches.map((b: any) => b.id) } },
    select: { id: true },
  })
  return users.map((u: any) => u.id)
}

/** Filial foydalanuvchisi uchun butun tashkilot doirasi (savol hali bormi — tekshirish uchun) */
async function orgScopeOfBranch(branchId: string): Promise<InsightScope> {
  const b = await db().branch.findUnique({ where: { id: branchId }, select: { organizationId: true } })
  const orgId = b?.organizationId ?? branchId
  const rows = await db().branch.findMany({ where: { OR: [{ id: orgId }, { organizationId: orgId }] }, select: { id: true } })
  return { orgId, branchIds: rows.map((r: any) => r.id), narrowed: false }
}

/** Savoli yo'qolgan (ma'lumot kiritilgan) ochiq so'rovlarni "resolved" qiladi */
export async function resolveVanishedRequests(orgId: string, allFingerprints: Set<string>): Promise<number> {
  const rows = await db().insightRequest.findMany({ where: { orgId, status: { in: ACTIVE } }, select: { id: true, fingerprint: true } })
  const gone = rows.filter((r: any) => !allFingerprints.has(r.fingerprint))
  if (!gone.length) return 0
  const ids = gone.map((r: any) => r.id)
  await db().insightRequest.updateMany({ where: { id: { in: ids }, orgId }, data: { status: 'resolved', closedAt: new Date() } })
  await db().insightRequestMessage.createMany({ data: ids.map((id: string) => ({ requestId: id, side: 'system', text: "Ma'lumot kiritildi — savol o'z-o'zidan hal bo'ldi." })) })
  return gone.length
}

/** Tahlil sahifasi uchun: fingerprint → so'rov holati */
export async function requestInfoMap(orgId: string): Promise<Map<string, RequestInfo>> {
  const rows = await db().insightRequest.findMany({
    where: { orgId, status: { in: ACTIVE } },
    select: { id: true, fingerprint: true, status: true, branchId: true, dueDate: true, messages: { where: { side: 'branch' }, orderBy: { createdAt: 'desc' }, take: 1, select: { text: true } } },
  })
  const branchIds = [...new Set(rows.map((r: any) => r.branchId))] as string[]
  const branches = branchIds.length ? await db().branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : []
  const nameOf = new Map(branches.map((b: any) => [b.id, b.name]))
  const now = Date.now()
  return new Map(rows.map((r: any) => [r.fingerprint, {
    id: r.id, status: r.status, branchId: r.branchId, branchName: (nameOf.get(r.branchId) as string) || null,
    dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
    overdue: r.status === 'open' && !!r.dueDate && new Date(r.dueDate).getTime() < now,
    answer: r.messages?.[0]?.text || null,
  }]))
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function sendRequests(user: AuthUserLike, body: any) {
  const scope = await resolveInsightScope(user)
  const fps: string[] = Array.isArray(body?.fingerprints) ? body.fingerprints.map(String).slice(0, 500) : []
  if (!fps.length) throw new AppError('Savol tanlanmagan', 400)
  const forcedBranch = body?.branchId ? String(body.branchId) : null
  if (forcedBranch && !scope.branchIds.includes(forcedBranch)) throw new AppError("Filial shu tashkilotda emas", 403)
  let dueDate: Date | null = null
  if (body?.dueDate) {
    dueDate = new Date(`${String(body.dueDate).slice(0, 10)}T18:59:59.000Z`)
    if (isNaN(dueDate.getTime())) throw new AppError("Muddat noto'g'ri", 400)
  }
  const note = body?.note ? String(body.note).trim().slice(0, 1000) : ''

  const { findings } = await computeFindings(scope)
  const byFp = new Map(findings.map(f => [f.fingerprint, f]))
  const existing = await db().insightRequest.findMany({ where: { orgId: scope.orgId, fingerprint: { in: fps }, status: { in: ACTIVE } }, select: { fingerprint: true } })
  const already = new Set(existing.map((e: any) => e.fingerprint))

  const perBranch = new Map<string, number>()
  let skippedNoBranch = 0, skippedDuplicate = 0, skippedGone = 0
  const adminName = user.fullName || 'Admin'
  for (const fp of fps) {
    const f: FindingOut | undefined = byFp.get(fp)
    if (!f) { skippedGone++; continue }
    if (already.has(fp)) { skippedDuplicate++; continue }
    const branchId = forcedBranch || f.branchId
    if (!branchId || !scope.branchIds.includes(branchId)) { skippedNoBranch++; continue }
    await db().insightRequest.create({
      data: {
        orgId: scope.orgId, branchId, fingerprint: fp, ruleKey: f.ruleKey, vehicleId: f.vehicleId, plate: f.plate,
        title: f.title.slice(0, 500), detail: [f.detail, ...(f.extra || [])].join('\n').slice(0, 4000),
        evidence: f.evidence ?? undefined, quick: f.quick ?? undefined, actionPath: f.action.path,
        dueDate, createdById: user.id,
        messages: note ? { create: [{ side: 'admin', userId: user.id, userName: adminName, text: note }] } : undefined,
      },
    })
    already.add(fp)
    perBranch.set(branchId, (perBranch.get(branchId) || 0) + 1)
  }

  // Har filial mas'uliga bitta Telegram xabar (ko'p savol yuborilsa ham)
  for (const [branchId, n] of perBranch) {
    const users = await branchResponsibles(branchId)
    await telegram(users,
      `📋 <b>Markazdan ${n} ta savol keldi</b>\n` +
      `${dueDate ? `Muddat: ${fmtDay(dueDate)}\n` : ''}${note ? `Izoh: ${esc(note.slice(0, 300))}\n` : ''}` +
      `\nJavob berish: ${APP_URL}/insight-requests`)
  }
  const created = [...perBranch.values()].reduce((s, n) => s + n, 0)
  return { created, branches: perBranch.size, skippedDuplicate, skippedNoBranch, skippedGone }
}

async function loadRequestsWithMessages(where: any) {
  const rows = await db().insightRequest.findMany({
    where,
    include: { messages: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ updatedAt: 'desc' }],
    take: 500,
  })
  const branchIds = [...new Set(rows.map((r: any) => r.branchId))] as string[]
  const branches = branchIds.length ? await db().branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : []
  const nameOf = new Map(branches.map((b: any) => [b.id, b.name]))
  return rows.map((r: any) => ({ ...r, branchName: nameOf.get(r.branchId) || null }))
}

export async function listRequestsForAdmin(user: AuthUserLike, status?: string) {
  const scope = await resolveInsightScope(user)
  const where: any = { orgId: scope.orgId }
  if (status === 'active') where.status = { in: ACTIVE }
  else if (status && ['open', 'answered', 'closed', 'resolved'].includes(status)) where.status = status
  else where.OR = [{ status: { in: ACTIVE } }, { updatedAt: { gte: new Date(Date.now() - 30 * 86400000) } }]
  return loadRequestsWithMessages(where)
}

export async function adminRequestAction(user: AuthUserLike, id: string, body: any) {
  const scope = await resolveInsightScope(user)
  const r = await db().insightRequest.findFirst({ where: { id, orgId: scope.orgId } })
  if (!r) throw new AppError("So'rov topilmadi", 404)
  const action = String(body?.action || '')
  const text = String(body?.text || '').trim().slice(0, 1000)
  if (action === 'close') {
    await db().insightRequest.update({ where: { id }, data: { status: 'closed', closedAt: new Date() } })
    await db().insightRequestMessage.create({ data: { requestId: id, side: 'admin', userId: user.id, userName: user.fullName || 'Admin', text: text || 'Qabul qilindi.' } })
  } else if (action === 'reask') {
    if (text.length < 3) throw new AppError("Nima noaniq ekanini yozing", 400)
    await db().insightRequest.update({ where: { id }, data: { status: 'open', closedAt: null } })
    await db().insightRequestMessage.create({ data: { requestId: id, side: 'admin', userId: user.id, userName: user.fullName || 'Admin', text } })
    await telegram(await branchResponsibles(r.branchId),
      `🔁 <b>Markaz savolni qayta so'radi</b>\n${esc(r.plate ? `${r.plate}: ` : '')}${esc(r.title.slice(0, 200))}\nIzoh: ${esc(text.slice(0, 300))}\n\n${APP_URL}/insight-requests`)
  } else if (action === 'cancel') {
    await db().insightRequest.update({ where: { id }, data: { status: 'closed', closedAt: new Date() } })
    await db().insightRequestMessage.create({ data: { requestId: id, side: 'system', text: "So'rov bekor qilindi." } })
  } else {
    throw new AppError("Noma'lum amal", 400)
  }
  return { ok: true }
}

// ─── Filial ──────────────────────────────────────────────────────────────────

function requireBranch(user: AuthUserLike): string {
  if (!user.branchId) throw new AppError('Foydalanuvchi filialga biriktirilmagan', 403)
  return user.branchId
}

export async function listRequestsForBranch(user: AuthUserLike) {
  const branchId = requireBranch(user)
  return loadRequestsWithMessages({
    branchId,
    OR: [{ status: { in: ACTIVE } }, { updatedAt: { gte: new Date(Date.now() - 14 * 86400000) } }],
  })
}

export async function branchAnswer(user: AuthUserLike, id: string, body: any) {
  const branchId = requireBranch(user)
  const r = await db().insightRequest.findFirst({ where: { id, branchId } })
  if (!r) throw new AppError("So'rov topilmadi", 404)
  if (!ACTIVE.includes(r.status)) throw new AppError("So'rov allaqachon yopilgan", 400)
  const text = String(body?.text || '').trim().slice(0, 2000)
  if (text.length < 3) throw new AppError('Javobni yozing (kamida 3 harf)', 400)
  await db().insightRequest.update({ where: { id }, data: { status: 'answered', answeredById: user.id, answeredAt: new Date() } })
  await db().insightRequestMessage.create({ data: { requestId: id, side: 'branch', userId: user.id, userName: user.fullName || null, text } })
  // Adminga: sayt ichidagi bildirishnoma (Tahlil menyusidagi raqam ham oshadi)
  const admins = await orgAdmins(r.orgId)
  if (admins.length) {
    await db().notification.createMany({
      data: admins.map(uid => ({ userId: uid, title: 'Filialdan javob keldi', message: `${r.plate ? `${r.plate}: ` : ''}${text.slice(0, 300)}`, type: 'info', link: '/insights?tab=requests' })),
    }).catch(() => undefined)
  }
  return { ok: true }
}

/** Filial ma'lumot kiritgandan keyin: savol hali bormi? Yo'q bo'lsa so'rov o'zi yopiladi */
export async function branchRecheck(user: AuthUserLike, id: string) {
  const branchId = requireBranch(user)
  const r = await db().insightRequest.findFirst({ where: { id, branchId } })
  if (!r) throw new AppError("So'rov topilmadi", 404)
  const scope = await orgScopeOfBranch(branchId)
  const { findings } = await computeFindings(scope, true)
  const fps = new Set(findings.map(f => f.fingerprint))
  await resolveVanishedRequests(scope.orgId, fps)
  return { resolved: !fps.has(r.fingerprint) }
}

/** Menyudagi raqam: admin — javob kelgan so'rovlar, filial — javob kutayotganlar */
export async function requestBadge(user: AuthUserLike) {
  if (ADMIN_ROLES.includes(user.role)) {
    if (!user.branchId) return { count: 0, role: 'admin' }
    const scope = await resolveInsightScope(user).catch(() => null)
    if (!scope) return { count: 0, role: 'admin' }
    const count = await db().insightRequest.count({ where: { orgId: scope.orgId, status: 'answered' } })
    return { count, role: 'admin' }
  }
  if (!user.branchId) return { count: 0, role: 'branch' }
  const count = await db().insightRequest.count({ where: { branchId: user.branchId, status: 'open' } })
  return { count, role: 'branch' }
}
