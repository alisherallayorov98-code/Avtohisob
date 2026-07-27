import { detectStoppedPaying, findStoppedPaying } from './paymentBehavior'

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']

const paid = (...ms: string[]) => new Set(ms)

describe('detectStoppedPaying', () => {
  it('muntazam to\'lagan, keyin 3 oy to\'xtagan → aniqlanadi', () => {
    const r = detectStoppedPaying({
      months: MONTHS,
      paidMonths: paid('2026-01', '2026-02', '2026-03', '2026-04'),
    })
    expect(r).toMatchObject({
      stopped: true, lastPaidMonth: '2026-04', gapMonths: 3, paidBeforeGap: 4,
    })
  })

  it('hech qachon to\'lamagan → "to\'xtatgan" EMAS', () => {
    // Bunday mijoz oddiy qarzdorlar ro'yxatida qamrab olinadi;
    // uni "to'xtatgan" deb ko'rsatish chalg'ituvchi bo'lardi.
    const r = detectStoppedPaying({ months: MONTHS, paidMonths: paid() })
    expect(r.stopped).toBe(false)
    expect(r.lastPaidMonth).toBeNull()
  })

  it('tarixi qisqa (2 oy to\'lagan) → to\'xtatgan deb sanalmaydi', () => {
    const r = detectStoppedPaying({
      months: MONTHS, paidMonths: paid('2026-01', '2026-02'),
    })
    expect(r.paidBeforeGap).toBe(2)
    expect(r.stopped).toBe(false)
  })

  it('uzilish qisqa (1 oy) → hali to\'xtatgan emas', () => {
    const r = detectStoppedPaying({
      months: MONTHS,
      paidMonths: paid('2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'),
    })
    expect(r.gapMonths).toBe(1)
    expect(r.stopped).toBe(false)
  })

  it('hozir ham to\'layapti → to\'xtatgan emas', () => {
    const r = detectStoppedPaying({ months: MONTHS, paidMonths: new Set(MONTHS) })
    expect(r).toMatchObject({ stopped: false, gapMonths: 0, regularity: 100 })
  })

  it('uzilishlar bo\'lgan, lekin oxirida to\'lagan → to\'xtatgan emas', () => {
    const r = detectStoppedPaying({
      months: MONTHS, paidMonths: paid('2026-01', '2026-03', '2026-05', '2026-07'),
    })
    expect(r.stopped).toBe(false)
    expect(r.regularity).toBe(57)
  })

  it('chegaralarni sozlash mumkin', () => {
    const input = { months: MONTHS, paidMonths: paid('2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06') }
    expect(detectStoppedPaying({ ...input, minGap: 1 }).stopped).toBe(true)
    expect(detectStoppedPaying({ ...input, minGap: 2 }).stopped).toBe(false)
  })

  it('bo\'sh oylar ro\'yxati xato bermaydi', () => {
    expect(detectStoppedPaying({ months: [], paidMonths: paid() })).toMatchObject({
      stopped: false, regularity: 0,
    })
  })
})

describe('findStoppedPaying', () => {
  it('faqat to\'xtatganlar qaytadi va yo\'qotilgan summa bo\'yicha tartiblanadi', () => {
    const rows = findStoppedPaying([
      {
        entityId: 'kichik',
        months: MONTHS,
        paidMonths: paid('2026-01', '2026-02', '2026-03', '2026-04'),
        avgPayment: 100000,   // 3 oy × 100k = 300k
      },
      {
        entityId: 'katta',
        months: MONTHS,
        paidMonths: paid('2026-01', '2026-02', '2026-03'),
        avgPayment: 500000,   // 4 oy × 500k = 2 mln
      },
      {
        entityId: 'tolayapti',
        months: MONTHS,
        paidMonths: new Set(MONTHS),
        avgPayment: 900000,
      },
    ])
    expect(rows.map(r => r.entityId)).toEqual(['katta', 'kichik'])
    expect(rows[0].estimatedLoss).toBe(2000000)
    expect(rows[1].estimatedLoss).toBe(300000)
  })

  it('hech kim to\'xtatmagan bo\'lsa bo\'sh ro\'yxat', () => {
    expect(findStoppedPaying([
      { entityId: 'a', months: MONTHS, paidMonths: new Set(MONTHS), avgPayment: 1000 },
    ])).toEqual([])
  })
})
