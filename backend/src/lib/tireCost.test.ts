import { tireShare, isTirePart, tireReason, tireBreakdown } from './tireCost'

const item = (name: string, unitCost: number, qty = 1, extra: { isTire?: boolean; category?: string } = {}) =>
  ({ quantityUsed: qty, unitCost, isTire: extra.isTire ?? false, sparePart: { name, category: extra.category ?? 'other' } })

describe('shinani aniqlash', () => {
  test('shina belgisi, kategoriya yoki aniq nom', () => {
    expect(isTirePart({ name: 'Boshqa' }, true)).toBe(true)
    expect(isTirePart({ name: 'X', category: 'tires' })).toBe(true)
    expect(isTirePart({ name: 'Shina 315/80 R22.5' })).toBe(true)
    expect(isTirePart({ name: 'ШИНА 12.00R20' })).toBe(true)
  })
  test('"balon" — yuk mashinasi shinasi', () => {
    expect(tireReason({ name: 'Balon Kama 12.00R20' })).toMatch(/balon/)
    expect(isTirePart({ name: 'BALLON 315/80' })).toBe(true)
    expect(isTirePart({ name: 'Баллон' })).toBe(true)
  })
  test("faqat o'lcham bilan yozilgan shina", () => {
    expect(tireReason({ name: 'Kama 315/80R22.5' })).toMatch(/o'lchami 315\/80R22\.5/)
    expect(isTirePart({ name: 'Triangle 12.00 R20' })).toBe(true)
    expect(isTirePart({ name: 'Belshina 12.00-20' })).toBe(true)
    expect(isTirePart({ name: 'Cordiant R16C' })).toBe(true)
  })
  test("shina emas: metan ballon, ballon kalit, rezina vtulka, kamera, oddiy qismlar", () => {
    expect(isTirePart({ name: 'Metan ballon 80L' })).toBe(false)
    expect(isTirePart({ name: 'Gaz balon 50 litr' })).toBe(false)
    expect(isTirePart({ name: 'Ballon kalit' })).toBe(false)
    expect(isTirePart({ name: 'Rezina vtulka stabilizator' })).toBe(false)
    expect(isTirePart({ name: 'Kamera' })).toBe(false)
    expect(isTirePart({ name: 'Moy filtri 2020' })).toBe(false)
    expect(isTirePart({ name: 'Kolodka 1201' })).toBe(false)
  })
})

describe("ta'mirdagi shina ulushi", () => {
  test("faqat shinadan iborat ta'mir — usta haqi bilan to'liq ayiriladi", () => {
    expect(tireShare({ cost: 12_000_000, laborCost: 400_000, items: [item('Shina 315/80', 2_000_000, 6, { isTire: true })] })).toBe(12_400_000)
  })
  test("aralash ta'mir — faqat shina qismlari, usta haqi qoladi", () => {
    const m = { cost: 4_500_000, laborCost: 300_000, items: [item('Balon 12.00R20', 2_000_000, 2), item('Kolodka', 500_000)] }
    expect(tireShare(m)).toBe(4_000_000)
  })
  test("donalik narx kiritilmagan — qismlar summasi miqdor ulushi bo'yicha", () => {
    const m = { cost: 6_000_000, laborCost: 200_000, items: [item('Shina', 0, 4), item('Disk tormoz', 0, 2)] }
    expect(tireShare(m)).toBe(4_000_000)
  })
  test("shina yo'q — 0", () => {
    expect(tireShare({ cost: 900_000, laborCost: 100_000, items: [item('Moy filtri', 900_000)] })).toBe(0)
  })
  test("eski yozuv (bitta qism yoki faqat izoh)", () => {
    expect(tireShare({ cost: 3_000_000, laborCost: 0, sparePart: { name: 'Pokrishka', category: 'other' }, items: [] })).toBe(3_000_000)
    expect(tireShare({ cost: 3_000_000, laborCost: 0, sparePart: { name: 'Akkumulyator', category: 'electrical' }, items: [] })).toBe(0)
    expect(tireShare({ cost: 5_000_000, laborCost: 100_000, sparePart: null, notes: '4 ta shina almashtirildi', items: [] })).toBe(5_100_000)
  })
  test('har ayirilgan qatorda sabab bor (hujjat uchun)', () => {
    const b = tireBreakdown({ cost: 4_500_000, laborCost: 0, items: [item('Kama 315/80R22.5', 2_000_000, 2), item('Kolodka', 500_000)] })
    expect(b.lines).toEqual([{ name: 'Kama 315/80R22.5', qty: 2, amount: 4_000_000, reason: "shina o'lchami 315/80R22.5" }])
  })
})
