import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { getWialonGeozones, syncMfyPolygonsFromGps } from '../../../services/wialonService'

// Wialon geozonaları → frontend ga qaytaradi
export async function getGeozones(req: Request, res: Response, next: NextFunction) {
  try {
    const zones = await getWialonGeozones()
    res.json({ success: true, data: zones })
  } catch (err) { next(err) }
}

// Geozona polygon → MFY ga yozish
export async function linkGeozoneMfy(req: Request, res: Response, next: NextFunction) {
  try {
    const { mfyId, points } = req.body
    if (!mfyId || !Array.isArray(points) || points.length < 3) {
      return res.status(400).json({ success: false, error: 'mfyId va kamida 3 nuqta talab qilinadi' })
    }

    // GeoJSON Polygon formatiga o'tkazish
    const coords = [...points.map((p: any) => [p.lon, p.lat])]
    coords.push(coords[0]) // yopish
    const polygon = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: {},
    }

    await (prisma as any).thMfy.update({
      where: { id: mfyId },
      data: { polygon },
    })

    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}

// SmartGPS geozonaları asosida MFYlarni avtomatik yaratish
export async function importMfysFromGeozones(req: Request, res: Response, next: NextFunction) {
  try {
    const { districtId } = req.body
    if (!districtId) {
      return res.status(400).json({ success: false, error: 'districtId talab qilinadi' })
    }

    const district = await (prisma as any).thDistrict.findUnique({ where: { id: districtId } })
    if (!district) {
      return res.status(404).json({ success: false, error: 'Tuman topilmadi' })
    }

    const zones = await getWialonGeozones()
    if (zones.length === 0) {
      return res.json({ success: true, data: { created: 0, skipped: 0, total: 0 } })
    }

    // Mavjud MFY nomlarini olish (dublikat oldini olish)
    const existing = await (prisma as any).thMfy.findMany({
      where: { districtId },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((m: any) => m.name.trim().toLowerCase()))

    let created = 0
    let skipped = 0

    for (const zone of zones) {
      const nameLower = zone.name.trim().toLowerCase()
      if (existingNames.has(nameLower)) { skipped++; continue }

      const coords = [...zone.points.map(p => [p.lon, p.lat])]
      coords.push(coords[0])
      const polygon = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {},
      }

      await (prisma as any).thMfy.create({
        data: { name: zone.name.trim(), districtId, polygon },
      })
      existingNames.add(nameLower)
      created++
    }

    res.json({ success: true, data: { created, skipped, total: zones.length } })
  } catch (err) { next(err) }
}

// SmartGPS dan to'g'ridan-to'g'ri MFY polygonlarini sinxronlash (bitta tugma)
export async function syncPolygonsFromGps(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await syncMfyPolygonsFromGps()
    res.json({
      success: true,
      data: result,
      message: `${result.updated} ta MFY yangilandi, ${result.notFound} ta nom topilmadi (${result.total} polygon)`,
    })
  } catch (err) { next(err) }
}

