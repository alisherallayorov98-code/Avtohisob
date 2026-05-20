import { prisma } from '../lib/prisma'

// Overpass mirrorlar — birinchisi ishlamasa keyingisiga o'tamiz
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
]

// Haversine — metrda
function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function polylineLength(coords: [number, number][]): number {
  let len = 0
  for (let i = 1; i < coords.length; i++) {
    len += distM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
  }
  return len
}

// Polygon [[lat,lon]] → Overpass poly format "lat lon lat lon ..."
function toOverpassPoly(polygon: [number, number][]): string {
  return polygon.map(([lat, lon]) => `${lat} ${lon}`).join(' ')
}

interface OsmWay {
  osmWayId: string
  name: string | null
  highway: string
  geometry: [number, number][]
  lengthM: number
}

// Overpass orqali MFY poligon ichidagi ko'chalarni yuklaydi — mirror fallback bilan
async function fetchStreetsFromOverpass(polygon: [number, number][]): Promise<OsmWay[]> {
  const poly = toOverpassPoly(polygon)
  const query = `[out:json][timeout:45];
way["highway"~"^(residential|service|living_street|unclassified|tertiary|secondary|primary|trunk|footway|path|track)$"](poly:"${poly}");
out body geom;`

  let lastError: Error | null = null

  for (const url of OVERPASS_MIRRORS) {
    try {
      console.log(`[OSM] ${url} ga so'rov yuborilmoqda...`)
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(50_000),
      })

      if (!resp.ok) {
        console.warn(`[OSM] ${url} → HTTP ${resp.status}`)
        lastError = new Error(`Overpass HTTP ${resp.status}`)
        continue
      }

      const json = await resp.json() as { elements: any[] }
      const ways: OsmWay[] = []

      for (const el of json.elements) {
        if (el.type !== 'way' || !el.geometry?.length) continue
        const coords: [number, number][] = el.geometry.map((g: any) => [g.lat, g.lon] as [number, number])
        ways.push({
          osmWayId: String(el.id),
          name: el.tags?.name || el.tags?.['name:uz'] || el.tags?.['name:ru'] || null,
          highway: el.tags?.highway || 'unclassified',
          geometry: coords,
          lengthM: Math.round(polylineLength(coords)),
        })
      }

      console.log(`[OSM] ${url} → ${ways.length} ko'cha topildi`)
      return ways
    } catch (e: any) {
      console.warn(`[OSM] ${url} xato: ${e?.message}`)
      lastError = e
    }
  }

  throw new Error(`Barcha Overpass mirrorlar ishlamadi. Oxirgi xato: ${lastError?.message}`)
}

// GeoJSON (Feature | Polygon | raw array) dan [lat, lon][] massiv chiqaradi
function extractLatLonRing(raw: any): [number, number][] | null {
  let coords: any[] | null = null
  if (Array.isArray(raw)) {
    coords = raw
  } else if (raw?.type === 'Feature') {
    coords = raw.geometry?.coordinates?.[0] ?? null
  } else if (raw?.type === 'Polygon') {
    coords = raw.coordinates?.[0] ?? null
  } else if (raw?.type === 'FeatureCollection') {
    const f = raw.features?.[0]
    coords = f?.geometry?.coordinates?.[0] ?? null
  }
  if (!coords || coords.length < 3) return null
  // GeoJSON standart: [lon, lat] → Overpass [lat, lon]
  return coords.map(([lon, lat]: [number, number]) => [lat, lon])
}

// MFY uchun ko'chalarni OSM dan yuklaydi va DB ga saqlaydi
export async function fetchAndStoreMfyStreets(mfyId: string): Promise<{ saved: number; totalLengthKm: number }> {
  const mfy = await (prisma as any).thMfy.findUnique({
    where: { id: mfyId },
    select: { id: true, polygon: true, name: true },
  })
  if (!mfy || !mfy.polygon) throw new Error('MFY yoki polygon topilmadi')

  const polygon = extractLatLonRing(mfy.polygon)
  if (!polygon) throw new Error(`MFY ${mfyId}: polygon format noto'g'ri`)

  console.log(`[OSM] MFY "${mfy.name}" (${mfyId}) uchun ko'chalar yuklanmoqda, ${polygon.length} nuqtali polygon...`)
  const ways = await fetchStreetsFromOverpass(polygon)

  let saved = 0
  for (const w of ways) {
    await (prisma as any).thMfyStreet.upsert({
      where: { mfyId_osmWayId: { mfyId, osmWayId: w.osmWayId } },
      create: { mfyId, ...w },
      update: { name: w.name, highway: w.highway, geometry: w.geometry, lengthM: w.lengthM, fetchedAt: new Date() },
    })
    saved++
  }

  const totalLengthKm = Math.round(ways.reduce((s, w) => s + w.lengthM, 0) / 100) / 10
  console.log(`[OSM] MFY "${mfy.name}": ${saved} ko'cha saqlandi (${totalLengthKm} km)`)
  return { saved, totalLengthKm }
}

// Barcha MFY lar uchun ommaviy yuklash (3 ta parallel, mirror fallback bilan)
export async function fetchStreetsForAllMfys(organizationId: string, onProgress?: (done: number, total: number) => void): Promise<{ mfysProcessed: number; totalStreets: number }> {
  const mfys = await (prisma as any).thMfy.findMany({
    where: { organizationId, polygon: { not: null } },
    select: { id: true, name: true },
  })

  console.log(`[OSM] ${mfys.length} ta MFY topildi (org: ${organizationId})`)

  if (mfys.length === 0) {
    console.warn('[OSM] Polygon bilan MFY topilmadi — avval xaritada chegara chizing')
    return { mfysProcessed: 0, totalStreets: 0 }
  }

  let totalStreets = 0
  let done = 0
  const BATCH = 2

  for (let i = 0; i < mfys.length; i += BATCH) {
    const batch = mfys.slice(i, i + BATCH)
    await Promise.all(batch.map(async (m: any) => {
      try {
        const r = await fetchAndStoreMfyStreets(m.id)
        totalStreets += r.saved
      } catch (e: any) {
        console.error(`[OSM] MFY "${m.name}" (${m.id}) xato: ${e?.message}`)
      }
      done++
      onProgress?.(done, mfys.length)
    }))
    if (i + BATCH < mfys.length) await new Promise(r => setTimeout(r, 1500))
  }

  console.log(`[OSM] Yakunlandi: ${done} MFY, ${totalStreets} ko'cha`)
  return { mfysProcessed: done, totalStreets }
}
