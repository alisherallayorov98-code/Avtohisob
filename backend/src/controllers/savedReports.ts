import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

async function assertReportAccess(reportId: string, user: { id: string; role: string; branchId?: string | null }) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { createdBy: { select: { id: true, branchId: true } } },
  })
  if (!report) throw new AppError('Hisobot topilmadi', 404)
  if (user.role === 'super_admin') return report
  // Owner har doim o'z hisobotini ko'ra oladi
  if (report.createdById === user.id) return report
  // Org admin: faqat o'z org'idagi hisobotlar
  const filter = await getOrgFilter(user)
  const creatorBranch = report.createdBy.branchId
  if (!creatorBranch || !isBranchAllowed(filter, creatorBranch)) {
    throw new AppError('Bu hisobotga kirish huquqingiz yo\'q', 403)
  }
  // branch_manager/operator faqat o'z hisobotlarini ko'radi (owner check yuqorida)
  if (['branch_manager', 'operator'].includes(user.role)) {
    throw new AppError('Bu hisobotga kirish huquqingiz yo\'q', 403)
  }
  return report
}

export async function listSavedReports(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    // super_admin sees all; org admin sees reports by their org's users; others see own
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const where: any = filter.type === 'none'
      ? {}                                              // super_admin: unrestricted
      : bv !== undefined
        ? { createdBy: { branchId: bv } }              // org admin: own org's reports
        : { createdById: req.user!.id }                // branch_manager/operator: own only

    const [data, total] = await Promise.all([
      prisma.report.findMany({
        where,
        select: {
          id: true, name: true, type: true, filters: true, createdAt: true,
          createdBy: { select: { fullName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.report.count({ where }),
    ])

    res.json(successResponse(data, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

export async function getSavedReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const report = await assertReportAccess(id, req.user!)
    res.json(successResponse(report))
  } catch (err) { next(err) }
}

export async function saveReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, type, filters, data } = req.body
    if (!name || !type) throw new AppError('name va type talab qilinadi', 400)

    const report = await prisma.report.create({
      data: {
        name,
        type,
        filters: filters || null,
        data: data || {},
        createdById: req.user!.id,
      },
    })
    res.status(201).json(successResponse(report, 'Hisobot saqlandi'))
  } catch (err) { next(err) }
}

export async function deleteSavedReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    await assertReportAccess(id, req.user!)
    await prisma.report.delete({ where: { id } })
    res.json(successResponse(null, 'Hisobot o\'chirildi'))
  } catch (err) { next(err) }
}
