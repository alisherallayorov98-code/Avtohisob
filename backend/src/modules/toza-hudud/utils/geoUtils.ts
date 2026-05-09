/**
 * Toza-Hudud: Umumiy geo-matematik yordamchilar.
 * Barcha modullarda shu fayldan import qilinadi — dublikat qolmasin.
 */

// GeoJSON har xil formatlardan [lon, lat][] coords ni chiqaradi
export function extractCoords(geojson: any): number[][] | null {
  if (!geojson) return null
  try {
    if (geojson.type === 'Feature') return geojson.geometry?.coordinates?.[0] ?? null
    if (geojson.type === 'Polygon') return geojson.coordinates?.[0] ?? null
    if (geojson.type === 'FeatureCollection') {
      const f = geojson.features?.[0]
      if (f?.geometry?.type === 'Polygon') return f.geometry.coordinates[0]
    }
    if (Array.isArray(geojson)) {
      return Array.isArray(geojson[0]?.[0]) ? geojson[0] : (geojson as number[][])
    }
  } catch {}
  return null
}

/** Haversine: ikki GPS nuqta orasidagi masofa metrda */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Ray-casting: nuqta GeoJSON polygon ichida yoki tashqarida (GeoJSON: [lon,lat]) */
export function pointInPolygon(lat: number, lon: number, geojson: any): boolean {
  const coords = extractCoords(geojson)
  if (!coords || coords.length < 3) return false
  let inside = false
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1]
    const xj = coords[j][0], yj = coords[j][1]
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

/** Polygon maydoni km² da (Shoelace + longitude cos(lat) korreksiyasi) */
export function polygonAreaKm2(geojson: any): number {
  const coords = extractCoords(geojson)
  if (!coords || coords.length < 3) return 0
  let area = 0
  const n = coords.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (coords[j][0] + coords[i][0]) * (coords[j][1] - coords[i][1])
  }
  const degArea = Math.abs(area) / 2
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length
  // 1° lat ≈ 111 km, 1° lon ≈ 111·cos(lat) km
  return Math.abs(degArea * 111 * 111 * Math.cos(midLat * Math.PI / 180))
}

/** Polygon centroid [lat, lon] */
export function polygonCentroid(geojson: any): [number, number] {
  const coords = extractCoords(geojson)
  if (!coords || coords.length === 0) return [0, 0]
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length
  const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length
  return [lat, lon]
}

/** Polygon "radius" — markazdan eng uzoq vertex gacha (metr) */
export function polygonRadius(centroid: [number, number], geojson: any): number {
  const coords = extractCoords(geojson)
  if (!coords || coords.length === 0) return 300
  return Math.max(...coords.map(c => haversineM(centroid[0], centroid[1], c[1], c[0])))
}
