import { computeTireUsage, levelForPct, DEFAULT_TIRE_NORM_KM } from './tireUsage'

const base = { status: 'installed', installedMileageKm: 100000, totalMileage: 0, standardMileageKm: 40000 }

describe('computeTireUsage', () => {
  it("o'rnatilganidan beri odometr farqi", () => {
    const u = computeTireUsage(base, 112000)
    expect(u.drivenSinceInstallKm).toBe(12000)
    expect(u.usedKm).toBe(12000)
    expect(u.pct).toBe(30)
    expect(u.level).toBe('ok')
  })

  it("avvalgi o'rnatishlardagi km ham qo'shiladi", () => {
    const u = computeTireUsage({ ...base, totalMileage: 20000 }, 118000)
    expect(u.usedKm).toBe(38000)
    expect(u.pct).toBe(95)
    expect(u.level).toBe('critical')
  })

  it("odometr orqaga ketsa (tuzatish) manfiy chiqmaydi", () => {
    const u = computeTireUsage(base, 90000)
    expect(u.drivenSinceInstallKm).toBe(0)
    expect(u.usedKm).toBe(0)
  })

  it("o'rnatilgan km yoki joriy km noma'lum bo'lsa, farq null", () => {
    expect(computeTireUsage({ ...base, installedMileageKm: null }, 120000).drivenSinceInstallKm).toBeNull()
    expect(computeTireUsage(base, null).drivenSinceInstallKm).toBeNull()
  })

  it("omborda/olingan shinada joriy o'rnatish km'i hisoblanmaydi", () => {
    const u = computeTireUsage({ ...base, status: 'returned', totalMileage: 15000 }, 150000)
    expect(u.drivenSinceInstallKm).toBeNull()
    expect(u.usedKm).toBe(15000)
  })

  it('norma yo\'q yoki 0 bo\'lsa standart 40000', () => {
    expect(computeTireUsage({ ...base, standardMileageKm: 0 }, 110000).normKm).toBe(DEFAULT_TIRE_NORM_KM)
    expect(computeTireUsage({ ...base, standardMileageKm: null }, 110000).normKm).toBe(DEFAULT_TIRE_NORM_KM)
  })

  it('foiz 100 dan oshmaydi', () => {
    expect(computeTireUsage(base, 300000).pct).toBe(100)
  })
})

describe('levelForPct', () => {
  it('chegaralar: 70 va 90', () => {
    expect(levelForPct(69)).toBe('ok')
    expect(levelForPct(70)).toBe('warning')
    expect(levelForPct(89)).toBe('warning')
    expect(levelForPct(90)).toBe('critical')
  })
})
