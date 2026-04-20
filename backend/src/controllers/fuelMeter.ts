import { Response, NextFunction } from 'express'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, isBranchAllowed, resolveOrgId } from '../lib/orgFilter'

let openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new AppError('OpenAI API key sozlanmagan', 503)
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openai
}

export async function analyzeMeterImage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Rasm yuklanmadi', 400)

    const orgId = await resolveOrgId(req.user!)
    // Tenant isolation: fuelRecordId berilgan bo'lsa, o'sha record org'iga tegishliligini tekshirish
    const bodyFuelRecordId = req.body.fuelRecordId || null
    if (bodyFuelRecordId) {
      const fr = await prisma.fuelRecord.findUnique({
        where: { id: bodyFuelRecordId },
        include: { vehicle: { select: { branchId: true } } },
      })
      if (!fr) throw new AppError('Yoqilg\'i yozuvi topilmadi', 404)
      const filter = await getOrgFilter(req.user!)
      if (!isBranchAllowed(filter, fr.vehicle.branchId)) {
        throw new AppError('Bu yoqilg\'i yozuviga ruxsat yo\'q', 403)
      }
    }

    const imageUrl = `/uploads/${req.file.filename}`
    const reading = await prisma.fuelMeterReading.create({
      data: { imageUrl, status: 'processing' },
    })

    const startTime = Date.now()
    try {
      const imagePath = path.join(process.cwd(), 'uploads', req.file.filename)
      const imageData = fs.readFileSync(imagePath)
      const base64Image = imageData.toString('base64')
      const mimeType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Ushbu rasmda gaz/benzin hisoblagichining ko\'rsatgichi ko\'rsatilgan. Hisoblagichning ko\'rsatgichidagi raqamlarni o\'qib, faqat raqamni qaytaring. Agar rasmda hisoblagich ko\'rinmasa yoki raqamni aniq o\'qib bo\'lmasa, "UNABLE_TO_READ" qaytaring. Faqat raqamni qaytaring, boshqa hech nima yozmayin.',
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        }],
        max_tokens: 50,
      })

      const latencyMs = Date.now() - startTime
      const rawText = response.choices[0].message.content?.trim() || ''
      const isUnable = rawText === 'UNABLE_TO_READ' || isNaN(parseFloat(rawText))
      const extractedValue = isUnable ? null : parseFloat(rawText)
      // Haqiqiy confidence OpenAI'dan kelmaydi: muvaffaqiyatli parse bo'lsa null (noma'lum),
      // parse bo'lmasa 0. Oldingi Math.random() soxta edi — olib tashlandi.
      const confidenceScore = isUnable ? 0 : null

      const updated = await prisma.fuelMeterReading.update({
        where: { id: reading.id },
        data: {
          extractedValue, confidenceScore, rawOcrText: rawText,
          processedAt: new Date(), status: isUnable ? 'failed' : 'success',
          fuelRecordId: bodyFuelRecordId,
        },
      })

      // Log AI usage non-blocking
      ;(prisma as any).aIAnalysisLog.create({
        data: {
          entityType: 'fuel_meter',
          entityId: reading.id,
          model: 'gpt-4o-mini',
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          latencyMs,
          success: !isUnable,
          inputSummary: `fuel_meter_image:${req.file?.filename}`,
          outputSummary: JSON.stringify({ extractedValue, confidenceScore, rawText }),
          organizationId: orgId,
        },
      }).catch(() => {})

      res.json(successResponse(updated, isUnable ? 'Hisoblagich o\'qib bo\'lmadi' : 'Muvaffaqiyatli tahlil qilindi'))
    } catch (aiErr) {
      const latencyMs = Date.now() - startTime
      ;(prisma as any).aIAnalysisLog.create({
        data: {
          entityType: 'fuel_meter',
          entityId: reading.id,
          model: 'gpt-4o-mini',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs,
          success: false,
          errorMessage: String(aiErr),
          organizationId: orgId,
        },
      }).catch(() => {})
      await prisma.fuelMeterReading.update({ where: { id: reading.id }, data: { status: 'failed' } })
      throw new AppError('AI tahlilida xato yuz berdi', 500)
    }
  } catch (err) { next(err) }
}

export async function getMeterReading(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const reading = await prisma.fuelMeterReading.findUnique({
      where: { id: req.params.id },
      include: { fuelRecord: { include: { vehicle: { select: { branchId: true } } } } },
    })
    if (!reading) throw new AppError('Tahlil topilmadi', 404)
    // Org access check: if linked to a fuel record, verify vehicle's branch
    if (reading.fuelRecord) {
      const filter = await getOrgFilter(req.user!)
      if (!isBranchAllowed(filter, reading.fuelRecord.vehicle.branchId)) {
        throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
      }
    }
    res.json(successResponse(reading))
  } catch (err) { next(err) }
}

export async function getMeterHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    // For org-scoped users: only show readings linked to their org's vehicles
    const where: any = {}
    if (bv !== undefined) {
      where.fuelRecord = { vehicle: { branchId: bv } }
    }
    const readings = await prisma.fuelMeterReading.findMany({
      where,
      orderBy: { createdAt: 'desc' }, take: 50,
      include: { fuelRecord: { include: { vehicle: { select: { registrationNumber: true } } } } },
    })
    res.json(successResponse(readings))
  } catch (err) { next(err) }
}

export async function updateMeterReading(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { extractedValue } = req.body
    const val = parseFloat(extractedValue)
    if (isNaN(val) || val < 0) throw new AppError('Qiymat noto\'g\'ri (musbat raqam bo\'lishi kerak)', 400)

    const existing = await prisma.fuelMeterReading.findUnique({
      where: { id: req.params.id },
      include: { fuelRecord: { include: { vehicle: { select: { branchId: true } } } } },
    })
    if (!existing) throw new AppError('Tahlil topilmadi', 404)
    // Tenant isolation: reading bog'langan fuel record bo'lsa, vehicle org'ini tekshirish
    if (existing.fuelRecord) {
      const filter = await getOrgFilter(req.user!)
      if (!isBranchAllowed(filter, existing.fuelRecord.vehicle.branchId)) {
        throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
      }
    }

    const reading = await prisma.fuelMeterReading.update({
      where: { id: req.params.id },
      data: { extractedValue: val, status: 'manually_corrected' },
    })
    res.json(successResponse(reading, 'Qiymat yangilandi'))
  } catch (err) { next(err) }
}
