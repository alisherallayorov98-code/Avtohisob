import { resolveDashboardPeriod } from './dashboardPeriod'

describe('resolveDashboardPeriod', () => {
  const now = new Date(2026, 7, 15, 13, 30) // 2026-08-15

  it('sana berilmasa joriy oy boshidan bugungacha', () => {
    const p = resolveDashboardPeriod(undefined, undefined, now)
    expect(p.from.getDate()).toBe(1)
    expect(p.from.getMonth()).toBe(7)
    expect(p.from.getHours()).toBe(0)
    expect(p.label).toBe('Shu oy')
  })

  it('bugungi kun oxirigacha qamraydi', () => {
    const p = resolveDashboardPeriod(undefined, undefined, now)
    expect(p.to.getHours()).toBe(23)
    expect(p.to.getMinutes()).toBe(59)
  })

  it('from berilsa kun boshidan olinadi', () => {
    const p = resolveDashboardPeriod('2026-08-10', '2026-08-12', now)
    expect(p.from.getDate()).toBe(10)
    expect(p.from.getHours()).toBe(0)
    expect(p.label).toBe('Tanlangan davr')
  })

  it('to berilsa kun OXIRIGACHA kengaytiriladi', () => {
    const p = resolveDashboardPeriod('2026-08-10', '2026-08-12', now)
    expect(p.to.getDate()).toBe(12)
    expect(p.to.getHours()).toBe(23)
    expect(p.to.getMilliseconds()).toBe(999)
  })

  it('faqat from berilsa to = bugun', () => {
    const p = resolveDashboardPeriod('2026-08-01', undefined, now)
    expect(p.to.getDate()).toBe(15)
  })

  it('teskari oraliq joyini almashtiradi', () => {
    const p = resolveDashboardPeriod('2026-08-20', '2026-08-05', now)
    expect(p.from.getTime()).toBeLessThan(p.to.getTime())
  })

  it('notogri sana joriy oyga tushadi', () => {
    const p = resolveDashboardPeriod('salom', 'xayr', now)
    expect(p.label).toBe('Shu oy')
    expect(p.from.getDate()).toBe(1)
  })
})
