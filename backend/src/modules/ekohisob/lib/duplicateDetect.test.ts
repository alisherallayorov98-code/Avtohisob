import { normalizeEntityName, findDuplicateGroups } from './duplicateDetect'

describe('normalizeEntityName', () => {
  it("apostrof, qo'shtirnoq va registr farqini yutadi", () => {
    expect(normalizeEntityName(`"Oq Yo'l" MChJ`)).toBe('oq yol')
    expect(normalizeEntityName('OQ YOL mchj')).toBe('oq yol')
    expect(normalizeEntityName('«Oq  Yoʻl»')).toBe('oq yol')
  })

  it('huquqiy shakl so\'zlari olib tashlanadi', () => {
    expect(normalizeEntityName('Bahor OOO')).toBe('bahor')
    expect(normalizeEntityName('Bahor savdo markazi')).toBe('bahor')
    expect(normalizeEntityName('YATT Karimov')).toBe('karimov')
  })

  it("bo'sh yoki faqat shakldan iborat nom → bo'sh kalit", () => {
    expect(normalizeEntityName('')).toBe('')
    expect(normalizeEntityName('MChJ')).toBe('')
  })
})

describe('findDuplicateGroups', () => {
  it('bir xil STIR → stir guruhi', () => {
    const g = findDuplicateGroups([
      { id: 'a', name: 'Alfa', stir: '123456789' },
      { id: 'b', name: 'Boshqa nom', stir: '123 456 789' },  // formati farq qiladi
      { id: 'c', name: 'Gamma', stir: '999999999' },
    ])
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ reason: 'stir', key: '123456789', ids: ['a', 'b'] })
  })

  it('STIRsiz, lekin nomi mos → name guruhi', () => {
    const g = findDuplicateGroups([
      { id: 'a', name: `"Oq Yo'l" MChJ` },
      { id: 'b', name: 'OQ YOL' },
      { id: 'c', name: 'Bahor' },
    ])
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ reason: 'name', ids: ['a', 'b'] })
  })

  it('STIR guruhi bilan aynan mos nom guruhi takror chiqmaydi', () => {
    const g = findDuplicateGroups([
      { id: 'a', name: 'Alfa MChJ', stir: '123456789' },
      { id: 'b', name: 'ALFA', stir: '123456789' },
    ])
    // Bitta juftlik — faqat stir guruhi sifatida, name'da qaytarilmaydi
    expect(g).toHaveLength(1)
    expect(g[0].reason).toBe('stir')
  })

  it('nom guruhi STIR guruhidan KENGROQ bo\'lsa alohida chiqadi', () => {
    const g = findDuplicateGroups([
      { id: 'a', name: 'Alfa', stir: '123456789' },
      { id: 'b', name: 'Alfa', stir: '123456789' },
      { id: 'c', name: 'ALFA MChJ' },              // STIRsiz uchinchi nusxa
    ])
    expect(g).toHaveLength(2)
    expect(g[0]).toMatchObject({ reason: 'stir', ids: ['a', 'b'] })
    expect(g[1]).toMatchObject({ reason: 'name', ids: ['a', 'b', 'c'] })
  })

  it('qisqa STIR (9 xonadan kam) guruhlamaydi', () => {
    expect(findDuplicateGroups([
      { id: 'a', name: 'X korxona', stir: '123' },
      { id: 'b', name: 'Y korxona', stir: '123' },
    ])).toHaveLength(0)
  })

  it('juda qisqa nom kaliti (3 belgidan kam) guruhlamaydi', () => {
    expect(findDuplicateGroups([
      { id: 'a', name: 'AB' },
      { id: 'b', name: 'ab' },
    ])).toHaveLength(0)
  })

  it('takror yo\'q → bo\'sh', () => {
    expect(findDuplicateGroups([
      { id: 'a', name: 'Alfa', stir: '111111111' },
      { id: 'b', name: 'Beta', stir: '222222222' },
    ])).toEqual([])
  })

  it('STIR guruhlari nom guruhlaridan oldin, kattasi birinchi', () => {
    const g = findDuplicateGroups([
      { id: 'n1', name: 'Bahor' }, { id: 'n2', name: 'BAHOR' },
      { id: 's1', name: 'X', stir: '123456789' },
      { id: 's2', name: 'Y', stir: '123456789' },
      { id: 's3', name: 'Z', stir: '123456789' },
    ])
    expect(g.map(x => x.reason)).toEqual(['stir', 'name'])
    expect(g[0].ids).toHaveLength(3)
  })
})
