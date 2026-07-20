import { normalizeDate, normalizePlate, computeRowCost } from './vedomostMath'

describe('normalizeDate', () => {
  it('ISO sana to\'g\'ridan-to\'g\'ri o\'qiladi', () => {
    const d = normalizeDate('2026-06-15')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(5)
    expect(d!.getDate()).toBe(15)
  })

  it('DD.MM.YYYY formati', () => {
    const d = normalizeDate('15.06.2026')
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(5)
    expect(d!.getDate()).toBe(15)
  })

  it('DD.MM.YY — ikki xonali yil 2000 ga qo\'shiladi', () => {
    const d = normalizeDate('15.06.26')
    expect(d!.getFullYear()).toBe(2026)
  })

  it('DD/MM/YYYY va DD-MM-YYYY ajratgichlari ham ishlaydi', () => {
    expect(normalizeDate('15/06/2026')!.getDate()).toBe(15)
    expect(normalizeDate('15-06-2026')!.getDate()).toBe(15)
  })

  it('DD.MM — yil kontekstdan olinadi', () => {
    const d = normalizeDate('15.06', 2025)
    expect(d!.getFullYear()).toBe(2025)
    expect(d!.getMonth()).toBe(5)
  })

  it('bo\'sh/null → null', () => {
    expect(normalizeDate(null)).toBeNull()
    expect(normalizeDate(undefined)).toBeNull()
    expect(normalizeDate('')).toBeNull()
  })
})

describe('normalizePlate', () => {
  it('probel va nuqtalar olib tashlanadi, katta harfga o\'tadi', () => {
    expect(normalizePlate('01 a 123 bc')).toBe('01A123BC')
    expect(normalizePlate('01.A.123.BC')).toBe('01A123BC')
  })

  it('turlicha yozilgan bir xil raqam bir xil kanonik ko\'rinishga keladi', () => {
    expect(normalizePlate('01 A 123 BC')).toBe(normalizePlate('01a123bc'))
  })

  it('bo\'sh/null → bo\'sh satr', () => {
    expect(normalizePlate(null)).toBe('')
    expect(normalizePlate(undefined)).toBe('')
  })
})

describe('computeRowCost — kirimda qator narxi (pul harakati)', () => {
  it('vedomostda summa bor → o\'sha summa ishlatiladi (tarixiy narx e\'tiborsiz)', () => {
    expect(computeRowCost(150000, 30, 5000)).toBe(150000)
  })

  it('summa 0, tarixiy narx bor → miqdor × narx, yaxlitlangan', () => {
    expect(computeRowCost(0, 30, 5000)).toBe(150000)
    // 33.33 m3 × 4300 = 143319 (yaxlitlash tekshiruvi)
    expect(computeRowCost(0, 33.33, 4300)).toBe(Math.round(33.33 * 4300))
  })

  it('summa 0, tarixiy narx yo\'q → 0 qoladi (soxta narx yozilmaydi)', () => {
    expect(computeRowCost(0, 30, null)).toBe(0)
    expect(computeRowCost(0, 30, undefined)).toBe(0)
  })

  it('tarixiy narx 0 bo\'lsa ham 0 qoladi (0 ga ko\'paytirilmaydi)', () => {
    expect(computeRowCost(0, 30, 0)).toBe(0)
  })
})
