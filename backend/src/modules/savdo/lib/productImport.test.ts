import { parseProductRows, summarizeImport, RawProductRow } from './productImport'

function row(over: Partial<RawProductRow> = {}): RawProductRow {
  return {
    sku: 'A-1', name: 'Mahsulot', category: 'Kategoriya', unit: 'dona',
    wholesalePrice: 1000, retailPrice: 1200,
    ...over,
  }
}

describe('parseProductRows', () => {
  it('to\'g\'ri qator xatosiz o\'tadi va qator raqami 2 dan boshlanadi', () => {
    const [parsed] = parseProductRows([row()])
    expect(parsed.errors).toEqual([])
    expect(parsed.rowNumber).toBe(2)
    expect(parsed.sku).toBe('A-1')
    expect(parsed.wholesalePrice).toBe(1000)
    expect(parsed.retailPrice).toBe(1200)
  })

  it('SKU bo\'sh bo\'lsa xato beradi', () => {
    const [parsed] = parseProductRows([row({ sku: '   ' })])
    expect(parsed.errors).toContain('SKU bo\'sh')
  })

  it('nomi bo\'sh bo\'lsa xato beradi', () => {
    const [parsed] = parseProductRows([row({ name: null })])
    expect(parsed.errors).toContain('Nomi bo\'sh')
  })

  it('manfiy optom narx xato beradi', () => {
    const [parsed] = parseProductRows([row({ wholesalePrice: -5 })])
    expect(parsed.errors).toContain('Optom narx manfiy bo\'lishi mumkin emas')
  })

  it('manfiy chakana narx xato beradi', () => {
    const [parsed] = parseProductRows([row({ retailPrice: -1 })])
    expect(parsed.errors).toContain('Chakana narx manfiy bo\'lishi mumkin emas')
  })

  it('narx raqam bo\'lmasa xato, bo\'sh bo\'lsa 0', () => {
    const [bad, empty] = parseProductRows([
      row({ wholesalePrice: 'salom' }),
      row({ sku: 'A-2', wholesalePrice: '', retailPrice: null }),
    ])
    expect(bad.errors).toContain('Optom narx raqam bo\'lishi kerak')
    expect(empty.errors).toEqual([])
    expect(empty.wholesalePrice).toBe(0)
    expect(empty.retailPrice).toBe(0)
  })

  it('birlik bo\'sh bo\'lsa "dona" standart qo\'yiladi', () => {
    const [parsed] = parseProductRows([row({ unit: '' })])
    expect(parsed.unit).toBe('dona')
  })

  it('kategoriya bo\'sh bo\'lsa null bo\'ladi', () => {
    const [parsed] = parseProductRows([row({ category: '  ' })])
    expect(parsed.category).toBeNull()
  })

  it('fayl ichida takroriy SKU bo\'lsa ikkinchisiga xato yoziladi', () => {
    const parsed = parseProductRows([row({ sku: 'A-1' }), row({ sku: 'A-1' })])
    expect(parsed[0].errors).toEqual([])
    expect(parsed[1].errors).toContain('Faylda SKU takrorlangan')
  })
})

describe('summarizeImport', () => {
  it('mavjud SKU yangilanadi, yangi SKU yaratiladi', () => {
    const parsed = parseProductRows([row({ sku: 'BOR' }), row({ sku: 'YANGI' })])
    const summary = summarizeImport(parsed, new Set(['BOR']))
    expect(summary).toEqual({ toCreate: 1, toUpdate: 1, invalid: 0, total: 2 })
  })

  it('aralash fayl: 1 yangi, 1 yangilanadi, 2 xato', () => {
    const parsed = parseProductRows([
      row({ sku: 'YANGI' }),
      row({ sku: 'BOR' }),
      row({ sku: '' }),
      row({ sku: 'X-9', retailPrice: -100 }),
    ])
    const summary = summarizeImport(parsed, new Set(['BOR']))
    expect(summary).toEqual({ toCreate: 1, toUpdate: 1, invalid: 2, total: 4 })
  })

  it('bo\'sh fayl bo\'sh xulosa qaytaradi', () => {
    expect(summarizeImport([], new Set())).toEqual({ toCreate: 0, toUpdate: 0, invalid: 0, total: 0 })
  })
})
