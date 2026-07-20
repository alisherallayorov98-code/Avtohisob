// ═══════════════════════════════════════════════════════════════════════════
// GPS masofa yadrosi — YAGONA KANONIK manba. Hisobot, sana-kiritish, sync, shina,
// yoqilg'i — HAMMASI shu funksiyalarni ishlatadi, shuning uchun bir mashina uchun
// har joyda AYNAN bir xil km chiqadi. wialonService'dan ajratildi (DB/tarmoqsiz
// unit-test qilinishi uchun) — xatti-harakat asl nusxa bilan AYNAN bir xil.
//
// DIQQAT: bu raqamlar mijozning yoqilg'i sarfi va moy hisobiga bevosita ta'sir
// qiladi — formulani o'zgartirishdan oldin gpsDistance.test.ts ni ishga tushiring.
// ═══════════════════════════════════════════════════════════════════════════

// O'zbekiston vaqti (UTC+5) — kun chegaralari shu bo'yicha. toISOString() UTC bergani
// uchun ts ga +5 soat qo'shib, mahalliy kunni olamiz (aks holda kechqurun harakat
// avvalgi kunga tushib, davr boshida fantom kun chiqardi).
export const UZ_TZ_OFFSET_SEC = 5 * 3600

/** Haversine: ikki GPS nuqta orasidagi masofa (km). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * GPS jitter (shovqin) filtri: fizik jihatdan imkonsiz sakrashlarni tashlaydi.
 *  - 2km dan ortiq sakrash 30 sekunddan kam vaqtda → GPS artefakt
 *  - tezlik 100 km/h dan ko'p sakrasa 10 sekunddan kam vaqtda → shovqin
 * pos yo'q xabarlar ham tashlanadi.
 */
export function filterGpsJitter(
  msgs: Array<{ t: number; pos?: { y: number; x: number; sc: number; s?: number } }>,
): Array<{ t: number; pos: { y: number; x: number; sc: number; s?: number } }> {
  const valid: Array<{ t: number; pos: { y: number; x: number; sc: number; s?: number } }> = []
  let prev: { t: number; pos: { y: number; x: number; sc: number; s?: number } } | null = null

  for (const m of msgs) {
    if (!m.pos) continue
    const cur = m as { t: number; pos: { y: number; x: number; sc: number; s?: number } }

    if (prev) {
      const dt = cur.t - prev.t
      const distKm = haversineKm(prev.pos.y, prev.pos.x, cur.pos.y, cur.pos.x)
      const speedJump = Math.abs((cur.pos.sc ?? 0) - (prev.pos.sc ?? 0))

      // 2km dan ortiq sakrash < 30 sek ichida — GPS artefakt
      if (distKm > 2 && dt < 30) continue
      // Tezlik sakrashi > 100 km/h ketma-ket nuqtalar orasida — shovqin
      if (speedJump > 100 && dt < 10) continue
    }

    valid.push(cur)
    prev = cur
  }
  return valid
}

/**
 * Jitter'dan tozalangan trek nuqtalaridan kunlik (UTC+5) va umumiy km.
 * Ketma-ket nuqtalar orasidagi masofa yig'iladi; >50km sakrash = GPS artefakt → tashlanadi.
 * Tezlik filtri YO'Q (ataylab): SmartGPS sayti bilan moslangan usul shu — tezlik gate'i
 * ba'zi qurilmalarda (siyrak tezlik yuboradigan) haqiqiy harakatni kam hisoblardi.
 */
export function computeDailyTrackKm(
  points: Array<{ lat: number; lon: number; ts: number }>,
): { days: Array<{ date: string; km: number }>; totalKm: number } {
  const dailyMap: Record<string, number> = {}
  let prev: { lat: number; lon: number } | null = null
  for (const p of points) {
    if (prev) {
      const d = haversineKm(prev.lat, prev.lon, p.lat, p.lon)
      if (d < 50) {
        const day = new Date((p.ts + UZ_TZ_OFFSET_SEC) * 1000).toISOString().slice(0, 10)
        dailyMap[day] = (dailyMap[day] ?? 0) + d
      }
    }
    prev = { lat: p.lat, lon: p.lon }
  }
  const days = Object.entries(dailyMap)
    .map(([date, km]) => ({ date, km: Math.round(km) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const totalKm = Math.round(days.reduce((s, r) => s + r.km, 0) * 10) / 10
  return { days, totalKm }
}
