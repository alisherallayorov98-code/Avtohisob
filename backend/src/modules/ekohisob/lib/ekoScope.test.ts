import { entityScopeWhere, canAccessEntity, canAccessDistrict, districtIdsFilter, isEkoAdmin } from './ekoScope'

const admin = { role: 'admin', orgId: 'o1', districtIds: [] as string[] }
const insp = { role: 'inspector', orgId: 'o1', districtIds: ['d1', 'd2'] }
const boss = { role: 'supervisor', orgId: 'o1', districtIds: ['d1'] }
const lonely = { role: 'inspector', orgId: 'o1', districtIds: [] as string[] }

describe('ekoScope', () => {
  it('admin — butun korxona, tuman cheklovi yo\'q', () => {
    expect(entityScopeWhere(admin)).toEqual({ orgId: 'o1' })
    expect(districtIdsFilter(admin)).toBeUndefined()
    expect(isEkoAdmin(admin)).toBe(true)
  })
  it('inspektor va boshliq — faqat o\'z tumanlari (bir xil qoida)', () => {
    expect(entityScopeWhere(insp)).toEqual({ orgId: 'o1', districtId: { in: ['d1', 'd2'] } })
    expect(entityScopeWhere(boss)).toEqual({ orgId: 'o1', districtId: { in: ['d1'] } })
  })
  it('tumani yo\'q xodim HECH NARSA ko\'rmaydi (butun korxona emas)', () => {
    expect(entityScopeWhere(lonely)).toEqual({ orgId: 'o1', districtId: { in: [] } })
    expect(canAccessEntity(lonely, { orgId: 'o1', districtId: 'd1' })).toBe(false)
  })
  it('orgId yo\'q → hech narsa', () => {
    const w = entityScopeWhere({ role: 'admin', orgId: '', districtIds: [] })
    expect(w.districtId).toEqual({ in: [] })
    expect(canAccessEntity({ role: 'admin', orgId: '', districtIds: [] }, { orgId: '', districtId: 'd1' })).toBe(false)
  })
  it('boshqa korxona tashkilotiga kirish yo\'q (admin ham)', () => {
    expect(canAccessEntity(admin, { orgId: 'o2', districtId: 'd1' })).toBe(false)
    expect(canAccessEntity(insp, { orgId: 'o2', districtId: 'd1' })).toBe(false)
  })
  it('tuman tekshiruvi', () => {
    expect(canAccessEntity(insp, { orgId: 'o1', districtId: 'd2' })).toBe(true)
    expect(canAccessEntity(insp, { orgId: 'o1', districtId: 'd9' })).toBe(false)
    expect(canAccessEntity(boss, { orgId: 'o1', districtId: 'd2' })).toBe(false)
    expect(canAccessEntity(admin, { orgId: 'o1', districtId: 'd9' })).toBe(true)
    expect(canAccessEntity(admin, null)).toBe(false)
    expect(canAccessDistrict(insp, 'd1')).toBe(true)
    expect(canAccessDistrict(insp, 'd9')).toBe(false)
  })
  it('districtIds massivi tashqaridan o\'zgartirilmaydi (nusxa)', () => {
    const w = entityScopeWhere(insp)
    w.districtId!.in.push('hack')
    expect(insp.districtIds).toEqual(['d1', 'd2'])
  })
})
