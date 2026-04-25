import { Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { prisma } from '../../../lib/prisma'

export const kmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_, file, cb) => {
    if (file.originalname.match(/\.(kml|kmz)$/i)) cb(null, true)
    else cb(new Error('Faqat KML fayl qabul qilinadi'))
  },
})

interface ParsedPlace {
  name: string
  coordinates: Array<{ lat: number; lon: number }>
}

function parseKml(kmlText: string): ParsedPlace[] {
  const places: ParsedPlace[] = []

  // Har bir Placemark ni ajratamiz
  const placemarkRe = /<Placemark[\s\S]*?<\/Placemark>/gi
  const placemarks = kmlText.match(placemarkRe) || []

  for (const pm of placemarks) {
    // Nom
    const nameMatch = pm.match(/<name>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/name>|<name>([\s\S]*?)<\/name>/i)
    const name = (nameMatch?.[1] || nameMatch?.[2] || '').trim()
    if (!name) continue

    // Polygon koordinatalari (outerBoundaryIs yoki to'g'ridan koordinatalar)
    const coordMatch = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/i)
    if (!coordMatch) continue

    const rawCoords = coordMatch[1].trim()
    const points: Array<{ lat: number; lon: number }> = []

    // "lon,lat,alt" yoki "lon,lat" formatida bo'sh joy yoki \n bilan ajratilgan
    const coordPairs = rawCoords.split(/\s+/).filter(s => s.includes(','))
    for (const pair of coordPairs) {
      const parts = pair.split(',')
      const lon = parseFloat(parts[0])
      const lat = parseFloat(parts[1])
      if (!isNaN(lon) && !isNaN(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        points.push({ lat, lon })
      }
    }

    if (points.length >= 3) {
      places.push({ name, coordinates: points })
    }
  }

  return places
}

export async function importKml(req: Request, res: Response, next: NextFunction) {
  try {
    const { districtId } = req.body
    if (!districtId) {
      return res.status(400).json({ success: false, error: 'districtId talab qilinadi' })
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'KML fayl talab qilinadi' })
    }

    const district = await (prisma as any).thDistrict.findUnique({ where: { id: districtId } })
    if (!district) {
      return res.status(404).json({ success: false, error: 'Tuman topilmadi' })
    }

    const kmlText = req.file.buffer.toString('utf-8')
    const places = parseKml(kmlText)

    if (places.length === 0) {
      return res.status(400).json({ success: false, error: 'KML faylda polygon topilmadi' })
    }

    // Mavjud MFYlarni tekshirish
    const existing = await (prisma as any).thMfy.findMany({
      where: { districtId },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((m: any) => m.name.trim().toLowerCase()))

    let created = 0
    let updated = 0
    let skipped = 0

    for (const place of places) {
      const coords = [...place.coordinates.map(p => [p.lon, p.lat])]
      coords.push(coords[0]) // polygon yopish
      const polygon = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { name: place.name },
      }

      const nameLower = place.name.trim().toLowerCase()
      if (existingNames.has(nameLower)) {
        // Mavjud MFY polygonini yangilash
        await (prisma as any).thMfy.updateMany({
          where: { districtId, name: { equals: place.name.trim(), mode: 'insensitive' } },
          data: { polygon },
        })
        updated++
      } else {
        await (prisma as any).thMfy.create({
          data: { name: place.name.trim(), districtId, polygon },
        })
        existingNames.add(nameLower)
        created++
      }
    }

    res.json({
      success: true,
      data: { created, updated, skipped, total: places.length },
      message: `${created} ta yangi MFY, ${updated} ta mavjud yangilandi`,
    })
  } catch (err) { next(err) }
}
