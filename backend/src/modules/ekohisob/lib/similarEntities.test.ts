import { cyrToLatin, nameKey, similarity, phoneKey, distanceMeters, findSimilar, SimilarEntity } from './similarEntities'

describe('nameKey — kirill/lotin va eshitib yozish farqlari', () => {
  it('kirillcha va lotincha nom bir xil kalit beradi', () => {
    expect(nameKey('Нур Савдо МЧЖ')).toBe(nameKey('Nur Savdo MChJ'))
  })
  it('huquqiy shakl va tinish belgilari hisobga olinmaydi', () => {
    expect(nameKey('"Oq Yo\'l" MChJ')).toBe(nameKey('OQ YOL mchj'))
  })
  it('h/x farqi tenglashadi', () => {
    expect(nameKey('Hamza')).toBe(nameKey('Xamza'))
  })
  it('qo\'sh harf farqi tenglashadi', () => {
    expect(nameKey('Karimm')).toBe(nameKey('Karim'))
  })
  it('o\'zbekcha kirill harflari', () => {
    expect(cyrToLatin('Қўқон ҳамкор')).toBe('qoqon xamkor')
  })
})

describe('similarity', () => {
  it('bir xil = 1, butunlay boshqa past', () => {
    expect(similarity('nur', 'nur')).toBe(1)
    expect(similarity('nur', 'zebo')).toBeLessThan(0.5)
  })
  it('bitta harf farqi yuqori', () => {
    expect(similarity('karimov', 'karimof')).toBeGreaterThan(0.8)
  })
  it('bo\'sh satr 0', () => expect(similarity('', 'a')).toBe(0))
})

describe('phoneKey', () => {
  it('formatlash va 998 prefiksi farqi yo\'q', () => {
    expect(phoneKey('+998 (90) 123-45-67')).toBe(phoneKey('901234567'))
  })
  it('qisqa raqam — kalit yo\'q', () => expect(phoneKey('12345')).toBe(''))
})

describe('findSimilar', () => {
  const list: SimilarEntity[] = [
    { id: 'a', name: 'Nur Savdo', phone: '998901234567', lat: 41.3110, lon: 69.2400, districtId: 'd1' },
    { id: 'b', name: 'Zebo Kafe', phone: '998935550000', lat: 41.3111, lon: 69.2401, districtId: 'd1' },
    { id: 'c', name: 'Uzoq Do\'kon', phone: null, lat: 41.4000, lon: 69.3000, districtId: 'd2' },
  ]

  it('telefon bir xil → phone', () => {
    const r = findSimilar({ name: 'Boshqa nom', phone: '+998 90 123 45 67' }, list)
    expect(r.map(x => x.id)).toEqual(['a'])
    expect(r[0].reasons).toContain('phone')
  })

  it('yaqin joy + o\'xshash nom (kirillcha) → nearby', () => {
    const r = findSimilar({ name: 'Нур Савдо', lat: 41.31102, lon: 69.24002 }, list)
    expect(r[0].id).toBe('a')
    expect(r[0].reasons).toContain('nearby')
  })

  it('yaqin joy, lekin nomi boshqa → takror emas (qo\'shni do\'konlar)', () => {
    const r = findSimilar({ name: 'Mutlaqo Boshqa', lat: 41.3110, lon: 69.2400 }, list)
    expect(r).toHaveLength(0)
  })

  it('bir tumanda nom aynan bir xil → name', () => {
    const r = findSimilar({ name: 'ZEBO kafe', districtId: 'd1' }, list)
    expect(r.map(x => x.id)).toEqual(['b'])
    expect(r[0].reasons).toEqual(['name'])
  })

  it('boshqa tumandagi bir xil nom ogohlantirilmaydi', () => {
    expect(findSimilar({ name: 'Zebo Kafe', districtId: 'd2' }, list)).toHaveLength(0)
  })

  it('hech narsa mos kelmasa bo\'sh', () => {
    expect(findSimilar({ name: 'Yangi', phone: '991112233', lat: 40, lon: 68, districtId: 'd9' }, list)).toEqual([])
  })

  it('ishonchlilik bo\'yicha tartiblanadi (telefon + yaqinlik kuchliroq)', () => {
    const r = findSimilar({ name: 'Nur Savdo', phone: '901234567', lat: 41.3110, lon: 69.2400, districtId: 'd1' }, list)
    expect(r[0].id).toBe('a')
    expect(r[0].reasons).toEqual(expect.arrayContaining(['phone', 'nearby']))
  })
})

describe('distanceMeters', () => {
  it('0.001° kenglik ≈ 111 m', () => {
    expect(Math.round(distanceMeters(41, 69, 41.001, 69))).toBeGreaterThan(105)
    expect(Math.round(distanceMeters(41, 69, 41.001, 69))).toBeLessThan(117)
  })
})
