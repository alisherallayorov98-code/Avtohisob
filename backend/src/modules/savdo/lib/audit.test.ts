import { requireReason } from './audit'

describe('requireReason', () => {
  it('bo\'sh yoki qisqa sabab rad etiladi', () => {
    expect(() => requireReason(undefined)).toThrow()
    expect(() => requireReason('   ')).toThrow()
    expect(() => requireReason('xato')).toThrow()
  })
  it('yetarli sabab qabul qilinadi va qirqiladi', () => {
    expect(requireReason('  invoys narxi noto\'g\'ri  ')).toBe('invoys narxi noto\'g\'ri')
    expect(requireReason('x'.repeat(900)).length).toBe(500)
  })
})
