/**
 * fuelGpsDistance.ts sof funksiyalari testi.
 *
 * "Tosh qotiriladigan" asosiy xato (2026-07-02 audit): yoqilg'i sarfi GPS km
 * bo'yicha hisoblanganda BIRINCHI/OXIRGI quyish kunining BUTUN km'i olinardi —
 * quyishdan oldin/keyin yurilgan qism ham. Endi chegara kunlar quyish VAQTI
 * bilan prorata qilinadi, quyish momenti FuelStop (GPS zona kirishi) bilan
 * aniqlashtiriladi.
 */
import { uzDayKey, uzDayFrac, effectiveRefuelTime, gpsKmBetween, DAY_MS } from './fuelGpsDistance'

// 2026-06-10 09:00 UZ (UTC+5) = 04:00 UTC
const T = (iso: string) => new Date(iso).getTime()

describe('uzDayKey / uzDayFrac', () => {
  it('UTC kechqurun → UZ boʻyicha keyingi kun', () => {
    expect(uzDayKey(T('2026-06-10T21:00:00Z'))).toBe('2026-06-11')
    expect(uzDayKey(T('2026-06-10T10:00:00Z'))).toBe('2026-06-10')
  })
  it('kun ulushi UZ vaqtida hisoblanadi', () => {
    expect(uzDayFrac(T('2026-06-10T07:00:00Z'))).toBeCloseTo(0.5) // 12:00 UZ
    expect(uzDayFrac(T('2026-06-09T19:00:00Z'))).toBeCloseTo(0)   // 00:00 UZ
  })
})

describe('effectiveRefuelTime', () => {
  it('shu kunga tushgan FuelStop (GPS zona kirishi) ustuvor', () => {
    const recT = T('2026-06-10T00:00:00Z') // vedomost: vaqtsiz
    const stop = { enteredAt: new Date('2026-06-10T06:30:00Z') } // 11:30 UZ
    expect(effectiveRefuelTime(recT, [stop])).toBe(T('2026-06-10T06:30:00Z'))
  })
  it('boshqa kundagi stop olinmaydi', () => {
    const recT = T('2026-06-10T08:00:00Z')
    const stop = { enteredAt: new Date('2026-06-11T06:00:00Z') }
    expect(effectiveRefuelTime(recT, [stop])).toBe(recT) // yozuvdagi soat qoladi
  })
  it('soat kiritilgan yozuv — oʻz vaqti ishlatiladi', () => {
    const recT = T('2026-06-10T09:45:00Z')
    expect(effectiveRefuelTime(recT, [])).toBe(recT)
  })
  it('vaqtsiz yozuv (00:00 UTC) → kun oʻrtasi (12:00 UZ)', () => {
    const recT = T('2026-06-10T00:00:00Z') // 05:00 UZ, lekin date-only import
    const eff = effectiveRefuelTime(recT, [])
    expect(uzDayKey(eff)).toBe('2026-06-10')
    expect(uzDayFrac(eff)).toBeCloseTo(0.5)
  })
  it('vaqtsiz yozuv (00:00 UZ) → kun oʻrtasi, kun oʻzgarmaydi', () => {
    const recT = T('2026-06-09T19:00:00Z') // 00:00 UZ 10-iyun
    const eff = effectiveRefuelTime(recT, [])
    expect(uzDayKey(eff)).toBe('2026-06-10')
    expect(uzDayFrac(eff)).toBeCloseTo(0.5)
  })
})

describe('gpsKmBetween', () => {
  // VehicleDailyKm konvensiyasi: date = UZ kun 'YYYY-MM-DD' UTC yarim tunda saqlanadi
  const days = [
    { date: '2026-06-10T00:00:00.000Z', km: 100 },
    { date: '2026-06-11T00:00:00.000Z', km: 200 },
    { date: '2026-06-12T00:00:00.000Z', km: 80 },
  ]

  it('oradagi toʻliq kun toʻliq, chegara kunlar vaqt ulushi bilan olinadi', () => {
    // 10-iyun 12:00 UZ dan 12-iyun 06:00 UZ gacha:
    // 10-iyun: 100 × 0.5 = 50, 11-iyun: 200 (toʻliq), 12-iyun: 80 × 0.25 = 20
    const from = T('2026-06-10T07:00:00Z') // 12:00 UZ
    const to = T('2026-06-12T01:00:00Z')   // 06:00 UZ
    expect(gpsKmBetween(days, from, to)).toBeCloseTo(50 + 200 + 20, 1)
  })

  it('AVVALGI XATO: butun kunlar yigʻindisi EMAS', () => {
    const from = T('2026-06-10T07:00:00Z')
    const to = T('2026-06-12T01:00:00Z')
    expect(gpsKmBetween(days, from, to)).not.toBe(380) // eski usul 100+200+80 berardi
  })

  it('bir kun ichida ikki quyish — faqat oradagi ulush', () => {
    const from = T('2026-06-11T03:00:00Z') // 08:00 UZ
    const to = T('2026-06-11T09:00:00Z')   // 14:00 UZ → 6/24 kun
    expect(gpsKmBetween(days, from, to)).toBeCloseTo(200 * 0.25, 1)
  })

  it('teskari/nol oraliq → 0', () => {
    expect(gpsKmBetween(days, T('2026-06-11T09:00:00Z'), T('2026-06-11T03:00:00Z'))).toBe(0)
  })

  it('oraliqdan tashqari kunlar olinmaydi', () => {
    const from = T('2026-06-10T19:00:01Z') // 11-iyun 00:00:01 UZ
    const to = T('2026-06-11T18:59:59Z')   // 11-iyun 23:59:59 UZ
    expect(gpsKmBetween(days, from, to)).toBeCloseTo(200, 0)
  })
})
