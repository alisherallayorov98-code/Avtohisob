import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { getWialonGeozones } from '../../../services/wialonService'

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

// Barcha geozonaları nomi bo'yicha MFYlarga avtomatik biriktirish
export async function autoImportGeozones(req: Request, res: Response, next: NextFunction) {
  try {
    const zones = await getWialonGeozones()
    if (zones.length === 0) {
      return res.json({ success: true, data: { matched: 0, total: 0 } })
    }

    const mfys = await (prisma as any).thMfy.findMany({
      select: { id: true, name: true },
    })

    // Nomi bo'yicha moslashtirish (katta-kichik harf farqi yo'q)
    const mfyMap = new Map<string, string>()
    for (const mfy of mfys) {
      mfyMap.set(mfy.name.trim().toLowerCase(), mfy.id)
    }

    let matched = 0
    for (const zone of zones) {
      const mfyId = mfyMap.get(zone.name.trim().toLowerCase())
      if (!mfyId) continue

      const coords = [...zone.points.map(p => [p.lon, p.lat])]
      coords.push(coords[0])
      const polygon = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {},
      }

      await (prisma as any).thMfy.update({
        where: { id: mfyId },
        data: { polygon },
      })
      matched++
    }

    res.json({ success: true, data: { matched, total: zones.length } })
  } catch (err) { next(err) }
}
