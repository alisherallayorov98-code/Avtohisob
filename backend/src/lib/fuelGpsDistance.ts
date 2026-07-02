/**
 * GPS masofani IKKI ANIQ VAQT (quyishdan quyishgacha) orasida hisoblash.
 *
 * Muammo: VehicleDailyKm kun granulyarligida — avvalgi hisob birinchi/oxirgi quyish
 * KUNINING BUTUN km'ini olardi (quyishdan oldin/keyin yurilgan qismi ham). Natijada
 * masofa va litr har xil oraliqqa tegishli bo'lib, ortiqcha sarf noto'g'ri chiqardi.
 *
 * Yechim: chegara kunlar quyish VAQTI ulushi bilan prorata qilinadi:
 *   - birinchi quyish kuni  → faqat quyishdan KEYIN yurilgan qism
 *   - oxirgi quyish kuni    → faqat quyishGACHA yurilgan qism
 * Oradagi to'liq kunlar to'liq olinadi.
 *
 * Quyish momenti aniqlanish tartibi (aniqdan taxminiyga):
 *   1) FuelStop.enteredAt — GPS bo'yicha zapravka zonasiga kirgan REAL vaqt (eng aniq)
 *   2) FuelRecord.refuelDate ichidagi soat (datetime-local bilan kiritilgan)
 *   3) Vaqtsiz yozuv (vedomost importi, 00:00) — kun o'rtasi (12:00) deb olinadi.
 *      Butun kunni olishdan ko'ra kutilgan xato ikki baravar kichik.
 */

export const DAY_MS = 86400000
// VehicleDailyKm kunlari UTC+5 (O'zbekiston) bo'yicha yozilgan — shu shkala bilan ishlaymiz
export const UZ_OFFSET_MS = 5 * 3600 * 1000

/** UTC+5 mahalliy kun kaliti 'YYYY-MM-DD' (VehicleDailyKm.date bilan bir xil shkala) */
export function uzDayKey(t: number): string {
  return new Date(t + UZ_OFFSET_MS).toISOString().slice(0, 10)
}

/** Kun ichidagi vaqt ulushi [0..1) — UTC+5 bo'yicha */
export function uzDayFrac(t: number): number {
  return ((((t + UZ_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS
}

/** Yozuv vaqti "faqat sana"mi (soat kiritilmagan importlar) — UTC yoki UZ yarim tunga tushadi */
function isDateOnly(t: number): boolean {
  return t % DAY_MS === 0 || uzDayFrac(t) === 0
}

/**
 * Yozuvga mos quyish MOMENTI: shu kunga tushgan eng yaqin FuelStop (GPS zona kirishi),
 * bo'lmasa yozuvdagi soat, vaqtsiz yozuvda — kun o'rtasi.
 */
export function effectiveRefuelTime(recT: number, stops: Array<{ enteredAt: Date | string }>): number {
  const day = uzDayKey(recT)
  let best: number | null = null
  for (const s of stops) {
    const st = new Date(s.enteredAt).getTime()
    if (uzDayKey(st) !== day) continue
    if (best == null || Math.abs(st - recT) < Math.abs(best - recT)) best = st
  }
  if (best != null) return best
  if (!isDateOnly(recT)) return recT
  // kun boshiga tushirib, 12:00 (UZ) ga suramiz
  return recT - uzDayFrac(recT) * DAY_MS + DAY_MS / 2
}

/**
 * [fromT..toT] orasidagi GPS masofa (km) — VehicleDailyKm kunlik keshidan.
 * To'liq oradagi kunlar + prorata chegara kunlar.
 */
export function gpsKmBetween(
  days: Array<{ date: Date | string; km: number }>,
  fromT: number,
  toT: number,
): number {
  if (toT <= fromT) return 0
  const fromKey = uzDayKey(fromT)
  const toKey = uzDayKey(toT)
  let km = 0
  for (const d of days) {
    const key = new Date(d.date).toISOString().slice(0, 10)
    if (key < fromKey || key > toKey) continue
    if (fromKey === toKey) km += d.km * Math.max(0, uzDayFrac(toT) - uzDayFrac(fromT))
    else if (key === fromKey) km += d.km * (1 - uzDayFrac(fromT))
    else if (key === toKey) km += d.km * uzDayFrac(toT)
    else km += d.km
  }
  return Math.round(km * 10) / 10
}
