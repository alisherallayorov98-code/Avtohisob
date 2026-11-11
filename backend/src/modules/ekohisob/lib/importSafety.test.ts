import ExcelJS from 'exceljs'
import {
  parseAmount, normalizePlaceName, findHeaderRowIndex, mergeImportRow, parseImportRow, detectColumns,
  ExistingForMerge, ParsedEntityRow,
} from './entityImport'
import { checkXlsxUpload, hasZipMagic, DEFAULT_XLSX_LIMITS } from './xlsxGuard'
import { findDuplicateGroups, normalizeEntityName, nameKey } from './duplicateDetect'
import { parseVisitInput, findBrokenPromises, addDaysIso } from './visitMath'

describe('parseAmount — ming ajratgichlar', () => {
  it.each([
    ['1.200.000', 1200000],
    ['1,200,000', 1200000],
    ['1 200 000', 1200000],
    ['1 200 000', 1200000],
    ['1.200', 1200],
    ['450.000', 450000],
    ['1200000.00', 1200000],
    ['1.200,50', 1201],
    ['1,200.50', 1201],
    ['450 000 so\'m', 450000],
    ['450000', 450000],
  ])('%s → %d', (input, out) => {
    expect(parseAmount(input)).toBe(out)
  })
  it('raqam bo\'lmasa null, son o\'zi qaytadi', () => {
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('-')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount(450000)).toBe(450000)
    expect(parseAmount(NaN)).toBeNull()
  })
})

describe('parseImportRow — chegaralar va ogohlantirishlar', () => {
  const cols = detectColumns(['Nomi', 'Tuman', 'Telefon', 'Rejim', 'Oylik', 'Kub narxi', 'Manzil', 'lat', 'lon'])
  const run = (cells: unknown[]) => parseImportRow(cells, cols, 5)

  it('Int chegarasidan katta summa — xato (bazani sindirmaydi)', () => {
    const r = run(['A', 'Chilonzor', '', 'oylik', '99999999999', '', '', '', ''])
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => e.column === 'monthlyFee')).toBe(true)
  })
  it('raqam bo\'lmagan summa jimgina 0 bo\'lmaydi', () => {
    const r = run(['A', 'Chilonzor', '', 'oylik', 'ko\'p', '', '', '', ''])
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).toMatch(/raqam emas/)
  })
  it('juda uzun nom/manzil — xato', () => {
    expect(run(['A'.repeat(201), 'Ch', '', '', '', '', '', '', '']).ok).toBe(false)
    expect(run(['A', 'Ch', '', '', '', '', 'x'.repeat(301), '', '']).ok).toBe(false)
  })
  it('noto\'g\'ri telefon — qator o\'tadi, lekin ogohlantirish bor, telefon saqlanmaydi', () => {
    const r = run(['A', 'Chilonzor', '12345', '', '', '', '', '', ''])
    expect(r.ok).toBe(true)
    expect(r.row!.phone).toBeNull()
    expect(r.warnings.some(w => w.column === 'phone')).toBe(true)
  })
  it('bo\'sh telefon ogohlantirish bermaydi', () => {
    expect(run(['A', 'Chilonzor', '', '', '', '', '', '', '']).warnings).toHaveLength(0)
  })
  it('yarim koordinata / (0,0) saqlanmaydi + ogohlantirish', () => {
    const r = run(['A', 'Chilonzor', '', '', '', '', '', '41.3', ''])
    expect(r.row!.lat).toBeNull()
    expect(r.warnings.some(w => w.column === 'lat')).toBe(true)
    const z = run(['A', 'Chilonzor', '', '', '', '', '', '0', '0'])
    expect(z.row!.lat).toBeNull()
  })
  it('billingModeGiven: Rejim katagi bo\'sh bo\'lsa false', () => {
    expect(run(['A', 'Ch', '', '', '', '', '', '', '']).row!.billingModeGiven).toBe(false)
    expect(run(['A', 'Ch', '', 'talon', '', '35000', '', '', '']).row!.billingModeGiven).toBe(true)
  })
})

describe('normalizePlaceName — kirill/lotin', () => {
  it('kirill va lotin bir xil kalit beradi', () => {
    expect(normalizePlaceName('Чилонзор тумани')).toBe(normalizePlaceName('Chilonzor'))
    expect(normalizePlaceName('Юнусобод')).toBe(normalizePlaceName('YUNUSOBOD tumani'))
    expect(normalizePlaceName('Навбаҳор МФЙ')).toBe(normalizePlaceName('Navbahor mahallasi'))
  })
  it('turli joylar aralashmaydi', () => {
    expect(normalizePlaceName('Chilonzor')).not.toBe(normalizePlaceName('Yunusobod'))
  })
})

describe('findHeaderRowIndex — sarlavha 1–10 qator ichida', () => {
  it('birinchi qatorlar sarlavha emas (logo/sana) bo\'lsa ham topadi', () => {
    const rows = [
      ['Ro\'yxat'],
      ['10.11.2026'],
      ['Nomi', 'STIR', 'Tuman'],
      ['Oq Yo\'l', '123456789', 'Chilonzor'],
    ]
    expect(findHeaderRowIndex(rows)).toBe(2)
  })
  it('1-qator sarlavha bo\'lsa 0', () => {
    expect(findHeaderRowIndex([['Nomi', 'Tuman'], ['A', 'B']])).toBe(0)
  })
  it('"Nomi" bo\'lmasa -1; 10-qatordan keyingisi qidirilmaydi', () => {
    expect(findHeaderRowIndex([['x', 'y']])).toBe(-1)
    const far = Array.from({ length: 11 }, () => ['bo\'sh'])
    far[10] = ['Nomi', 'Tuman']
    expect(findHeaderRowIndex(far)).toBe(-1)
  })
  it('bir nechta nomzoddan eng ko\'p ustun mos kelganini tanlaydi', () => {
    const rows = [['Nomi'], ['Nomi', 'STIR', 'Tuman', 'Telefon']]
    expect(findHeaderRowIndex(rows)).toBe(1)
  })
})

describe('mergeImportRow — BO\'SH katak bazadagini o\'chirmaydi', () => {
  const existing: ExistingForMerge = {
    name: 'Oq Yo\'l', code: 'K1', address: 'Eski manzil', phone: '998901234567', contactName: 'Aliyev',
    billingMode: 'talon', monthlyFee: 0, cubicPrice: 35000, contractNumber: 'SH-1', contractStartMonth: '2026-01',
    lat: 41.3, lon: 69.2, districtName: 'Chilonzor', mahallaName: 'Navbahor',
  }
  const emptyRow: ParsedEntityRow = {
    rowNumber: 2, name: 'Oq Yo\'l', stir: '123456789', code: null, address: null, phone: null, contactName: null,
    districtName: 'Chilonzor', mahallaName: null, billingMode: 'variable', billingModeGiven: false,
    monthlyFee: 0, cubicPrice: 0, contractNumber: null, contractStartMonth: null, lat: null, lon: null,
  }

  it('hamma katak bo\'sh → hech narsa o\'zgarmaydi', () => {
    const m = mergeImportRow(existing, emptyRow)
    expect(m.changes).toEqual([])
    expect(m.patch).toEqual({})
    expect(m.districtChanged).toBe(false)
    expect(m.mahallaChanged).toBe(false)
  })
  it('bo\'sh Rejim katagi talon rejimini variable ga TUSHIRMAYDI', () => {
    const m = mergeImportRow(existing, { ...emptyRow, address: 'Yangi manzil' })
    expect(m.patch).toEqual({ address: 'Yangi manzil' })
    expect(m.patch).not.toHaveProperty('billingMode')
    expect(m.patch).not.toHaveProperty('monthlyFee')
    expect(m.patch).not.toHaveProperty('cubicPrice')
  })
  it('faqat to\'ldirilgan maydonlar yangilanadi va eski→yangi diff beradi', () => {
    const m = mergeImportRow(existing, { ...emptyRow, address: 'Yangi', phone: '998935556677', cubicPrice: 40000 })
    expect(m.changes).toEqual(expect.arrayContaining([
      { field: 'address', from: 'Eski manzil', to: 'Yangi' },
      { field: 'phone', from: '998901234567', to: '998935556677' },
      { field: 'cubicPrice', from: 35000, to: 40000 },
    ]))
    expect(m.changes).toHaveLength(3)
  })
  it('xuddi shu qiymat o\'zgarish hisoblanmaydi', () => {
    const m = mergeImportRow(existing, { ...emptyRow, address: 'Eski manzil', code: 'K1' })
    expect(m.changes).toEqual([])
  })
  it('summa 0 bo\'lsa (bo\'sh) mavjud oylik/kub narxini nolga tushirmaydi', () => {
    const ex = { ...existing, billingMode: 'monthly_fixed', monthlyFee: 450000, cubicPrice: 0 }
    expect(mergeImportRow(ex, emptyRow).patch).toEqual({})
  })
  it('tuman o\'zgarsa, eski tuman mahallasi qolib ketmasin (mahallaChanged)', () => {
    const m = mergeImportRow(existing, { ...emptyRow, districtName: 'Yunusobod' })
    expect(m.districtChanged).toBe(true)
    expect(m.mahallaChanged).toBe(true)
  })
  it('tuman nomi kirillda yozilsa o\'zgarish hisoblanmaydi', () => {
    expect(mergeImportRow(existing, { ...emptyRow, districtName: 'Чилонзор тумани' }).districtChanged).toBe(false)
  })
  it('koordinata faqat ikkalasi ham bo\'lsa yangilanadi', () => {
    const m = mergeImportRow(existing, { ...emptyRow, lat: 41.4, lon: 69.3 })
    expect(m.patch).toMatchObject({ lat: 41.4, lon: 69.3 })
    expect(m.changes[0].field).toBe('location')
  })
})

describe('checkXlsxUpload — fayl turi va hajm', () => {
  async function makeXlsx(rows = 3): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('T')
    ws.addRow(['Nomi', 'Tuman'])
    for (let i = 0; i < rows; i++) ws.addRow([`Org ${i}`, 'Chilonzor'])
    return Buffer.from(await wb.xlsx.writeBuffer())
  }

  it('haqiqiy .xlsx o\'tadi va dimension o\'qiladi', async () => {
    const buffer = await makeXlsx(5)
    expect(hasZipMagic(buffer)).toBe(true)
    const r = checkXlsxUpload({ originalname: 'import.XLSX', buffer })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.info.dimensionRows).toBe(6)
      expect(r.info.dimensionCols).toBe(2)
    }
  })
  it('kengaytma .xlsx emas → rad', async () => {
    const buffer = await makeXlsx()
    expect(checkXlsxUpload({ originalname: 'import.xls', buffer }).ok).toBe(false)
    expect(checkXlsxUpload({ originalname: 'import.xlsx.exe', buffer }).ok).toBe(false)
  })
  it('sehrli baytlar (PK\\x03\\x04) bo\'lmasa rad — kengaytma yolg\'on bo\'lsa', () => {
    const fake = Buffer.from('<html>bu excel emas</html>')
    expect(hasZipMagic(fake)).toBe(false)
    expect(checkXlsxUpload({ originalname: 'a.xlsx', buffer: fake }).ok).toBe(false)
    expect(checkXlsxUpload({ originalname: 'a.xlsx', buffer: Buffer.alloc(0) }).ok).toBe(false)
  })
  it('ZIP, lekin Excel emas (oddiy zip) → rad; kesilgan fayl → rad', async () => {
    const buffer = await makeXlsx()
    expect(checkXlsxUpload({ originalname: 'a.xlsx', buffer: buffer.subarray(0, 100) }).ok).toBe(false)
  })
  it('varaq qator chegarasi (dimension) tekshiriladi', async () => {
    const buffer = await makeXlsx(20)
    const r = checkXlsxUpload({ originalname: 'a.xlsx', buffer }, { ...DEFAULT_XLSX_LIMITS, maxRows: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/qator/)
  })
  it('ochilgan hajm chegarasi (zip bomba himoyasi) tekshiriladi', async () => {
    const buffer = await makeXlsx(20)
    const r = checkXlsxUpload({ originalname: 'a.xlsx', buffer }, { ...DEFAULT_XLSX_LIMITS, maxTotalUncompressed: 100 })
    expect(r.ok).toBe(false)
  })
})

describe('duplicateDetect — yangi qoidalar', () => {
  it('"savdo", "markazi" mazmunli so\'zlar — "Bahor savdo markazi" ≠ "Bahor"', () => {
    expect(normalizeEntityName('Bahor savdo markazi')).toBe('bahor savdo markazi')
    const g = findDuplicateGroups([
      { id: 'a', name: 'Bahor savdo markazi', districtId: 'd1' },
      { id: 'b', name: 'Bahor', districtId: 'd1' },
    ])
    expect(g).toHaveLength(0)
  })
  it('kirill va lotin nom bitta kalit (similarEntities.nameKey bilan bir xil mantiq)', () => {
    expect(nameKey('«Оқ йўл» МЧЖ')).toBe(nameKey('"Oq Yo\'l" MChJ'))
    const g = findDuplicateGroups([
      { id: 'a', name: 'Нур МЧЖ', districtId: 'd1' },
      { id: 'b', name: 'NUR mchj', districtId: 'd1' },
    ])
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ reason: 'name', level: 'medium', ids: ['a', 'b'] })
  })
  it('bir xil nom TURLI tumanda takror deb chiqmaydi', () => {
    const g = findDuplicateGroups([
      { id: 'a', name: 'Bahor', districtId: 'd1' },
      { id: 'b', name: 'Bahor', districtId: 'd2' },
    ])
    expect(g).toHaveLength(0)
  })
  it('includeCrossDistrict bilan faqat past darajali ogohlantirish', () => {
    const g = findDuplicateGroups([
      { id: 'a', name: 'Bahor', districtId: 'd1' },
      { id: 'b', name: 'Bahor', districtId: 'd2' },
    ], { includeCrossDistrict: true })
    expect(g).toHaveLength(1)
    expect(g[0].level).toBe('low')
  })
  it('STIR bir xil bo\'lsa tumandan qat\'i nazar yuqori daraja', () => {
    const g = findDuplicateGroups([
      { id: 'a', name: 'A', stir: '123456789', districtId: 'd1' },
      { id: 'b', name: 'B', stir: '123456789', districtId: 'd2' },
    ])
    expect(g[0]).toMatchObject({ reason: 'stir', level: 'high' })
  })
  it('tuman berilmasa (eski chaqiruvlar) avvalgi xatti-harakat saqlanadi', () => {
    const g = findDuplicateGroups([{ id: 'a', name: 'Bahor' }, { id: 'b', name: 'BAHOR' }])
    expect(g).toHaveLength(1)
  })
})

describe('visitMath', () => {
  const today = '2026-11-10'
  it('kind whitelist, not_paid uchun sabab majburiy', () => {
    expect(parseVisitInput({ kind: 'x' }, today).ok).toBe(false)
    expect(parseVisitInput({ kind: 'not_paid' }, today).ok).toBe(false)
    expect(parseVisitInput({ kind: 'not_paid', reason: 'Yopiq edi' }, today).ok).toBe(true)
    expect(parseVisitInput({ kind: 'visited' }, today).ok).toBe(true)
  })
  it('promised: sana majburiy, haqiqiy, o\'tmagan, 90 kundan uzoq emas', () => {
    expect(parseVisitInput({ kind: 'promised' }, today).ok).toBe(false)
    expect(parseVisitInput({ kind: 'promised', promisedDate: '2026-02-30' }, today).ok).toBe(false)
    expect(parseVisitInput({ kind: 'promised', promisedDate: '2026-11-09' }, today).ok).toBe(false)
    expect(parseVisitInput({ kind: 'promised', promisedDate: '2027-06-01' }, today).ok).toBe(false)
    const ok = parseVisitInput({ kind: 'promised', promisedDate: '2026-11-15' }, today)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.promisedDate!.toISOString()).toBe('2026-11-15T00:00:00.000Z')
    expect(parseVisitInput({ kind: 'promised', promisedDate: today }, today).ok).toBe(true)
  })
  it('promisedDate faqat promised uchun; koordinata tekshiriladi', () => {
    expect(parseVisitInput({ kind: 'visited', promisedDate: '2026-11-15' }, today).ok).toBe(false)
    expect(parseVisitInput({ kind: 'visited', lat: 'x', lon: 1 }, today).ok).toBe(false)
    const r = parseVisitInput({ kind: 'visited', lat: 41.3, lon: 69.2 }, today)
    expect(r.ok && r.value.lat).toBe(41.3)
  })
  it('addDaysIso', () => {
    expect(addDaysIso('2026-11-30', 1)).toBe('2026-12-01')
  })

  it('findBrokenPromises: o\'tgan/bugungi va\'da, to\'lov yo\'q → bajarilmagan', () => {
    const v = [{ id: 'v1', entityId: 'e1', promisedDate: '2026-11-08', createdAt: new Date('2026-11-05T10:00:00Z') }]
    const r = findBrokenPromises(v, [], today)
    expect(r).toEqual([{ visitId: 'v1', entityId: 'e1', promisedDate: '2026-11-08', daysOverdue: 2 }])
  })
  it('va\'dadan KEYIN to\'lov bo\'lsa bajarilgan; oldingi to\'lov hisobga olinmaydi', () => {
    const v = [{ id: 'v1', entityId: 'e1', promisedDate: '2026-11-08', createdAt: new Date('2026-11-05T10:00:00Z') }]
    expect(findBrokenPromises(v, [{ entityId: 'e1', paidAt: new Date('2026-11-07T10:00:00Z') }], today)).toHaveLength(0)
    expect(findBrokenPromises(v, [{ entityId: 'e1', paidAt: new Date('2026-11-01T10:00:00Z') }], today)).toHaveLength(1)
    expect(findBrokenPromises(v, [{ entityId: 'e2', paidAt: new Date('2026-11-07T10:00:00Z') }], today)).toHaveLength(1)
  })
  it('kelajak va\'dasi chiqmaydi; har tashkilot uchun eng oxirgi va\'da', () => {
    const v = [
      { id: 'old', entityId: 'e1', promisedDate: '2026-11-01', createdAt: new Date('2026-10-30T10:00:00Z') },
      { id: 'new', entityId: 'e1', promisedDate: '2026-11-20', createdAt: new Date('2026-11-02T10:00:00Z') },
    ]
    expect(findBrokenPromises(v, [], today)).toHaveLength(0)
  })
  it('bugungi sana — daysOverdue 0, ko\'proq kechikkani birinchi', () => {
    const v = [
      { id: 'a', entityId: 'e1', promisedDate: today, createdAt: new Date('2026-11-05T10:00:00Z') },
      { id: 'b', entityId: 'e2', promisedDate: '2026-11-01', createdAt: new Date('2026-10-30T10:00:00Z') },
    ]
    const r = findBrokenPromises(v, [], today)
    expect(r.map(x => x.visitId)).toEqual(['b', 'a'])
    expect(r[1].daysOverdue).toBe(0)
  })
})
