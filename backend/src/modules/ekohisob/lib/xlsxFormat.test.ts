import { NUM_FMT, colLetter, sumFormula, totalCell, ratioFormula } from './xlsxFormat'

describe('xlsxFormat', () => {
  it('son formati vergulli', () => { expect(NUM_FMT).toBe('#,##0') })
  it('colLetter', () => {
    expect(colLetter(1)).toBe('A')
    expect(colLetter(26)).toBe('Z')
    expect(colLetter(27)).toBe('AA')
    expect(colLetter(14)).toBe('N')
  })
  it('SUM formula', () => {
    expect(sumFormula(2, 4, 9)).toBe('SUM(B4:B9)')
    expect(totalCell(3, 4, 9, 55)).toEqual({ formula: 'SUM(C4:C9)', result: 55 })
    expect(totalCell(3, 5, 4, 0)).toBe(0)
  })
  it('nolga bolish himoyasi', () => {
    expect(ratioFormula('E5', 'B5')).toBe('IF(B5>0,E5/B5,"—")')
  })
})
