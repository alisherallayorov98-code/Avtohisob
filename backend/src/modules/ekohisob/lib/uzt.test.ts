import {
  uztParts, todayUz, currentMonthUz, currentYearUz, monthOfUz, dayOfUz, isValidMonth, daysInMonth,
  isValidIsoDate, parseDateOnly, monthBoundsUz, dayBoundsUz, lastDayOfMonth, shiftMonth,
} from './uzt'
import { getCurrentMonth, addMonths, monthsBetween, lastNMonths } from './months'
import { uzDate, uzDateTime } from './dateFormat'

describe('uzt — UTC+5 chegara', () => {
  it('UTC 19:00 = UZT keyingi kun 00:00', () => {
    // 2026-11-30 19:00 UTC → UZT 2026-12-01 00:00 → oy DEKABR
    const d = new Date('2026-11-30T19:00:00.000Z')
    expect(currentMonthUz(d)).toBe('2026-12')
    expect(todayUz(d)).toBe('2026-12-01')
  })
  it('UTC 18:59:59 hali oldingi kun', () => {
    const d = new Date('2026-11-30T18:59:59.999Z')
    expect(currentMonthUz(d)).toBe('2026-11')
    expect(todayUz(d)).toBe('2026-11-30')
  })
  it('yangi yil chegarasi (kvitansiya yili)', () => {
    expect(currentYearUz(new Date('2026-12-31T19:00:00.000Z'))).toBe(2027)
    expect(currentYearUz(new Date('2026-12-31T18:59:00.000Z'))).toBe(2026)
  })
  it('noto\'g\'ri sana → null', () => {
    expect(uztParts('xyz')).toBeNull()
    expect(monthOfUz(new Date(NaN))).toBeNull()
    expect(dayOfUz('nope')).toBeNull()
  })
})

describe('uzt — oy/sana tekshiruvi', () => {
  it('oy diapazoni', () => {
    expect(isValidMonth('2026-01')).toBe(true)
    expect(isValidMonth('2026-12')).toBe(true)
    expect(isValidMonth('2026-13')).toBe(false)
    expect(isValidMonth('2026-00')).toBe(false)
    expect(isValidMonth('26-01')).toBe(false)
    expect(isValidMonth(null)).toBe(false)
    expect(isValidMonth(202601)).toBe(false)
  })
  it('oyda kunlar (kabisa)', () => {
    expect(daysInMonth('2026-11')).toBe(30)
    expect(daysInMonth('2026-12')).toBe(31)
    expect(daysInMonth('2024-02')).toBe(29)
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('bad')).toBe(0)
  })
  it('noyabrda 31-kun yo\'q (talon filtri xatosi)', () => {
    expect(isValidIsoDate('2026-11-31')).toBe(false)
    expect(isValidIsoDate('2026-11-30')).toBe(true)
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(parseDateOnly('2026-11-31')).toBeNull()
    expect(parseDateOnly('2026-11-30')!.toISOString()).toBe('2026-11-30T00:00:00.000Z')
    expect(lastDayOfMonth('2026-11')).toBe('2026-11-30')
    expect(lastDayOfMonth('2026-13')).toBeNull()
  })
})

describe('uzt — chegaralar [start, end)', () => {
  it('oy chegarasi UZT bo\'yicha', () => {
    const b = monthBoundsUz('2026-11')!
    expect(b.start.toISOString()).toBe('2026-10-31T19:00:00.000Z')
    expect(b.end.toISOString()).toBe('2026-11-30T19:00:00.000Z')
    // dekabr boshi
    expect(monthBoundsUz('2026-12')!.start.getTime()).toBe(b.end.getTime())
  })
  it('oylar bo\'shliqsiz va ustma-ustsiz tutashadi', () => {
    let prevEnd = monthBoundsUz('2025-01')!.start.getTime()
    for (const m of monthsBetween('2025-01', '2027-12')) {
      const b = monthBoundsUz(m)!
      expect(b.start.getTime()).toBe(prevEnd)
      expect(b.end.getTime()).toBeGreaterThan(b.start.getTime())
      prevEnd = b.end.getTime()
    }
  })
  it('kun chegarasi 24 soat', () => {
    const b = dayBoundsUz('2026-11-10')!
    expect(b.end.getTime() - b.start.getTime()).toBe(24 * 3600 * 1000)
    expect(b.start.toISOString()).toBe('2026-11-09T19:00:00.000Z')
    expect(dayBoundsUz('2026-11-31')).toBeNull()
  })
  it('har instant aynan bitta oyga tushadi', () => {
    const samples = ['2026-10-31T18:59:59.999Z', '2026-10-31T19:00:00.000Z', '2026-11-30T18:59:59.999Z', '2026-11-30T19:00:00.000Z']
    const expected = ['2026-10', '2026-11', '2026-11', '2026-12']
    samples.forEach((s, i) => {
      const m = monthOfUz(s)!
      expect(m).toBe(expected[i])
      const b = monthBoundsUz(m)!
      const t = new Date(s).getTime()
      expect(t >= b.start.getTime() && t < b.end.getTime()).toBe(true)
    })
  })
})

describe('months — Date\'siz arifmetika', () => {
  it('addMonths yil chegarasi', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-03', -15)).toBe('2024-12')
    expect(addMonths('2026-03', 0)).toBe('2026-03')
  })
  it('shiftMonth teskari amal', () => {
    for (let n = -30; n <= 30; n++) expect(shiftMonth(shiftMonth('2026-07', n), -n)).toBe('2026-07')
  })
  it('monthsBetween / lastNMonths', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthsBetween('2026-12', '2026-11')).toEqual([])
    expect(monthsBetween('2026-13', '2027-01')).toEqual([])
    expect(lastNMonths(3, '2026-01')).toEqual(['2025-11', '2025-12', '2026-01'])
  })
  it('getCurrentMonth UZT bo\'yicha', () => {
    expect(getCurrentMonth(new Date('2026-11-30T19:30:00.000Z'))).toBe('2026-12')
  })
})

describe('dateFormat — UZT bo\'yicha', () => {
  it('server mintaqasidan mustaqil', () => {
    expect(uzDate('2026-11-30T19:00:00.000Z')).toBe('01.12.2026')
    expect(uzDateTime('2026-11-10T09:30:00.000Z')).toBe('10.11.2026 14:30')
    expect(uzDate('garbage')).toBe('—')
    expect(uzDate(null)).toBe('—')
  })
})
