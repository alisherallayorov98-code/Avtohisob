// Rol × tuman × tenant matritsasi (pure) — ekoScope YAGONA manba ekanini mixlaydi.
import { entityScopeWhere, canAccessEntity, canAccessDistrict, districtIdsFilter } from './ekoScope'

const ORG = 'org-1'
const OTHER_ORG = 'org-2'

const admin = { role: 'admin', orgId: ORG, districtIds: [] as string[] }
const inspector = { role: 'inspector', orgId: ORG, districtIds: ['d1', 'd2'] }
const supervisor = { role: 'supervisor', orgId: ORG, districtIds: ['d1'] }
const noDistricts = { role: 'inspector', orgId: ORG, districtIds: [] as string[] }
const noOrg = { role: 'admin', orgId: '', districtIds: [] as string[] }

const own = (d: string) => ({ orgId: ORG, districtId: d })
const foreign = { orgId: OTHER_ORG, districtId: 'd1' }

describe('entityScopeWhere', () => {
  it('admin — butun korxona, tuman cheklovisiz', () => {
    expect(entityScopeWhere(admin)).toEqual({ orgId: ORG })
  })
  it('inspektor VA boshliq — faqat o\'z tumanlari', () => {
    expect(entityScopeWhere(inspector)).toEqual({ orgId: ORG, districtId: { in: ['d1', 'd2'] } })
    expect(entityScopeWhere(supervisor)).toEqual({ orgId: ORG, districtId: { in: ['d1'] } })
  })
  it('tumani yo\'q → hech narsa (bo\'sh in), butun korxona EMAS', () => {
    expect(entityScopeWhere(noDistricts)).toEqual({ orgId: ORG, districtId: { in: [] } })
  })
  it('orgId yo\'q → hech qaysi haqiqiy korxonaga mos kelmaydi', () => {
    const w = entityScopeWhere(noOrg)
    expect(w.orgId).not.toBe('')
    expect(w.orgId).not.toBe(ORG)
  })
  it('hech qachon organizationId:null OR pattern qaytarmaydi', () => {
    for (const u of [admin, inspector, supervisor, noDistricts, noOrg]) {
      expect(JSON.stringify(entityScopeWhere(u))).not.toMatch(/null|OR/)
    }
  })
})

describe('canAccessEntity — matritsa', () => {
  const cases: [string, typeof admin, { orgId: string; districtId: string } | null, boolean][] = [
    ['admin / o\'z korxonasi / istalgan tuman', admin, own('dX'), true],
    ['admin / boshqa korxona', admin, foreign, false],
    ['inspektor / o\'z tumani', inspector, own('d2'), true],
    ['inspektor / boshqa tuman', inspector, own('d9'), false],
    ['boshliq / o\'z tumani', supervisor, own('d1'), true],
    ['boshliq / boshqa tuman (ilgari ro\'yxatda ko\'rinardi)', supervisor, own('d2'), false],
    ['tumani yo\'q / har qanday tuman', noDistricts, own('d1'), false],
    ['inspektor / boshqa korxona, bir xil tuman id', inspector, foreign, false],
    ['orgId yo\'q foydalanuvchi', noOrg, own('d1'), false],
    ['mavjud emas (null)', admin, null, false],
  ]
  it.each(cases)('%s', (_n, user, entity, expected) => {
    expect(canAccessEntity(user, entity)).toBe(expected)
  })
})

describe('canAccessDistrict / districtIdsFilter', () => {
  it('admin hamma tuman, qolganlar faqat o\'zinikini', () => {
    expect(canAccessDistrict(admin, 'zzz')).toBe(true)
    expect(canAccessDistrict(inspector, 'd1')).toBe(true)
    expect(canAccessDistrict(supervisor, 'd2')).toBe(false)
    expect(canAccessDistrict(noDistricts, 'd1')).toBe(false)
    expect(canAccessDistrict(noOrg, 'd1')).toBe(false)
  })
  it('districtIdsFilter: admin → undefined (cheklov yo\'q), qolgan → ro\'yxat nusxasi', () => {
    expect(districtIdsFilter(admin)).toBeUndefined()
    const f = districtIdsFilter(inspector)!
    expect(f).toEqual(['d1', 'd2'])
    f.push('hack')
    expect(inspector.districtIds).toEqual(['d1', 'd2']) // asl ro'yxat o'zgarmaydi
    expect(districtIdsFilter(noDistricts)).toEqual([])
  })
})
