// Savdo — rol/ruxsat matritsasi. SOF funksiyalar (DB'siz, testlanadi).
//
// Nima uchun kerak: bitta korxonada kassir, menejer va omborchi ishlaydi.
// Ilgari har qanday kirgan xodim BARCHA sotuv, to'lov, tannarx va kirim
// ma'lumotini ko'ra olardi — kassir hamkasbining savdosini ham, mahsulot
// tannarxini ham. Bu yerda ikki xil cheklov bor va ular ALOHIDA tushunchalar:
//
//   1) IMKONIYAT (capability) — bo'limga umuman kira oladimi (route darajasida).
//   2) KO'RINISH DOIRASI (scope) — kira oladi, lekin FAQAT o'z yozuvlarini
//      ko'radimi (`sales.viewAll` / `payments.viewAll`), va tannarx/foyda
//      ustunlari ko'rsatiladimi (`cost.view`).
//
// Admin uchun hech narsa o'zgarmaydi — u barcha imkoniyatga ega.

export type SavdoRole = 'admin' | 'manager' | 'cashier' | 'staff'

export type SavdoCapability =
  // ko'rish/boshqarish
  | 'dashboard.view'
  | 'sales.view' | 'sales.create' | 'sales.cancel' | 'sales.viewAll'
  | 'payments.view' | 'payments.create' | 'payments.cancel' | 'payments.viewAll'
  | 'purchases.view' | 'purchases.create' | 'purchases.cancel'
  | 'transfers.view' | 'transfers.create' | 'transfers.cancel'
  | 'products.view' | 'products.manage'
  | 'stock.view'
  | 'inventory.view' | 'inventory.confirm'
  | 'customers.view' | 'customers.manage'
  | 'suppliers.view' | 'suppliers.manage'
  | 'warehouses.view' | 'warehouses.manage'
  | 'kassa.use' | 'kassa.history'
  | 'expenses.view' | 'expenses.manage'
  | 'sms.manage'
  | 'users.manage'
  | 'settings.manage'
  // maxsus: tannarx/foyda raqamlarini ko'rish
  | 'cost.view'

// Menejer — korxona ishini yuritadi: hamma narsani ko'radi va yozadi,
// lekin xodim/sozlama boshqarmaydi va bekor qila olmaydi (bekor qilish
// audit ta'siri katta — faqat admin, mavjud xatti-harakat saqlanadi).
const MANAGER: SavdoCapability[] = [
  'dashboard.view',
  'sales.view', 'sales.create', 'sales.viewAll',
  'payments.view', 'payments.create', 'payments.viewAll',
  'purchases.view', 'purchases.create',
  'transfers.view', 'transfers.create',
  'products.view', 'products.manage',
  'stock.view',
  'inventory.view', 'inventory.confirm',
  'customers.view', 'customers.manage',
  'suppliers.view', 'suppliers.manage',
  'warehouses.view',
  'kassa.use', 'kassa.history',
  'expenses.view', 'expenses.manage',
  'cost.view',
]

// Kassir — kassada ishlaydi. O'z sotuvi va o'z qabul qilgan to'lovini
// ko'radi (viewAll YO'Q), tannarx/foyda ko'rmaydi (cost.view YO'Q),
// kirim/xarajat/inventarizatsiyaga umuman kirmaydi.
const CASHIER: SavdoCapability[] = [
  'sales.view', 'sales.create',
  'payments.view', 'payments.create',
  'products.view',
  'stock.view',
  'customers.view', 'customers.manage',
  'warehouses.view',
  'kassa.use', 'kassa.history',
]

// Xodim (omborchi) — ko'radi, sotmaydi.
const STAFF: SavdoCapability[] = [
  'products.view',
  'stock.view',
  'customers.view',
  'warehouses.view',
  'inventory.view',
]

const ROLE_CAPS: Record<Exclude<SavdoRole, 'admin'>, SavdoCapability[]> = {
  manager: MANAGER,
  cashier: CASHIER,
  staff: STAFF,
}

export const SAVDO_ROLE_LABELS: Record<SavdoRole, string> = {
  admin: 'Admin',
  manager: 'Menejer',
  cashier: 'Kassir',
  staff: 'Xodim',
}

/** Rol shu imkoniyatga egami. Admin — har doim ha. Noma'lum rol — har doim yo'q. */
export function can(role: string | null | undefined, capability: SavdoCapability): boolean {
  if (role === 'admin') return true
  if (role === 'manager' || role === 'cashier' || role === 'staff') {
    return ROLE_CAPS[role].includes(capability)
  }
  return false
}

/** Rolning barcha imkoniyatlari — frontendga bir marta yuborish uchun. */
export function capabilitiesFor(role: string | null | undefined): SavdoCapability[] {
  if (role === 'admin') {
    const all = new Set<SavdoCapability>([...MANAGER, ...CASHIER, ...STAFF])
    const adminOnly: SavdoCapability[] = [
      'sales.cancel', 'payments.cancel', 'purchases.cancel', 'transfers.cancel',
      'users.manage', 'settings.manage', 'sms.manage', 'warehouses.manage',
    ]
    for (const c of adminOnly) all.add(c)
    return [...all]
  }
  if (role === 'manager' || role === 'cashier' || role === 'staff') return [...ROLE_CAPS[role]]
  return []
}

/**
 * Sotuv/to'lov ro'yxatiga qo'shiladigan "faqat o'ziniki" filtri.
 * `viewAll` imkoniyati bo'lmaganlarga {[field]: actorId} qaytaradi,
 * bo'lganlarga null (filtr qo'shilmaydi).
 */
export function ownerScopeFilter(
  role: string | null | undefined,
  capability: 'sales.viewAll' | 'payments.viewAll',
  field: string,
  actorId: string,
): Record<string, string> | null {
  if (can(role, capability)) return null
  return { [field]: actorId }
}

/** Tannarx/foyda maydonlarini ko'ra oladimi. */
export function canSeeCost(role: string | null | undefined): boolean {
  return can(role, 'cost.view')
}

/**
 * Tannarx/foyda maydonlarini javobdan olib tashlaydi (kassir/xodim uchun).
 * Massiv ham, bitta obyekt ham beriladi. `lines` ichidagi tannarx ham tozalanadi.
 */
export function stripCostFields<T>(role: string | null | undefined, payload: T): T {
  if (canSeeCost(role)) return payload
  const clean = (row: any): any => {
    if (!row || typeof row !== 'object') return row
    const { totalCost, unitCost, lineCost, ...rest } = row
    if (Array.isArray(rest.lines)) rest.lines = rest.lines.map(clean)
    return rest
  }
  return (Array.isArray(payload) ? payload.map(clean) : clean(payload)) as T
}
