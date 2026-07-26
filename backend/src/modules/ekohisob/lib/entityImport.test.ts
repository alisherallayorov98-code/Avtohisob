import {
  detectColumns,
  normalizePlaceName,
  parseAmount,
  parsePhone,
  parseBillingMode,
  parseContractMonth,
  parseImportRow,
  findDuplicates,
  collectNewPlaces,
  ColumnKey,
  ParsedEntityRow,
} from './entityImport'

describe('detectColumns — sarlavhalarni tanish', () => {
  it('o\'zbekcha sarlavhalarni tanidi', () => {
    const cols = detectColumns(['Nomi', 'STIR', 'Manzil', 'Telefon', 'Tuman', 'Mahalla', 'Oylik'])
    expect(cols).toMatchObject({
      name: 0, stir: 1, address: 2, phone: 3, district: 4, mahalla: 5, monthlyFee: 6,
    })
  })

  it('ruscha/kirill sarlavhalarni tanidi', () => {
    const cols = detectColumns(['Наименование', 'ИНН', 'Адрес', 'Район', 'Махалла'])
    expect(cols).toMatchObject({ name: 0, stir: 1, address: 2, district: 3, mahalla: 4 })
  })

  it('qisman moslik: "Tashkilot nomi (to\'liq)" → name', () => {
    const cols = detectColumns(['Tashkilot nomi (to\'liq)', 'Tuman nomi'])
    expect(cols.name).toBe(0)
    expect(cols.district).toBe(1)
  })

  it('"kub narxi" oylik summa bilan chalkashmaydi', () => {
    const cols = detectColumns(['Nomi', 'Oylik summa', 'Kub narxi'])
    expect(cols.monthlyFee).toBe(1)
    expect(cols.cubicPrice).toBe(2)
  })

  it('yo\'q ustunlar undefined qoladi', () => {
    const cols = detectColumns(['Nomi'])
    expect(cols.stir).toBeUndefined()
  })
})

describe('normalizePlaceName — imlo farqlarini yutish', () => {
  it('"Chilonzor tumani" va "chilonzor" bir xil kalit beradi', () => {
    expect(normalizePlaceName('Chilonzor tumani')).toBe(normalizePlaceName('chilonzor'))
  })
  it('apostrof va ortiqcha bo\'shliq ta\'sir qilmaydi', () => {
    expect(normalizePlaceName("Yangi  Hayot   MFY")).toBe(normalizePlaceName("Yangi Hayot"))
  })
  it('mahalla qo\'shimchasi olib tashlanadi', () => {
    expect(normalizePlaceName('Navbahor mahallasi')).toBe('navbahor')
  })
})

describe('parseAmount — summa', () => {
  it('bo\'shliqli va vergulli summalarni o\'qiydi', () => {
    expect(parseAmount('1 200 000')).toBe(1200000)
    expect(parseAmount('1,200,000')).toBe(1200000)
    expect(parseAmount(450000)).toBe(450000)
  })
  it('kasr yaxlitlanadi, bo\'sh → null', () => {
    expect(parseAmount('99999.6')).toBe(100000)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(null)).toBeNull()
  })
  it('son bo\'lmasa null', () => {
    expect(parseAmount('yo\'q')).toBeNull()
  })
})

describe('parsePhone — telefon normallashtirish', () => {
  it('turli ko\'rinishlar 998XXXXXXXXX ga keltiriladi', () => {
    expect(parsePhone('+998 90 123-45-67')).toBe('998901234567')
    expect(parsePhone('901234567')).toBe('998901234567')
    expect(parsePhone('0901234567')).toBe('998901234567')
  })
  it('tanib bo\'lmasa null (telefon majburiy emas)', () => {
    expect(parsePhone('123')).toBeNull()
    expect(parsePhone('')).toBeNull()
  })
})

describe('parseBillingMode', () => {
  it('talon/kub → talon', () => {
    expect(parseBillingMode('Talon')).toBe('talon')
    expect(parseBillingMode('kub asosida')).toBe('talon')
  })
  it('oylik/belgilangan → monthly_fixed', () => {
    expect(parseBillingMode('Belgilangan oylik')).toBe('monthly_fixed')
    expect(parseBillingMode('ойлик')).toBe('monthly_fixed')
  })
  it('bo\'sh yoki noma\'lum → variable', () => {
    expect(parseBillingMode('')).toBe('variable')
    expect(parseBillingMode('boshqa')).toBe('variable')
  })
})

describe('parseContractMonth', () => {
  it('turli sana formatlari "YYYY-MM" ga keltiriladi', () => {
    expect(parseContractMonth('2026-03')).toBe('2026-03')
    expect(parseContractMonth('03.2026')).toBe('2026-03')
    expect(parseContractMonth('01.03.2026')).toBe('2026-03')
    expect(parseContractMonth('2026-03-15')).toBe('2026-03')
  })
  it('Excel Date obyekti', () => {
    expect(parseContractMonth(new Date('2026-07-15T00:00:00Z'))).toBe('2026-07')
  })
  it('o\'qib bo\'lmasa null', () => {
    expect(parseContractMonth('kecha')).toBeNull()
    expect(parseContractMonth('')).toBeNull()
  })
})

describe('parseImportRow — qator tekshiruvi', () => {
  const cols: Partial<Record<ColumnKey, number>> = {
    name: 0, stir: 1, district: 2, mahalla: 3, billingMode: 4, monthlyFee: 5, cubicPrice: 6, phone: 7,
  }

  it('to\'g\'ri qator qabul qilinadi va normallashtiriladi', () => {
    const r = parseImportRow(
      ['"Oq Yo\'l" MChJ', '123456789', 'Chilonzor', 'Navbahor', 'Belgilangan oylik', '450 000', '', '901234567'],
      cols, 2,
    )
    expect(r.ok).toBe(true)
    expect(r.row).toMatchObject({
      name: '"Oq Yo\'l" MChJ',
      stir: '123456789',
      districtName: 'Chilonzor',
      billingMode: 'monthly_fixed',
      monthlyFee: 450000,
      cubicPrice: 0,
      phone: '998901234567',
    })
  })

  it('nom bo\'sh → xato', () => {
    const r = parseImportRow(['', '', 'Chilonzor'], cols, 5)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatchObject({ rowNumber: 5, column: 'name' })
  })

  it('tuman yo\'q → xato, lekin standart tuman berilsa qabul qilinadi', () => {
    expect(parseImportRow(['Test', '', ''], cols, 3).ok).toBe(false)
    const withDefault = parseImportRow(['Test', '', ''], cols, 3, { defaultDistrictName: 'Yunusobod' })
    expect(withDefault.ok).toBe(true)
    expect(withDefault.row!.districtName).toBe('Yunusobod')
  })

  it('belgilangan oylik rejimida summa yo\'q → xato', () => {
    const r = parseImportRow(['Test', '', 'Chilonzor', '', 'oylik', '0', ''], cols, 4)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => e.column === 'monthlyFee')).toBe(true)
  })

  it('talon rejimida kub narxi yo\'q → xato', () => {
    const r = parseImportRow(['Test', '', 'Chilonzor', '', 'talon', '', '0'], cols, 6)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => e.column === 'cubicPrice')).toBe(true)
  })

  it('talon rejimida oylik summa nolga tushiriladi (chalkashmasin)', () => {
    const r = parseImportRow(['Test', '', 'Chilonzor', '', 'talon', '500000', '35000'], cols, 7)
    expect(r.ok).toBe(true)
    expect(r.row).toMatchObject({ billingMode: 'talon', monthlyFee: 0, cubicPrice: 35000 })
  })

  it('STIR 9 xonali bo\'lmasa xato', () => {
    const r = parseImportRow(['Test', '12345', 'Chilonzor'], cols, 8)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => e.column === 'stir')).toBe(true)
  })

  it('noto\'g\'ri telefon qatorni buzmaydi (null qoladi)', () => {
    const r = parseImportRow(['Test', '', 'Chilonzor', '', '', '', '', 'xato'], cols, 9)
    expect(r.ok).toBe(true)
    expect(r.row!.phone).toBeNull()
  })
})

describe('findDuplicates — fayl ichidagi takror STIR', () => {
  const mk = (rowNumber: number, stir: string | null): ParsedEntityRow => ({
    rowNumber, name: 'T' + rowNumber, stir, code: null, address: null, phone: null,
    contactName: null, districtName: 'D', mahallaName: null, billingMode: 'variable',
    monthlyFee: 0, cubicPrice: 0, contractNumber: null, contractStartMonth: null, lat: null, lon: null,
  })

  it('birinchi uchrash qoladi, keyingilari takror', () => {
    const { unique, duplicates } = findDuplicates([mk(2, '111111111'), mk(3, '222222222'), mk(4, '111111111')])
    expect(unique.map(u => u.rowNumber)).toEqual([2, 3])
    expect(duplicates).toEqual([{ rowNumber: 4, stir: '111111111', firstRowNumber: 2 }])
  })

  it('STIRsiz qatorlar takror deb hisoblanmaydi', () => {
    const { unique, duplicates } = findDuplicates([mk(2, null), mk(3, null)])
    expect(unique).toHaveLength(2)
    expect(duplicates).toHaveLength(0)
  })
})

describe('collectNewPlaces — yaratiladigan tuman/mahalla', () => {
  const mk = (district: string, mahalla: string | null): ParsedEntityRow => ({
    rowNumber: 1, name: 'T', stir: null, code: null, address: null, phone: null,
    contactName: null, districtName: district, mahallaName: mahalla, billingMode: 'variable',
    monthlyFee: 0, cubicPrice: 0, contractNumber: null, contractStartMonth: null, lat: null, lon: null,
  })

  it('mavjud tuman (imlo farqi bilan) qayta yaratilmaydi', () => {
    const r = collectNewPlaces(
      [mk('Chilonzor tumani', null)],
      [{ id: 'd1', name: 'Chilonzor' }],
      [],
    )
    expect(r.newDistricts).toEqual([])
  })

  it('yangi tuman va mahalla ro\'yxatga tushadi', () => {
    const r = collectNewPlaces(
      [mk('Yunusobod', 'Navbahor'), mk('Yunusobod', 'Navbahor')],
      [],
      [],
    )
    expect(r.newDistricts).toEqual(['Yunusobod'])
    expect(r.newMahallas).toEqual([{ district: 'Yunusobod', mahalla: 'Navbahor' }])
  })

  it('mavjud tumandagi mavjud mahalla qayta yaratilmaydi', () => {
    const r = collectNewPlaces(
      [mk('Chilonzor', 'Navbahor mahallasi')],
      [{ id: 'd1', name: 'Chilonzor' }],
      [{ id: 'm1', name: 'Navbahor', districtId: 'd1' }],
    )
    expect(r.newMahallas).toEqual([])
  })

  it('boshqa tumandagi bir xil nomli mahalla alohida yaratiladi', () => {
    const r = collectNewPlaces(
      [mk('Yunusobod', 'Navbahor')],
      [{ id: 'd1', name: 'Chilonzor' }, { id: 'd2', name: 'Yunusobod' }],
      [{ id: 'm1', name: 'Navbahor', districtId: 'd1' }],
    )
    expect(r.newMahallas).toEqual([{ district: 'Yunusobod', mahalla: 'Navbahor' }])
  })
})
