// Savdo — yig'im turlari katalogi (utilizatsiya yig'imi va shunga o'xshash) va eng kam oylik ish haqi.
// Hisob: lib/levyCalc.ts. Ko'rish — kirim huquqi bor har kimga; boshqarish — faqat admin.

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { isLevyBasis } from '../lib/levyCalc'

const MAX_PERCENT = 100000 // 1000 baravar — bir nol ortiq yozishni ushlaydi

function serialize(r: any) {
  return { id: r.id, name: r.name, basis: r.basis, percent: Number(r.percent), isActive: r.isActive }
}

export async function listLevies(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const [rates, settings] = await Promise.all([
      (prisma as any).savdoLevyRate.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
      (prisma as any).savdoOrgSettings.findUnique({ where: { orgId }, select: { minimumWage: true } }),
    ])
    res.json({
      success: true,
      data: {
        rates: rates.map(serialize),
        minimumWage: settings?.minimumWage != null ? Number(settings.minimumWage) : null,
      },
    })
  } catch (err) { next(err) }
}

function readBody(b: any, partial: boolean): { data?: any; error?: string } {
  const data: any = {}
  if (!partial || b.name !== undefined) {
    const name = String(b.name ?? '').trim().slice(0, 120)
    if (!name) return { error: 'Nomini kiriting' }
    data.name = name
  }
  if (!partial || b.basis !== undefined) {
    if (!isLevyBasis(b.basis)) return { error: 'Asos: per_kg (kg uchun) yoki per_unit (dona uchun)' }
    data.basis = b.basis
  }
  if (!partial || b.percent !== undefined) {
    const pct = Number(b.percent)
    if (!Number.isFinite(pct) || pct < 0 || pct > MAX_PERCENT) return { error: 'Foiz noto\'g\'ri' }
    data.percent = pct
  }
  if (b.isActive !== undefined) data.isActive = Boolean(b.isActive)
  return { data }
}

export async function createLevy(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const r = readBody(req.body, false)
    if (r.error) { res.status(400).json({ success: false, error: r.error }); return }
    const created = await (prisma as any).savdoLevyRate.create({ data: { orgId, ...r.data } })
    res.status(201).json({ success: true, data: serialize(created), message: 'Yig\'im turi qo\'shildi' })
  } catch (err) { next(err) }
}

export async function updateLevy(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const existing = await (prisma as any).savdoLevyRate.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Yig\'im turi topilmadi' })
      return
    }
    const r = readBody(req.body, true)
    if (r.error) { res.status(400).json({ success: false, error: r.error }); return }
    // Eslatma: o'tgan kirim hujjatlari o'z qatorlarida foiz/asosni SAQLAYDI (snapshot) —
    // bu yerdagi o'zgarish ularni qayta hisoblamaydi.
    const updated = await (prisma as any).savdoLevyRate.update({ where: { id: existing.id }, data: r.data })
    res.json({ success: true, data: serialize(updated), message: 'Yangilandi' })
  } catch (err) { next(err) }
}

export async function setMinimumWage(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const raw = req.body.minimumWage
    const value = raw === null || raw === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000)) {
      res.status(400).json({ success: false, error: 'Eng kam oylik ish haqi noto\'g\'ri' })
      return
    }
    await (prisma as any).savdoOrgSettings.upsert({
      where: { orgId },
      create: { orgId, minimumWage: value },
      update: { minimumWage: value },
    })
    res.json({ success: true, data: { minimumWage: value }, message: 'Saqlandi' })
  } catch (err) { next(err) }
}
