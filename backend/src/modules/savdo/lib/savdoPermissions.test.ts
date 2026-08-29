import {
  can, capabilitiesFor, ownerScopeFilter, canSeeCost, stripCostFields,
} from './savdoPermissions'

describe('can', () => {
  it('admin har qanday imkoniyatga ega', () => {
    expect(can('admin', 'users.manage')).toBe(true)
    expect(can('admin', 'cost.view')).toBe(true)
    expect(can('admin', 'sales.cancel')).toBe(true)
  })

  it('menejer xodim/sozlama boshqara olmaydi', () => {
    expect(can('manager', 'users.manage')).toBe(false)
    expect(can('manager', 'settings.manage')).toBe(false)
  })

  it('menejer bekor qila olmaydi (faqat admin)', () => {
    expect(can('manager', 'sales.cancel')).toBe(false)
    expect(can('manager', 'purchases.cancel')).toBe(false)
  })

  it('menejer tannarx va dashboard ko\'radi', () => {
    expect(can('manager', 'cost.view')).toBe(true)
    expect(can('manager', 'dashboard.view')).toBe(true)
  })

  it('kassir tannarx va dashboard ko\'rmaydi', () => {
    expect(can('cashier', 'cost.view')).toBe(false)
    expect(can('cashier', 'dashboard.view')).toBe(false)
  })

  it('kassir kirim/xarajatga kira olmaydi', () => {
    expect(can('cashier', 'purchases.view')).toBe(false)
    expect(can('cashier', 'expenses.view')).toBe(false)
  })

  it('kassir kassada ishlaydi va sotuv yaratadi', () => {
    expect(can('cashier', 'kassa.use')).toBe(true)
    expect(can('cashier', 'sales.create')).toBe(true)
  })

  it('kassir boshqalarning sotuvini ko\'rmaydi', () => {
    expect(can('cashier', 'sales.viewAll')).toBe(false)
    expect(can('cashier', 'payments.viewAll')).toBe(false)
  })

  it('xodim sotuv yarata olmaydi', () => {
    expect(can('staff', 'sales.create')).toBe(false)
    expect(can('staff', 'stock.view')).toBe(true)
  })

  it('noma\'lum yoki bo\'sh rol hech narsa qila olmaydi', () => {
    expect(can('boshqa', 'stock.view')).toBe(false)
    expect(can(null, 'stock.view')).toBe(false)
    expect(can(undefined, 'stock.view')).toBe(false)
  })
})

describe('capabilitiesFor', () => {
  it('admin ro\'yxatida admin-only imkoniyatlar bor', () => {
    const caps = capabilitiesFor('admin')
    expect(caps).toContain('users.manage')
    expect(caps).toContain('sales.cancel')
    expect(caps).toContain('settings.manage')
  })

  it('takrorlanmaydi', () => {
    const caps = capabilitiesFor('admin')
    expect(new Set(caps).size).toBe(caps.length)
  })

  it('noma\'lum rol uchun bo\'sh', () => {
    expect(capabilitiesFor('yoq')).toEqual([])
  })
})

describe('ownerScopeFilter', () => {
  it('viewAll bo\'lsa filtr qo\'shilmaydi', () => {
    expect(ownerScopeFilter('admin', 'sales.viewAll', 'soldById', 'u1')).toBeNull()
    expect(ownerScopeFilter('manager', 'sales.viewAll', 'soldById', 'u1')).toBeNull()
  })

  it('kassirga faqat o\'z yozuvlari filtri', () => {
    expect(ownerScopeFilter('cashier', 'sales.viewAll', 'soldById', 'u1')).toEqual({ soldById: 'u1' })
    expect(ownerScopeFilter('cashier', 'payments.viewAll', 'receivedById', 'u1'))
      .toEqual({ receivedById: 'u1' })
  })
})

describe('stripCostFields', () => {
  const sale = {
    id: 's1', documentNumber: 'S-2026-00001', totalAmount: 100, totalCost: 60,
    lines: [{ id: 'l1', quantity: 2, unitPrice: 50, unitCost: 30, lineTotal: 100, lineCost: 60 }],
  }

  it('tannarx ko\'ruvchiga o\'zgarishsiz qaytadi', () => {
    expect(stripCostFields('admin', sale)).toBe(sale)
    expect(canSeeCost('manager')).toBe(true)
  })

  it('kassirdan tannarx olib tashlanadi', () => {
    const out: any = stripCostFields('cashier', sale)
    expect(out.totalCost).toBeUndefined()
    expect(out.totalAmount).toBe(100)
  })

  it('qatorlardagi tannarx ham olib tashlanadi', () => {
    const out: any = stripCostFields('cashier', sale)
    expect(out.lines[0].unitCost).toBeUndefined()
    expect(out.lines[0].lineCost).toBeUndefined()
    expect(out.lines[0].unitPrice).toBe(50)
  })

  it('massiv ham qo\'llab-quvvatlanadi', () => {
    const out: any = stripCostFields('staff', [sale, sale])
    expect(out).toHaveLength(2)
    expect(out[0].totalCost).toBeUndefined()
  })

  it('null/bo\'sh qiymat buzilmaydi', () => {
    expect(stripCostFields('cashier', null)).toBeNull()
    expect(stripCostFields('cashier', [])).toEqual([])
  })
})
