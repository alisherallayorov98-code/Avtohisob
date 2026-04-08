import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { generateArticleCode, getArticleCode, getAllArticleCodes } from '../services/articleCodeService'
import { generateQRBuffer, generateQRDataUrl } from '../services/qrCodeService'
import { AppError } from '../middleware/errorHandler'

export async function listArticleCodes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit } = paginate(req.query)
    const result = await getAllArticleCodes(page, limit)
    res.json(successResponse(result.data, undefined, {
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    }))
  } catch (err) { next(err) }
}

export async function getCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sparePartId } = req.params
    const code = await getArticleCode(sparePartId)
    res.json(successResponse(code))
  } catch (err) { next(err) }
}

export async function generateCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sparePartId } = req.body
    if (!sparePartId) throw new AppError('sparePartId talab qilinadi', 400)
    const code = await generateArticleCode(sparePartId)
    const articleCode = await getArticleCode(sparePartId)
    res.json(successResponse({ code, articleCode }, 'Artikul kod yaratildi'))
  } catch (err) { next(err) }
}

export async function getQRCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sparePartId } = req.params
    const articleCode = await getArticleCode(sparePartId)
    if (!articleCode) throw new AppError('Artikul kod topilmadi', 404)

    const sparePart = await prisma.sparePart.findUnique({
      where: { id: sparePartId },
      select: { name: true, partCode: true },
    })

    const format = (req.query.format as string) || 'png'

    if (format === 'dataurl') {
      const dataUrl = await generateQRDataUrl({
        code: articleCode.code,
        id: sparePartId,
        name: sparePart?.name,
      })
      return res.json(successResponse({ dataUrl, code: articleCode.code }))
    }

    const buffer = await generateQRBuffer({
      code: articleCode.code,
      id: sparePartId,
      name: sparePart?.name,
    })

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', `inline; filename="${articleCode.code}-qr.png"`)
    res.send(buffer)
  } catch (err) { next(err) }
}

export async function getCodeStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [total, byCategory] = await Promise.all([
      prisma.articleCode.count(),
      prisma.articleCode.groupBy({
        by: ['prefix'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ])
    res.json(successResponse({ total, byCategory }))
  } catch (err) { next(err) }
}
