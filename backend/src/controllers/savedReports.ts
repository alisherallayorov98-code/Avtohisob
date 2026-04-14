import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

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
    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw new AppError('Hisobot topilmadi', 404)
    if (report.createdById !== req.user!.id && req.user!.role !== 'admin') {
      throw new AppError('Bu hisobotga kirish huquqingiz yo\'q', 403)
    }
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
    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw new AppError('Hisobot topilmadi', 404)
    if (report.createdById !== req.user!.id && req.user!.role !== 'admin') {
      throw new AppError('Ruxsat yo\'q', 403)
    }
    await prisma.report.delete({ where: { id } })
    res.json(successResponse(null, 'Hisobot o\'chirildi'))
  } catch (err) { next(err) }
}
