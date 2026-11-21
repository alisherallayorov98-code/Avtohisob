// EkoHisob robot yordamchi — HTTP qatlami.
// Ko'rish: hamma (rol va tuman doirasida). Yashirish, hukm, topshiriq berish — faqat admin.
// Inspektor faqat o'ziga berilgan topshiriqqa javob yozadi.
import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { logEkoAudit } from '../lib/ekoAudit'
import {
  computeInsights, findCurrent, assignTask, listTasks, runAutoTriage, rulesWithAccuracy,
  invalidateInsights, ruleFingerprint, type InsightsUser,
} from '../services/insightsService'
import { RULE_BY_KEY } from '../lib/insights/engine'

const p = prisma as any
const DAY = 86_400_000

function userOf(req: EkoRequest): InsightsUser {
  const u = req.ekoUser!
  return { id: u.id, role: u.role, orgId: u.orgId, districtIds: u.districtIds ?? [] }
}

function text(v: unknown, max = 1000): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

async function actorName(req: EkoRequest): Promise<string> {
  const u = await p.ekoHisobUser.findUnique({ where: { id: req.ekoUser!.id }, select: { fullName: true } }).catch(() => null)
  return u?.fullName ?? req.ekoUser!.email ?? '—'
}

/** GET /insights?fresh=1 */
export async function getInsights(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await computeInsights(userOf(req), { fresh: req.query.fresh === '1' })
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

/** POST /insights/dismiss { fingerprint, scope: 'one'|'rule', days: number|null, reason } — admin */
export async function dismissInsight(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = userOf(req)
    const fingerprint = text(req.body?.fingerprint, 500)
    const reason = text(req.body?.reason, 300)
    const days = req.body?.days == null ? null : Math.min(365, Math.max(1, parseInt(String(req.body.days), 10) || 30))
    if (!fingerprint) { res.status(400).json({ success: false, error: 'Savol ko\'rsatilmagan' }); return }
    if (reason.length < 3) { res.status(400).json({ success: false, error: 'Sababini yozing (kamida 3 harf)' }); return }
    const f = await findCurrent(user, fingerprint)
    if (!f) { res.status(404).json({ success: false, error: 'Savol topilmadi — u allaqachon hal bo\'lgan bo\'lishi mumkin' }); return }
    // Yig'ilgan (tizimli) savolni faqat butun qoida bilan yashirish mumkin
    const wholeRule = req.body?.scope === 'rule' || f.subjectKey === 'collapsed'
    const row = await p.ekoHisobInsightDismissal.create({
      data: {
        orgId: user.orgId, fingerprint: wholeRule ? ruleFingerprint(f.ruleKey) : f.fingerprint, ruleKey: f.ruleKey,
        entityId: wholeRule ? null : f.entityId, title: wholeRule ? (RULE_BY_KEY.get(f.ruleKey)?.name ?? f.title) : f.title,
        reason, until: days ? new Date(Date.now() + days * DAY) : null,
        createdBy: user.id, createdByName: await actorName(req),
      },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'insight.dismiss', targetType: 'insight', targetId: row.id, targetName: f.entityName ?? f.title.slice(0, 120),
      details: { ruleKey: f.ruleKey, wholeRule, days, reason },
    })
    invalidateInsights(user.orgId)
    res.json({ success: true, data: row })
  } catch (err) { next(err) }
}

/** GET /insights/dismissals — admin */
export async function listDismissals(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const now = new Date()
    const rows = await p.ekoHisobInsightDismissal.findMany({
      where: { orgId: req.ekoUser!.orgId, OR: [{ until: null }, { until: { gt: now } }] },
      orderBy: { createdAt: 'desc' }, take: 500,
    })
    res.json({ success: true, data: rows.map((r: any) => ({ ...r, ruleName: RULE_BY_KEY.get(r.ruleKey)?.name ?? r.ruleKey, wholeRule: r.fingerprint.startsWith('rule:') })) })
  } catch (err) { next(err) }
}

/** DELETE /insights/dismissals/:id — admin (savolni qaytarish) */
export async function restoreDismissal(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.ekoUser!.orgId
    const row = await p.ekoHisobInsightDismissal.findFirst({ where: { id: req.params.id, orgId } })
    if (!row) { res.status(404).json({ success: false, error: 'Topilmadi' }); return }
    await p.ekoHisobInsightDismissal.delete({ where: { id: row.id } })
    await logEkoAudit(req.ekoUser, { action: 'insight.restore', targetType: 'insight', targetId: row.id, targetName: row.title, details: { ruleKey: row.ruleKey } })
    invalidateInsights(orgId)
    res.json({ success: true })
  } catch (err) { next(err) }
}

/**
 * POST /insights/verdict { fingerprint, verdict, reason, resolution?, sourceChecked? } — admin
 * confirmed — to'g'ri, muammo bor (savol ko'rinishda qoladi, belgisi bilan)
 * wrong     — noto'g'ri savol (yashiriladi, qoida aniqligi pasayadi)
 * normal    — to'g'ri, lekin normal holat (yashiriladi)
 * Javobgarlik himoyasi: taxmin (guess) savolni "to'g'ri" deyish uchun manbani ko'rgan bo'lish
 * va kamida 10 harf asos yozish shart — taxmin bo'yicha xodim ayblanib qolmasin.
 */
export async function setVerdict(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = userOf(req)
    const fingerprint = text(req.body?.fingerprint, 500)
    const verdict = String(req.body?.verdict ?? '')
    const reason = text(req.body?.reason, 500)
    const resolution = text(req.body?.resolution, 500) || null
    const sourceChecked = req.body?.sourceChecked === true
    if (!['confirmed', 'wrong', 'normal'].includes(verdict)) { res.status(400).json({ success: false, error: 'Hukm noto\'g\'ri' }); return }
    const f = await findCurrent(user, fingerprint)
    if (!f) { res.status(404).json({ success: false, error: 'Savol topilmadi — u allaqachon hal bo\'lgan bo\'lishi mumkin' }); return }
    const minLen = verdict === 'confirmed' && f.confidence !== 'fact' ? 10 : 3
    if (reason.length < minLen) { res.status(400).json({ success: false, error: `Asosini yozing (kamida ${minLen} harf)` }); return }
    if (verdict === 'confirmed' && f.confidence !== 'fact' && !sourceChecked) {
      res.status(400).json({ success: false, error: 'Bu savol fakt emas — tasdiqlashdan oldin manbani ko\'rib chiqing va belgilang' }); return
    }
    const name = await actorName(req)
    const row = await p.ekoHisobInsightVerdict.create({
      data: {
        orgId: user.orgId, fingerprint: f.fingerprint, ruleKey: f.ruleKey, entityId: f.entityId, title: f.title,
        confidence: f.confidence ?? null, verdict, reason, resolution, sourceChecked,
        createdBy: user.id, createdByName: name,
      },
    })
    if (verdict !== 'confirmed') {
      const wholeRule = f.subjectKey === 'collapsed'
      await p.ekoHisobInsightDismissal.create({
        data: {
          orgId: user.orgId, fingerprint: wholeRule ? ruleFingerprint(f.ruleKey) : f.fingerprint, ruleKey: f.ruleKey,
          entityId: wholeRule ? null : f.entityId, title: f.title,
          reason: `${verdict === 'wrong' ? "Noto'g'ri savol" : 'Normal holat'}: ${reason}`, until: null,
          createdBy: user.id, createdByName: name,
        },
      })
      // Shu savol bo'yicha ochiq topshiriq bo'lsa — yopiladi
      await p.ekoHisobInsightTask.updateMany({
        where: { orgId: user.orgId, fingerprint: f.fingerprint, status: { in: ['open', 'answered', 'suspicious'] } },
        data: { status: 'closed', closedAt: new Date(), closedBy: user.id, verifyNote: `Admin hukmi: ${verdict === 'wrong' ? "noto'g'ri savol" : 'normal holat'}` },
      })
    }
    await logEkoAudit(req.ekoUser, {
      action: 'insight.verdict', targetType: 'insight', targetId: row.id, targetName: f.entityName ?? f.title.slice(0, 120),
      details: { ruleKey: f.ruleKey, verdict, reason, resolution, confidence: f.confidence },
    })
    invalidateInsights(user.orgId)
    res.json({ success: true, data: row })
  } catch (err) { next(err) }
}

/** GET /insights/verdicts — jurnal + qoidalar aniqligi (admin) */
export async function listVerdicts(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.ekoUser!.orgId
    const [rows, rules] = await Promise.all([
      p.ekoHisobInsightVerdict.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 300 }),
      rulesWithAccuracy(orgId),
    ])
    res.json({ success: true, data: { verdicts: rows.map((r: any) => ({ ...r, ruleName: RULE_BY_KEY.get(r.ruleKey)?.name ?? r.ruleKey })), rules } })
  } catch (err) { next(err) }
}

/** GET /insights/tasks?status=active|done|open|answered|suspicious|closed */
export async function getTasks(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'active'
    res.json({ success: true, data: await listTasks(userOf(req), status) })
  } catch (err) { next(err) }
}

/** POST /insights/tasks { fingerprint, assigneeId, note? } — admin qo'lda topshiradi */
export async function createTask(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = userOf(req)
    const f = await findCurrent(user, text(req.body?.fingerprint, 500))
    if (!f) { res.status(404).json({ success: false, error: 'Savol topilmadi' }); return }
    if (f.subjectKey === 'collapsed') { res.status(400).json({ success: false, error: 'Tizimli savolni bitta xodimga topshirib bo\'lmaydi' }); return }
    const r = await assignTask(user, f, String(req.body?.assigneeId ?? ''), text(req.body?.note, 500) || null)
    if (!r.ok) { res.status(400).json({ success: false, error: r.error }); return }
    await logEkoAudit(req.ekoUser, {
      action: 'insight.task_assign', targetType: 'insight', targetId: r.task.id, targetName: f.entityName ?? f.title.slice(0, 120),
      details: { ruleKey: f.ruleKey, assigneeId: r.task.assigneeId },
    })
    res.json({ success: true, data: { id: r.task.id, notified: r.notified } })
  } catch (err) { next(err) }
}

/** POST /insights/tasks/:id/answer { answer } — faqat topshiriq egasi (yoki admin) */
export async function answerTask(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = userOf(req)
    const answer = text(req.body?.answer, 1000)
    if (answer.length < 3) { res.status(400).json({ success: false, error: 'Javobni yozing' }); return }
    const t = await p.ekoHisobInsightTask.findFirst({ where: { id: req.params.id, orgId: user.orgId } })
    if (!t) { res.status(404).json({ success: false, error: 'Topshiriq topilmadi' }); return }
    if (t.assigneeId !== user.id && user.role !== 'admin') { res.status(403).json({ success: false, error: 'Bu topshiriq sizga berilmagan' }); return }
    if (!['open', 'answered'].includes(t.status)) { res.status(400).json({ success: false, error: 'Topshiriq yopilgan' }); return }
    await p.ekoHisobInsightTask.update({ where: { id: t.id }, data: { answer, answeredAt: new Date(), status: 'answered' } })
    invalidateInsights(user.orgId)
    res.json({ success: true })
  } catch (err) { next(err) }
}

/** POST /insights/tasks/:id/close | /reopen — admin */
export async function closeTask(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = userOf(req)
    const reopen = req.path.endsWith('/reopen')
    const t = await p.ekoHisobInsightTask.findFirst({ where: { id: req.params.id, orgId: user.orgId } })
    if (!t) { res.status(404).json({ success: false, error: 'Topshiriq topilmadi' }); return }
    const note = text(req.body?.note, 300) || null
    if (reopen) {
      await p.ekoHisobInsightTask.update({
        where: { id: t.id },
        data: { status: 'open', closedAt: null, closedBy: null, dueDate: new Date(Date.now() + 3 * DAY), verifyNote: note ? `Qayta ochildi: ${note}` : 'Qayta ochildi' },
      })
    } else {
      await p.ekoHisobInsightTask.update({ where: { id: t.id }, data: { status: 'closed', closedAt: new Date(), closedBy: user.id, ...(note ? { verifyNote: note } : {}) } })
    }
    await logEkoAudit(req.ekoUser, {
      action: reopen ? 'insight.task_reopen' : 'insight.task_close', targetType: 'insight', targetId: t.id, targetName: t.title.slice(0, 120),
      details: { note },
    })
    invalidateInsights(user.orgId)
    res.json({ success: true })
  } catch (err) { next(err) }
}

/** POST /insights/run-triage — admin: hozir tekshirish va inspektorlarga yuborish */
export async function runTriageNow(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = await runAutoTriage(req.ekoUser!.orgId)
    res.json({ success: true, data: r })
  } catch (err) { next(err) }
}

/** GET /insights/assignees — topshiriq berish uchun xodimlar (admin) */
export async function listAssignees(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await p.ekoHisobUser.findMany({
      where: { orgId: req.ekoUser!.orgId, isActive: true, isMirror: false, role: { in: ['inspector', 'supervisor'] } },
      select: { id: true, fullName: true, role: true, districts: { select: { districtId: true } }, botLink: { select: { id: true } } },
      orderBy: { fullName: 'asc' },
    })
    res.json({
      success: true,
      data: rows.map((u: any) => ({ id: u.id, fullName: u.fullName, role: u.role, districtIds: u.districts.map((d: any) => d.districtId), botLinked: !!u.botLink })),
    })
  } catch (err) { next(err) }
}
