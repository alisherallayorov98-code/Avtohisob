/** Haversine masofa (metr) */
export function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

export function fmtDist(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`
}

export const TASHKENT: [number, number] = [41.2995, 69.2401]

export function getSavedView(): { center: [number, number]; zoom: number } {
  try {
    const saved = localStorage.getItem('eko_map_view')
    if (saved) return JSON.parse(saved)
  } catch { /* localStorage yo'q — standart ko'rinish */ }
  return { center: TASHKENT, zoom: 12 }
}

/** GPS aniqligi shu qiymatdan katta bo'lsa ogohlantiriladi (metr) */
export const GPS_ACCURACY_WARN_M = 50
