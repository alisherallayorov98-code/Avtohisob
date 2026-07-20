import { haversineKm, filterGpsJitter, computeDailyTrackKm } from './gpsDistance'

describe('haversineKm', () => {
  it('bir xil nuqta → 0 km', () => {
    expect(haversineKm(41.3, 69.2, 41.3, 69.2)).toBe(0)
  })

  it('Toshkent → Samarqand ~ 270 km (±10%)', () => {
    // Toshkent (41.31, 69.24) → Samarqand (39.65, 66.96)
    const d = haversineKm(41.31, 69.24, 39.65, 66.96)
    expect(d).toBeGreaterThan(240)
    expect(d).toBeLessThan(300)
  })

  it('1 kenglik daraja ~ 111 km', () => {
    const d = haversineKm(41.0, 69.0, 42.0, 69.0)
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })
})

describe('computeDailyTrackKm', () => {
  it('nuqta yo\'q yoki bitta → 0', () => {
    expect(computeDailyTrackKm([]).totalKm).toBe(0)
    expect(computeDailyTrackKm([{ lat: 41, lon: 69, ts: 1000 }]).totalKm).toBe(0)
  })

  it('ketma-ket nuqtalar masofasi yig\'iladi (kunlik km butun songa yaxlitlanadi)', () => {
    // 41.00→41.01→41.02 (~1.11 km har qadam, jami ~2.22 km → kunlik round → 2)
    const base = 1_700_000_000
    const { totalKm } = computeDailyTrackKm([
      { lat: 41.00, lon: 69.0, ts: base },
      { lat: 41.01, lon: 69.0, ts: base + 60 },
      { lat: 41.02, lon: 69.0, ts: base + 120 },
    ])
    expect(totalKm).toBe(2) // kunlik km Math.round bilan butun songa
  })

  it('50km dan katta sakrash (GPS artefakt) TASHLANADI', () => {
    const base = 1_700_000_000
    const withJump = computeDailyTrackKm([
      { lat: 41.0, lon: 69.0, ts: base },
      { lat: 42.0, lon: 69.0, ts: base + 60 }, // ~111 km sakrash → tashlanadi
      { lat: 42.01, lon: 69.0, ts: base + 120 }, // ~1.1 km → sanaladi
    ]).totalKm
    // Faqat oxirgi ~1.1 km qoladi (round → 1), 111 km artefakt YO'Q.
    // Tekshiruv: agar sakrash sanalganda 100+ km chiqardi.
    expect(withJump).toBe(1)
  })

  it('UTC+5 kun chegarasi: 19:30 UTC = ertasi kun 00:30 UZT', () => {
    // 2026-06-15 19:30 UTC → UZT 2026-06-16 00:30 (ertangi kun)
    const utc1930 = Math.floor(Date.UTC(2026, 5, 15, 19, 30) / 1000)
    const { days } = computeDailyTrackKm([
      { lat: 41.00, lon: 69.0, ts: utc1930 },
      { lat: 41.01, lon: 69.0, ts: utc1930 + 60 },
    ])
    expect(days).toHaveLength(1)
    expect(days[0].date).toBe('2026-06-16') // UZT bo'yicha ertangi kun
  })

  it('kun bo\'yicha guruhlaydi va sanasi bo\'yicha tartiblaydi', () => {
    const day1 = Math.floor(Date.UTC(2026, 5, 15, 8, 0) / 1000) // UZT 13:00, 06-15
    const day2 = day1 + 86400 // ertasi kun
    const { days } = computeDailyTrackKm([
      { lat: 41.00, lon: 69.0, ts: day1 },
      { lat: 41.01, lon: 69.0, ts: day1 + 60 },
      { lat: 41.00, lon: 69.0, ts: day2 },
      { lat: 41.02, lon: 69.0, ts: day2 + 60 },
    ])
    expect(days.map(d => d.date)).toEqual(['2026-06-15', '2026-06-16'])
  })
})

describe('filterGpsJitter', () => {
  it('pos yo\'q xabarlar tashlanadi', () => {
    const out = filterGpsJitter([
      { t: 100, pos: { y: 41, x: 69, sc: 0 } },
      { t: 160 } as any,
      { t: 220, pos: { y: 41.01, x: 69, sc: 10 } },
    ])
    expect(out).toHaveLength(2)
  })

  it('2km+ sakrash 30 sekunddan kam vaqtda (teleport artefakt) tashlanadi', () => {
    const out = filterGpsJitter([
      { t: 100, pos: { y: 41.0, x: 69.0, sc: 0 } },
      { t: 110, pos: { y: 41.5, x: 69.0, sc: 0 } }, // ~55 km, 10 sek → artefakt
    ])
    expect(out).toHaveLength(1)
  })

  it('tezlik 100 km/h dan ko\'p sakrasa 10 sekunddan kam vaqtda tashlanadi', () => {
    const out = filterGpsJitter([
      { t: 100, pos: { y: 41.0, x: 69.0, sc: 0 } },
      { t: 105, pos: { y: 41.001, x: 69.0, sc: 150 } }, // yaqin, lekin tezlik 0→150 sakradi
    ])
    expect(out).toHaveLength(1)
  })

  it('normal harakat (sekin, uzoq vaqt) saqlanadi', () => {
    const out = filterGpsJitter([
      { t: 100, pos: { y: 41.0, x: 69.0, sc: 20 } },
      { t: 160, pos: { y: 41.01, x: 69.0, sc: 25 } }, // ~1.1 km, 60 sek → normal
      { t: 220, pos: { y: 41.02, x: 69.0, sc: 30 } },
    ])
    expect(out).toHaveLength(3)
  })

  it('2km+ sakrash lekin YETARLI vaqt bo\'lsa (haqiqiy uzoq safar) saqlanadi', () => {
    const out = filterGpsJitter([
      { t: 100, pos: { y: 41.0, x: 69.0, sc: 90 } },
      { t: 300, pos: { y: 41.05, x: 69.0, sc: 90 } }, // ~5.5 km, 200 sek → haqiqiy (90km/h)
    ])
    expect(out).toHaveLength(2)
  })
})
