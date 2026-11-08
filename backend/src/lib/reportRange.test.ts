import { reportFrom, reportTo, reportRange, previousRange } from './reportRange'
import { buildInsights, pctDelta } from './reportInsights'

describe('reportRange', () => {
  it('from — UZT kun boshi (UTC 19:00 oldingi kun)', () => {
    expect(reportFrom('2026-11-08')!.toISOString()).toBe('2026-11-07T19:00:00.000Z')
  })
  it('to — shu kun to\'liq kiradi (UZT 23:59:59.999)', () => {
    const t = reportTo('2026-11-08')!
    expect(t.toISOString()).toBe('2026-11-08T18:59:59.999Z')
    // Bugun kunduzi (UZT 14:00 = 09:00 UTC) yozilgan yozuv oraliqqa kiradi — avval kirmas edi
    expect(new Date('2026-11-08T09:00:00Z') <= t).toBe(true)
    expect(new Date('2026-11-08T09:00:00Z') <= new Date('2026-11-08')).toBe(false)
  })
  it('bo\'sh va noto\'g\'ri qiymat', () => {
    expect(reportFrom('')).toBeUndefined()
    expect(reportTo(undefined)).toBeUndefined()
    expect(reportFrom('abc')).toBeUndefined()
    expect(reportRange('', '')).toBeUndefined()
  })
  it('to\'liq ISO o\'zgarishsiz', () => {
    expect(reportFrom('2026-11-08T10:00:00Z')!.toISOString()).toBe('2026-11-08T10:00:00.000Z')
  })
  it('previousRange teng uzunlikdagi oldingi davr', () => {
    const p = previousRange('2026-11-01', '2026-11-08')! // 8 kun
    expect(p.lte.toISOString()).toBe('2026-10-31T18:59:59.999Z')
    expect(p.gte.toISOString()).toBe('2026-10-23T19:00:00.000Z')
    expect(previousRange('2026-11-01', undefined)).toBeNull()
    expect(previousRange('2026-11-09', '2026-11-01')).toBeNull()
  })
})

const totals = (total: number, fuel = 0, maintenance = 0) => ({ total, fuel, maintenance, expenses: total - fuel - maintenance })

describe('reportInsights', () => {
  it('pctDelta', () => {
    expect(pctDelta(150, 100)).toBe(50)
    expect(pctDelta(5, 0)).toBeNull()
  })
  it('hech narsa ajralib turmasa — bo\'sh ro\'yxat', () => {
    const r = buildInsights({
      vehicles: [
        { id: 'a', registrationNumber: 'A', cost: 100, prevCost: 100, l100: 20, normPer100: 20 },
        { id: 'b', registrationNumber: 'B', cost: 100, prevCost: 100, l100: null, normPer100: null },
        { id: 'c', registrationNumber: 'C', cost: 100, prevCost: 100, l100: null, normPer100: null },
        { id: 'd', registrationNumber: 'D', cost: 100, prevCost: 100, l100: null, normPer100: null },
        { id: 'e', registrationNumber: 'E', cost: 100, prevCost: 100, l100: null, normPer100: null },
        { id: 'f', registrationNumber: 'F', cost: 100, prevCost: 100, l100: null, normPer100: null },
        { id: 'g', registrationNumber: 'G', cost: 100, prevCost: 100, l100: null, normPer100: null },
      ],
      cur: totals(700, 300, 300), prev: totals(700, 300, 300),
    })
    expect(r).toEqual([])
  })
  it('jami o\'sish, eng qimmat mashina va me\'yordan ortiq sarf', () => {
    const r = buildInsights({
      vehicles: [
        { id: 'a', registrationNumber: '30 234 RAA', cost: 45_000_000, prevCost: 30_000_000, l100: 30, normPer100: 20 },
        { id: 'b', registrationNumber: '30 111 BBB', cost: 5_000_000, prevCost: 5_000_000, l100: 21, normPer100: 20 },
      ],
      cur: totals(50_000_000, 20_000_000, 25_000_000), prev: totals(35_000_000, 20_000_000, 10_000_000),
    })
    const texts = r.map(x => x.text)
    expect(texts[0]).toContain('+43%')
    expect(texts.some(t => t.includes('Eng ko\'p xarajat: 30 234 RAA') && t.includes('+50%'))).toBe(true)
    expect(texts.some(t => t.includes('1 ta mashinada') && t.includes('30 234 RAA (+50%)'))).toBe(true)
    expect(r.find(x => x.text.includes('Eng ko\'p'))!.vehicleId).toBe('a')
  })
  it('oldingi davr yo\'q bo\'lsa solishtirma yozilmaydi', () => {
    const r = buildInsights({ vehicles: [], cur: totals(1000), prev: null })
    expect(r).toEqual([])
  })
})
