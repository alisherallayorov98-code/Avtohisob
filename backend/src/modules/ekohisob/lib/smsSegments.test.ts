// SMS segment hisobi (GSM-7 vs UCS-2) — operator haqi shunga bog'liq.
import { smsSegments, smsEncoding, toGsmSafe, smsLength } from './smsTemplate'

describe('smsSegments — GSM-7 (160 / 153)', () => {
  it('chegaralar: 160 → 1, 161 → 2, 306 → 2, 307 → 3', () => {
    expect(smsSegments('a'.repeat(160))).toMatchObject({ encoding: 'gsm7', segments: 1 })
    expect(smsSegments('a'.repeat(161)).segments).toBe(2)
    expect(smsSegments('a'.repeat(306)).segments).toBe(2)
    expect(smsSegments('a'.repeat(307)).segments).toBe(3)
  })

  it('kengaytma belgilari (€ { } [ ] \\ ^ ~ |) 2 septet', () => {
    expect(smsSegments('€').units).toBe(2)
    expect(smsSegments('{}[]\\^~|').units).toBe(16)
    expect(smsSegments('€'.repeat(80))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 })
    expect(smsSegments('€'.repeat(81)).segments).toBe(2)
  })

  it("kengaytma belgisi segment chegarasida bo'linmaydi", () => {
    // 152 + € (2) = 154 > 153 → € keyingi segmentga; 2 + 152 = 154 > 153 → uchinchi segment
    expect(smsSegments('a'.repeat(152) + '€' + 'a'.repeat(152)).segments).toBe(3)
  })

  it("o'zbek lotin matni oddiy apostrof bilan GSM-7", () => {
    expect(smsEncoding("Hurmatli mijoz, so'm")).toBe('gsm7')
    expect(smsEncoding("o' g' O' G'")).toBe('gsm7')
  })
})

describe('smsSegments — UCS-2 (70 / 67)', () => {
  it('chegaralar: 70 → 1, 71 → 2, 134 → 2, 135 → 3', () => {
    expect(smsSegments('я'.repeat(70))).toMatchObject({ encoding: 'ucs2', segments: 1 })
    expect(smsSegments('я'.repeat(71)).segments).toBe(2)
    expect(smsSegments('я'.repeat(134)).segments).toBe(2)
    expect(smsSegments('я'.repeat(135)).segments).toBe(3)
  })

  it("BITTA UCS-2 belgi butun xabarni UCS-2 ga o'tkazadi", () => {
    const text = 'a'.repeat(100) + 'ў'
    expect(smsSegments(text)).toMatchObject({ encoding: 'ucs2', segments: 2 })
    expect(smsSegments('a'.repeat(100)).segments).toBe(1)
  })

  it("emoji 2 birlik, surrogat juft bo'linmaydi", () => {
    expect(smsSegments('😀'.repeat(35))).toMatchObject({ encoding: 'ucs2', units: 70, segments: 1 })
    expect(smsSegments('😀'.repeat(36)).segments).toBe(2) // 33 (66 birlik) + 3
    expect(smsSegments('😀'.repeat(70)).segments).toBe(3) // 33 + 33 + 4: 67 birlikka 34-emoji sig'maydi
  })

  it("UCS-2 ga o'tkazuvchi belgilar (o'zbek matnida tipik)", () => {
    for (const ch of ['ʻ', 'ʼ', '‘', '’', '´', '`', '“', '”', '–', '—', 'ç', 'ў', 'ғ', 'қ', 'ҳ', 'ё', '№']) {
      expect(smsEncoding(`so${ch}m`)).toBe('ucs2')
    }
  })

  it("GSM-7 da bor aksentli harflar UCS-2 ga o'tkazmaydi", () => {
    for (const ch of ['é', 'è', 'ù', 'ñ', 'ü', 'ö', 'ä', 'à', 'ß', 'Ø', 'å', '€', '@', '£', '$', '¥']) {
      expect(smsEncoding(`a${ch}b`)).toBe('gsm7')
    }
  })

  it("bo'sh matn → 0 segment", () => expect(smsSegments('').segments).toBe(0))
})

describe('toGsmSafe', () => {
  it("tipografik belgilarni ASCII ga keltirib, UCS-2 dan qutqaradi", () => {
    const raw = 'Hurmatli mijoz! Soʻm — qarz “10 000”… Oʼzbekiston'
    expect(smsEncoding(raw)).toBe('ucs2')
    const safe = toGsmSafe(raw)
    expect(safe).toBe('Hurmatli mijoz! So\'m - qarz "10 000"... O\'zbekiston')
    expect(smsEncoding(safe)).toBe('gsm7')
  })

  it('kirill harflariga tegmaydi', () => {
    expect(toGsmSafe('Қарз')).toBe('Қарз')
  })

  it('segment soni arzonlashadi', () => {
    const raw = 'ʻ'.repeat(5) + 'a'.repeat(100)
    expect(smsSegments(raw).segments).toBe(2)
    expect(smsSegments(toGsmSafe(raw)).segments).toBe(1)
  })
})

describe('smsLength — yangi maydonlar mos', () => {
  it('unicode/segments segment hisobi bilan bir xil', () => {
    const t = 'Қарз ' + 'я'.repeat(80)
    const l = smsLength(t)
    expect(l.unicode).toBe(true)
    expect(l.segments).toBe(smsSegments(t).segments)
    expect(l.encoding).toBe('ucs2')
  })
})
