import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { logEkoAudit } from '../lib/ekoAudit'
import { getCurrentMonth, isValidMonth } from '../lib/months'
import { uzMonth } from '../lib/dateFormat'
import {
  AUTO_METRICS, getAutoMetric, validateIndicatorInput, decideClose, checkBonusAdjustment,
  validateAdjustmentReason,
} from '../lib/kpiMath'
import { currentMonthUz } from '../lib/uzt'
import {
  loadScheme, loadIndicators, buildMonthResults, isPeriodClosed, seedDefaultIndicators,
} from '../services/kpiService'

/** "YYYY-MM" va oy 01–12 (isValidMonth faqat shaklni tekshiradi). */
function validMonth(m: string): boolean {
  if (!isValidMonth(m)) return false
  const mo = Number(m.slice(5, 7))
  return mo >= 1 && mo <= 12
}

const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error })

function monthParam(req: EkoRequest): string | null {
  const m = String(req.query.month ?? getCurrentMonth())
  return validMonth(m) ? m : null
}

/** Foydalanuvchi shu korxonaning faol inspektori ekanini tekshiradi. */
async function findInspector(orgId: string, userId: string) {
  return (prisma as any).ekoHisobUser.findFirst({
    where: { id: userId, orgId, role: 'inspector', isMirror: false },
    select: { id: true, fullName: true },
  })
}

// ─── Sxema va ko'rsatkichlar (admin) ─────────────────────────────────────────

export async function getKpiScheme(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const [scheme, indicators] = await Promise.all([loadScheme(orgId), loadIndicators(orgId)])
    res.json({ success: true, data: { scheme, indicators, metrics: AUTO_METRICS } })
  } catch (err) { next(err) }
}

export async function updateKpiScheme(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const bonusMax = Math.round(Number(req.body.bonusMax))
    const minScore = Math.round(Number(req.body.minScore))
    const capPercent = Math.round(Number(req.body.capPercent))
    if (!Number.isFinite(bonusMax) || bonusMax < 0 || bonusMax > 1_000_000_000) return void fail(res, 400, "Bonus summasi noto'g'ri")
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) return void fail(res, 400, "Minimal ball 0–100 oralig'ida bo'lishi kerak")
    if (!Number.isFinite(capPercent) || capPercent < 100 || capPercent > 200) return void fail(res, 400, "Chegara 100–200% oralig'ida bo'lishi kerak")

    const before = await loadScheme(orgId)
    await (prisma as any).ekoHisobKpiScheme.upsert({
      where: { orgId },
      create: { orgId, bonusMax, minScore, capPercent },
      update: { bonusMax, minScore, capPercent },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.scheme_update', targetType: 'kpi', targetName: 'KPI sxemasi',
      details: { before, after: { bonusMax, minScore, capPercent } },
    })
    res.json({ success: true, data: { bonusMax, minScore, capPercent } })
  } catch (err) { next(err) }
}

export async function seedKpiIndicators(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const added = await seedDefaultIndicators(req.ekoUser!.orgId)
    if (added > 0) {
      await logEkoAudit(req.ekoUser, {
        action: 'kpi.indicator_create', targetType: 'kpi', targetName: 'Standart ko\'rsatkichlar', details: { added },
      })
    }
    res.json({ success: true, data: { added } })
  } catch (err) { next(err) }
}

export async function createKpiIndicator(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const kind = req.body.kind === 'auto' ? 'auto' : 'manual'
    let { name, unit, direction } = req.body
    let metric: string | null = null

    if (kind === 'auto') {
      const def = getAutoMetric(String(req.body.metric))
      if (!def) return void fail(res, 400, "Noma'lum avtomatik ko'rsatkich")
      const dup = await (prisma as any).ekoHisobKpiIndicator.findFirst({
        where: { orgId, kind: 'auto', metric: def.key, isActive: true },
      })
      if (dup) return void fail(res, 409, "Bu ko'rsatkich allaqachon qo'shilgan")
      metric = def.key
      name = name?.toString().trim() || def.label
      unit = def.unit
      direction = def.direction // avto-ko'rsatkichning ma'nosi qat'iy
    }

    const err = validateIndicatorInput({ name, weight: req.body.weight, target: req.body.target, direction })
    if (err) return void fail(res, 400, err)

    const count = await (prisma as any).ekoHisobKpiIndicator.count({ where: { orgId } })
    const created = await (prisma as any).ekoHisobKpiIndicator.create({
      data: {
        orgId, kind, metric, name: String(name).trim(), unit: String(unit ?? '').trim().slice(0, 20),
        direction, target: Number(req.body.target), weight: Math.round(Number(req.body.weight)), sortOrder: count,
      },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.indicator_create', targetType: 'kpi', targetId: created.id, targetName: created.name,
      details: { kind, metric, target: created.target, weight: created.weight },
    })
    res.status(201).json({ success: true, data: created })
  } catch (err) { next(err) }
}

export async function updateKpiIndicator(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const existing = await (prisma as any).ekoHisobKpiIndicator.findFirst({ where: { id: req.params.id, orgId } })
    if (!existing) return void fail(res, 404, "Ko'rsatkich topilmadi")

    const merged = {
      name: req.body.name ?? existing.name,
      weight: req.body.weight ?? existing.weight,
      target: req.body.target ?? existing.target,
      // Avtomatik ko'rsatkichning yo'nalishi o'zgarmaydi
      direction: existing.kind === 'auto' ? existing.direction : (req.body.direction ?? existing.direction),
    }
    const err = validateIndicatorInput(merged)
    if (err) return void fail(res, 400, err)

    const data: any = {
      name: String(merged.name).trim(),
      weight: Math.round(Number(merged.weight)),
      target: Number(merged.target),
      direction: merged.direction,
    }
    if (existing.kind === 'manual' && req.body.unit !== undefined) data.unit = String(req.body.unit).trim().slice(0, 20)
    if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive)
    if (req.body.sortOrder !== undefined) data.sortOrder = Math.round(Number(req.body.sortOrder)) || 0

    const updated = await (prisma as any).ekoHisobKpiIndicator.update({ where: { id: existing.id }, data })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.indicator_update', targetType: 'kpi', targetId: existing.id, targetName: updated.name,
      details: {
        before: { name: existing.name, weight: existing.weight, target: existing.target, isActive: existing.isActive },
        after: { name: updated.name, weight: updated.weight, target: updated.target, isActive: updated.isActive },
      },
    })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}

/** O'chirish = nofaol qilish: qo'lda kiritilgan tarixiy qiymatlar saqlanib qoladi. */
export async function deactivateKpiIndicator(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const existing = await (prisma as any).ekoHisobKpiIndicator.findFirst({ where: { id: req.params.id, orgId } })
    if (!existing) return void fail(res, 404, "Ko'rsatkich topilmadi")
    await (prisma as any).ekoHisobKpiIndicator.update({ where: { id: existing.id }, data: { isActive: false } })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.indicator_update', targetType: 'kpi', targetId: existing.id, targetName: existing.name,
      details: { deactivated: true },
    })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}

// ─── Natijalar ───────────────────────────────────────────────────────────────

export async function getKpiResults(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const month = monthParam(req)
    if (!month) return void fail(res, 400, "Oy formati noto'g'ri (YYYY-MM)")
    res.json({ success: true, data: await buildMonthResults(req.ekoUser!.orgId, month) })
  } catch (err) { next(err) }
}

/**
 * GET /kpi/my — xodim FAQAT o'z natijasini ko'radi (ochiq reyting yo'q: boshqalar ko'rinmaydi).
 * Admin/boshliq uchun KPI yo'q — `applicable: false`.
 */
export async function getMyKpi(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id, role } = req.ekoUser!
    const month = monthParam(req)
    if (!month) return void fail(res, 400, "Oy formati noto'g'ri (YYYY-MM)")
    if (role !== 'inspector') {
      res.json({ success: true, data: { applicable: false } })
      return
    }
    const data = await buildMonthResults(orgId, month, { onlyUserId: id })
    const mine = data.rows[0] ?? null
    res.json({
      success: true,
      data: {
        applicable: true,
        month: data.month,
        status: data.status,
        scheme: { bonusMax: data.scheme.bonusMax, minScore: data.scheme.minScore },
        result: mine,
      },
    })
  } catch (err) { next(err) }
}

export async function exportKpiXlsx(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const month = monthParam(req)
    if (!month) return void fail(res, 400, "Oy formati noto'g'ri (YYYY-MM)")
    const data = await buildMonthResults(req.ekoUser!.orgId, month)

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    const ws = wb.addWorksheet(`KPI ${month}`)
    const active = data.indicators.filter(i => i.weight > 0)
    ws.columns = [
      { header: 'Xodim', key: 'name', width: 28 },
      { header: 'Ball', key: 'score', width: 10 },
      { header: "Bonus (so'm)", key: 'bonus', width: 16 },
      { header: 'Tuzatish (ball)', key: 'adjP', width: 14 },
      { header: "Tuzatish (so'm)", key: 'adjB', width: 16 },
      ...active.map(i => ({ header: `${i.name} (${i.weight}%)`, key: `i_${i.id}`, width: 22 })),
    ]
    ws.getRow(1).font = { bold: true }
    for (const r of data.rows) {
      const row: Record<string, unknown> = {
        name: r.fullName, score: r.score, bonus: r.bonus, adjP: r.adjustmentPoints, adjB: r.bonusDelta,
      }
      for (const i of active) {
        const it = r.items.find(x => x.id === i.id)
        row[`i_${i.id}`] = it && it.value !== null ? `${it.value} / ${it.target} → ${it.achievement}%` : 'kiritilmagan'
      }
      ws.addRow(row)
    }
    const total = ws.addRow({ name: `JAMI (${uzMonth(month)}, ${data.status === 'closed' ? 'yopilgan' : 'ochiq'})`, bonus: data.totalBonus })
    total.font = { bold: true }
    ws.getColumn('bonus').numFmt = '# ##0'

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="ekohisob_kpi_${month}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

// ─── Qo'lda qiymat va tuzatish (faqat ochiq davrda) ──────────────────────────

export async function setKpiEntry(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: actorId } = req.ekoUser!
    const { indicatorId, userId, month, note } = req.body
    if (!validMonth(String(month))) return void fail(res, 400, "Oy formati noto'g'ri")
    if (await isPeriodClosed(orgId, month)) return void fail(res, 409, 'Bu oy yopilgan. Avval qayta oching.')

    const [indicator, user] = await Promise.all([
      (prisma as any).ekoHisobKpiIndicator.findFirst({ where: { id: String(indicatorId), orgId } }),
      findInspector(orgId, String(userId)),
    ])
    if (!indicator || indicator.kind !== 'manual') return void fail(res, 400, "Faqat qo'lda ko'rsatkichga qiymat kiritiladi")
    if (!user) return void fail(res, 404, 'Xodim topilmadi')

    const where = { indicatorId_userId_month: { indicatorId: indicator.id, userId: user.id, month } }
    const raw = req.body.value
    if (raw === null || raw === '' || raw === undefined) {
      await (prisma as any).ekoHisobKpiEntry.deleteMany({ where: { indicatorId: indicator.id, userId: user.id, month, orgId } })
      await logEkoAudit(req.ekoUser, {
        action: 'kpi.entry', targetType: 'kpi', targetId: indicator.id, targetName: `${indicator.name} — ${user.fullName}`,
        details: { month, cleared: true },
      })
      res.json({ success: true, data: null })
      return
    }

    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || value > 1e12) return void fail(res, 400, "Qiymat noto'g'ri")
    const prev = await (prisma as any).ekoHisobKpiEntry.findUnique({ where })
    const entry = await (prisma as any).ekoHisobKpiEntry.upsert({
      where,
      create: { orgId, indicatorId: indicator.id, userId: user.id, month, value, note: note ? String(note).slice(0, 300) : null, updatedBy: actorId },
      update: { value, note: note ? String(note).slice(0, 300) : null, updatedBy: actorId },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.entry', targetType: 'kpi', targetId: indicator.id, targetName: `${indicator.name} — ${user.fullName}`,
      details: { month, from: prev?.value ?? null, to: value },
    })
    res.json({ success: true, data: entry })
  } catch (err) { next(err) }
}

export async function createKpiAdjustment(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: actorId } = req.ekoUser!
    const { userId, month } = req.body
    const points = Number(req.body.points ?? 0)
    const bonusDelta = Math.round(Number(req.body.bonusDelta ?? 0))
    const reason = String(req.body.reason ?? '').trim()

    if (!validMonth(String(month))) return void fail(res, 400, "Oy formati noto'g'ri")
    if (!Number.isFinite(points) || Math.abs(points) > 100) return void fail(res, 400, "Ball tuzatishi −100…100 oralig'ida bo'lishi kerak")
    if (!Number.isFinite(bonusDelta) || Math.abs(bonusDelta) > 100_000_000) return void fail(res, 400, "Bonus tuzatishi noto'g'ri")
    if (points === 0 && bonusDelta === 0) return void fail(res, 400, "Ball yoki bonus tuzatishini kiriting")
    const reasonErr = validateAdjustmentReason(reason)
    if (reasonErr) return void fail(res, 400, reasonErr)
    if (await isPeriodClosed(orgId, month)) return void fail(res, 409, 'Bu oy yopilgan. Avval qayta oching.')

    const user = await findInspector(orgId, String(userId))
    if (!user) return void fail(res, 404, 'Xodim topilmadi')

    // Bonus tuzatish chegarasi: bir xodim uchun oy bo'yicha sof jami bonusMax ning 50% idan oshmasin
    if (bonusDelta !== 0) {
      const [scheme, prior] = await Promise.all([
        loadScheme(orgId),
        (prisma as any).ekoHisobKpiAdjustment.aggregate({
          where: { orgId, userId: user.id, month }, _sum: { bonusDelta: true },
        }),
      ])
      const check = checkBonusAdjustment({
        bonusMax: scheme.bonusMax, existingNetDelta: prior._sum.bonusDelta ?? 0, newDelta: bonusDelta,
      })
      if (!check.ok) {
        res.status(422).json({ success: false, error: check.error, code: 'ADJUST_LIMIT', limit: check.limit })
        return
      }
    }

    const created = await (prisma as any).ekoHisobKpiAdjustment.create({
      data: { orgId, userId: user.id, month, points, bonusDelta, reason: reason.slice(0, 300), createdBy: actorId },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.adjust', targetType: 'kpi', targetId: created.id, targetName: user.fullName,
      amount: bonusDelta || null, details: { month, points, bonusDelta, reason },
    })
    res.status(201).json({ success: true, data: created })
  } catch (err) { next(err) }
}

export async function deleteKpiAdjustment(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const adj = await (prisma as any).ekoHisobKpiAdjustment.findFirst({ where: { id: req.params.id, orgId } })
    if (!adj) return void fail(res, 404, 'Tuzatish topilmadi')
    if (await isPeriodClosed(orgId, adj.month)) return void fail(res, 409, 'Bu oy yopilgan. Avval qayta oching.')
    await (prisma as any).ekoHisobKpiAdjustment.delete({ where: { id: adj.id } })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.adjust_delete', targetType: 'kpi', targetId: adj.id,
      amount: adj.bonusDelta || null,
      details: { month: adj.month, userId: adj.userId, points: adj.points, bonusDelta: adj.bonusDelta, reason: adj.reason },
    })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}

// ─── Oy davri: yopish / qayta ochish ─────────────────────────────────────────

export async function closeKpiPeriod(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: actorId } = req.ekoUser!
    const month = req.params.month
    const force = req.body?.force === true
    if (!validMonth(month)) return void fail(res, 400, "Oy formati noto'g'ri")

    const closed = await isPeriodClosed(orgId, month)
    const results = await buildMonthResults(orgId, month)
    const missing = results.rows
      .filter(r => r.missingCount > 0)
      .map(r => ({
        userId: r.userId, fullName: r.fullName, missingCount: r.missingCount,
        indicators: r.items.filter(i => i.weight > 0 && i.value === null).map(i => i.name),
      }))
    const missingTotal = missing.reduce((sum, m) => sum + m.missingCount, 0)

    const decision = decideClose({
      month, currentMonth: currentMonthUz(), alreadyClosed: closed, missingTotal, force,
    })
    if (!decision.ok) {
      res.status(decision.status).json({
        success: false, error: decision.error, code: decision.code,
        ...(decision.code === 'MISSING_VALUES' ? { missing } : {}),
      })
      return
    }

    const snapshot = JSON.parse(JSON.stringify(results)) // Date → string, Prisma Json uchun
    await (prisma as any).ekoHisobKpiPeriod.upsert({
      where: { orgId_month: { orgId, month } },
      create: { orgId, month, status: 'closed', snapshot, closedAt: new Date(), closedBy: actorId },
      update: { status: 'closed', snapshot, closedAt: new Date(), closedBy: actorId },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.close', targetType: 'kpi', targetName: `KPI ${month}`,
      amount: results.totalBonus,
      details: {
        month, employees: results.rows.length, totalBonus: results.totalBonus,
        forced: decision.forced, missing: decision.forced ? missing : undefined,
        rows: results.rows.map(r => ({ userId: r.userId, name: r.fullName, score: r.score, bonus: r.bonus })),
      },
    })
    res.json({ success: true, data: { month, totalBonus: results.totalBonus, forced: decision.forced } })
  } catch (err) { next(err) }
}

export async function reopenKpiPeriod(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const month = req.params.month
    const reason = String(req.body.reason ?? '').trim()
    if (!validMonth(month)) return void fail(res, 400, "Oy formati noto'g'ri")
    if (reason.length < 10) return void fail(res, 400, "Qayta ochish sababi kamida 10 belgi bo'lishi shart")

    const period = await (prisma as any).ekoHisobKpiPeriod.findUnique({ where: { orgId_month: { orgId, month } } })
    if (!period || period.status !== 'closed') return void fail(res, 409, 'Bu oy yopilmagan')

    const snap = period.snapshot as any
    const prevBonus = snap?.totalBonus ?? null
    // Eski snapshot O'CHIRILMAYDI (bonus tarixi): davr 'open' bo'ladi (buildMonthResults faqat
    // status='closed' da snapshotni o'qiydi), qayta yopilganda yangisi bilan almashadi.
    // Qo'shimcha: to'liq xodim/ball/bonus ro'yxati audit jurnaliga yoziladi.
    await (prisma as any).ekoHisobKpiPeriod.update({
      where: { id: period.id },
      data: { status: 'open', closedAt: null, closedBy: null, reopenedCount: { increment: 1 } },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'kpi.reopen', targetType: 'kpi', targetName: `KPI ${month}`,
      amount: prevBonus,
      details: {
        month, reason, previousTotalBonus: prevBonus, previousClosedAt: period.closedAt ?? null,
        previousRows: Array.isArray(snap?.rows)
          ? snap.rows.map((r: any) => ({ userId: r.userId, name: r.fullName, score: r.score, bonus: r.bonus, bonusDelta: r.bonusDelta }))
          : null,
      },
    })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
