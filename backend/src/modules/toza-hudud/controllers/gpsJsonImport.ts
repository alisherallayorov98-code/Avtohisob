import { Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { prisma } from '../../../lib/prisma'

export const gpsJsonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_, file, cb) => {
    if (file.originalname.match(/\.json$/i)) cb(null, true)
    else cb(new Error('Faqat JSON fayl qabul qilinadi'))
  },
})

interface GpsZone {
  id: number
  name: string
  type: string
  points: Array<{ x: number; y: number; r?: number }>
}

export async function importGpsJson(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'JSON fayl talab qilinadi' })
    }

    const { districtId } = req.body

    let zones: GpsZone[]
    try {
      zones = JSON.parse(req.file.buffer.toString('utf-8'))
    } catch {
      return res.status(400).json({ success: false, error: 'JSON fayl noto\'g\'ri formatda' })
    }

    if (!Array.isArray(zones)) {
      return res.status(400).json({ success: false, error: 'JSON massiv bo\'lishi kerak' })
    }

    // Faqat polygonlarni olamiz
    const polygons = zones.filter(z => z.type === 'polygon' && Array.isArray(z.points) && z.points.length >= 3)

    if (polygons.length === 0) {
      return res.status(400).json({ success: false, error: 'JSON faylda polygon topilmadi' })
    }

    let updated = 0
    let notFound = 0

    for (const zone of polygons) {
      const coords = zone.points.map(p => [p.x, p.y])
      // Polygon yopish
      if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
        coords.push(coords[0])
      }

      const polygon = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { name: zone.name },
      }

      const where: any = { name: { equals: zone.name.trim(), mode: 'insensitive' } }
      if (districtId) where.districtId = districtId

      const result = await (prisma as any).thMfy.updateMany({ where, data: { polygon } })

      if (result.count > 0) updated += result.count
      else notFound++
    }

    res.json({
      success: true,
      data: { updated, notFound, total: polygons.length, circles: zones.length - polygons.length },
      message: `${updated} ta MFY polygon yangilandi, ${notFound} ta nom topilmadi`,
    })
  } catch (err) { next(err) }
}
