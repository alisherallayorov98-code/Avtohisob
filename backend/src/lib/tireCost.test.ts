import { tireShare, isTirePart } from './tireCost'

const item = (name: string, unitCost: number, qty = 1, extra: { isTire?: boolean; category?: string } = {}) =>
  ({ quantityUsed: qty, unitCost, isTire: extra.isTire ?? false, sparePart: { name, category: extra.category ?? 'other' } })

describe('isTirePart', () => {
  test('shina belgisi, kategoriya yoki aniq nom', () => {
    expect(isTirePart({ name: 'Boshqa' }, true)).toBe(true)
    expect(isTirePart({ name: 'X', category: 'tires' })).toBe(true)
    expect(isTirePart({ name: 'Shina 315/80 R22.5' })).toBe(true)
    expect(isTirePart({ name: 'ШИНА 12.00R20' })).toBe(true)
  })
  test("metan ballon va rezina vtulka shina emas", () => {
    expect(isTirePart({ name: 'Metan ballon 80L' })).toBe(false)
    expect(isTirePart({ name: 'Rezina vtulka stabilizator' })).toBe(false)
    expect(isTirePart({ name: 'Kamera' })).toBe(false)
  })
})

describe('tireShare', () => {
  test("faqat shinadan iborat ta'mir — usta haqi bilan to'liq ayiriladi", () => {
    expect(tireShare({ cost: 12_000_000, laborCost: 400_000, items: [item('Shina 315/80', 2_000_000, 6, { isTire: true })] })).toBe(12_400_000)
  })
  test("aralash ta'mir — faqat shina qismlari, usta haqi qoladi", () => {
    const m = { cost: 4_500_000, laborCost: 300_000, items: [item('Shina', 2_000_000, 2, { category: 'tires' }), item('Kolodka', 500_000)] }
    expect(tireShare(m)).toBe(4_000_000)
  })
  test("shina yo'q — 0", () => {
    expect(tireShare({ cost: 900_000, laborCost: 100_000, items: [item('Moy filtri', 900_000)] })).toBe(0)
  })
  test("eski yozuv (bitta qism, items yo'q)", () => {
    expect(tireShare({ cost: 3_000_000, laborCost: 0, sparePart: { name: 'Pokrishka', category: 'other' }, items: [] })).toBe(3_000_000)
    expect(tireShare({ cost: 3_000_000, laborCost: 0, sparePart: { name: 'Akkumulyator', category: 'electrical' }, items: [] })).toBe(0)
  })
})
