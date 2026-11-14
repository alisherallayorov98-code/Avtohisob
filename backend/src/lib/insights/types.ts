// Tahlil (robot yordamchi) — umumiy turlar.
// Yadro PURE: Prisma'ga bog'liq emas. Loader (services/insightsLoader.ts) bazadan
// ma'lumotni yig'ib Snapshot'ga aylantiradi, qoidalar faqat Snapshot'dan o'qiydi —
// shuning uchun har bir qoida jest bilan DB'siz testlanadi.

export type Severity = 'critical' | 'warning' | 'info'

export type Category =
  | 'engine' | 'service' | 'fuel' | 'gps' | 'documents' | 'tires'
  | 'repairs' | 'warehouse' | 'waybills' | 'budget' | 'data'

export interface FindingAction { label: string; path: string }

/** "Qanday hisoblandi" — savol asosidagi aniq yozuvlar */
export interface Evidence {
  note?: string
  columns: string[]
  rows: Array<Array<string | number>>
}

/** Savolga shu yerning o'zida javob berish formasi (mavjud API'lar orqali saqlanadi) */
export type QuickAction =
  | { kind: 'engine_record'; prefill: { date?: string; mileage?: number; cost?: number; description?: string; recordType?: string } }
  | { kind: 'oil_change'; serviceType: 'oil_change' | 'air_filter' | 'fuel_filter'; prefill: { date?: string; km?: number } }
  | { kind: 'vehicle_date'; field: 'insuranceExpiry' | 'techInspectionExpiry'; label: string }
  | { kind: 'vehicle_number'; field: 'fuelNormPer100km' | 'tankCapacity'; label: string; unit: string; prefill?: number }
  | { kind: 'vehicle_status'; suggest: 'active' | 'maintenance' | 'inactive' }

/** Qoidaning bitta topilmasi — admin uchun savol ko'rinishida */
export interface Finding {
  ruleKey: string
  category: Category
  severity: Severity
  vehicleId: string | null
  /** Bir mashinada bir qoidaning bir nechta topilmasini ajratish uchun (masalan ta'mir id) */
  subjectKey: string
  title: string
  detail: string
  action: FindingAction
  /** Taxminiy pul ta'siri (so'm) — tartiblash uchun */
  impactUzs?: number
  evidence?: Evidence
  /** Dalil tugmasi matni (masalan "Qismlar ro'yxati (12 ta)") — standart: "Qanday hisoblandi" */
  evidenceLabel?: string
  quick?: QuickAction
}

export interface RequestInfo { id: string; status: 'open' | 'answered'; branchId: string; branchName: string | null; dueDate: string | null; overdue: boolean; answer: string | null }

export interface AssignmentInfo { id: string; assigneeId: string; assigneeName: string | null; dueDate: string | null; overdue: boolean; note: string | null }

export interface FindingOut extends Finding {
  fingerprint: string
  plate: string | null
  branchId: string | null
  isNew?: boolean
  /** Bir mavzudagi bir nechta qoida bitta savolga birlashtirilgan bo'lsa — qolganlarining qisqa matni */
  extra?: string[]
  mergedFrom?: string[]
  priority?: number
  assignment?: AssignmentInfo
  /** Filialga yuborilgan so'rov (ochiq yoki javob berilgan) */
  request?: RequestInfo
}

// ─── Snapshot (bazadan yig'ilgan, raqamlar Number'ga o'tkazilgan) ──────────────

export interface VehicleSnap {
  id: string
  plate: string
  brand: string
  model: string
  year: number
  fuelType: string
  branchId: string
  purchaseDate: Date | null
  mileage: number
  status: string
  notes: string | null
  insuranceExpiry: Date | null
  techInspectionExpiry: Date | null
  gpsUnitName: string | null
  lastGpsSignal: Date | null
  fuelNorm: number | null
  tankCapacity: number | null
  fuelSensorName: string | null
  lastFuelUpdate: Date | null
  oilIntervalKm: number | null
  createdAt: Date
}

export interface MaintPart { sparePartId: string | null; name: string; category: string | null; qty: number; unitCost: number; warehouseId?: string | null }

export interface MaintSnap {
  id: string
  vehicleId: string
  date: Date
  mileage: number | null
  cost: number
  laborCost: number
  workerName: string | null
  isOfficial: boolean
  isPaid: boolean
  status: string
  notes: string | null
  isOil: boolean
  createdAt: Date
  evidenceCount: number
  parts: MaintPart[]
}

export interface EngineSnap { id: string; vehicleId: string; type: string; mileage: number; date: Date; cost: number; nextServiceMileage: number | null }

export interface IntervalSnap {
  vehicleId: string
  serviceType: string
  intervalKm: number
  intervalDays: number
  warningKm: number
  lastServiceKm: number | null
  lastServiceDate: Date | null
  nextDueKm: number | null
  nextDueDate: Date | null
  serviceOdometerKm: number | null
}

export interface ServiceRecSnap { vehicleId: string; serviceType: string; km: number; date: Date; cost: number }

export interface FuelSnap { id: string; vehicleId: string; fuelType: string; liters: number; cost: number; odometer: number; date: Date; supplierId: string | null }

export interface DailyKmSnap { vehicleId: string; day: string; km: number }

export interface FuelAnomalySnap { vehicleId: string; anomaly: string; deltaL: number | null; at: Date }

export interface InspectionSnap { vehicleId: string; date: Date; overall: string; brakes: string }

export interface WarrantySnap { id: string; vehicleId: string | null; partName: string; endDate: Date; startDate: Date; status: string }

export interface TireSnap {
  id: string
  serial: string
  vehicleId: string | null
  status: string
  position: string | null
  installedMileageKm: number | null
  removedDate: Date | null
  actualMileageUsed: number | null
  standardMileageKm: number
  purchasePrice: number
  purchaseDate: Date
  dotCode: string | null
}

export interface TireDeductionSnap { id: string; tireId: string; vehicleId: string | null; isSettled: boolean; createdAt: Date; amount: number }

export interface InventorySnap {
  partId: string; partName: string; warehouseId: string; warehouseName: string; qty: number; reorderLevel: number; unitPrice: number
  lastRestockDate: Date | null
  /** Eng so'nggi kelish: kirim hujjati, qabul qilingan transfer, qoldiq qatori yaratilgani yoki lastRestockDate */
  lastArrival: Date | null
  /** Eng so'nggi chiqish shu ombordan boshqa omborga (transfer) */
  lastOutgoing: Date | null
}

export interface ReceiptSnap { id: string; isOfficial: boolean; invoiceNumber: string | null; createdAt: Date }

export interface DocSnap { id: string; number: string; status: string; at: Date }

export interface OldDebtSnap { id: string; vehicleId: string; partName: string; workerName: string; createdAt: Date }

export interface SupplierBalSnap { id: string; name: string; invoiced: number; paid: number; oldestInvoice: Date | null; lastPayment: Date | null }

export interface WaybillSnap {
  id: string
  number: string
  vehicleId: string
  status: string
  plannedDeparture: Date
  actualDeparture: Date | null
  actualReturn: Date | null
  departureOdometer: number | null
  returnOdometer: number | null
  fuelIssued: number
  mechanicApproved: boolean
  createdAt: Date
}

export interface ExpenseSnap { id: string; vehicleId: string; amount: number; date: Date; hasReceipt: boolean; category: string }

export interface BudgetSnap { month: number; category: string; amount: number; branchId: string | null }

export interface FuelImportSnap { id: string; title: string; status: string; createdAt: Date; unmatchedRows: number }

export interface FuelPriceSnap { fuelType: string; price: number; from: Date }

export interface BranchSnap { id: string; name: string; managerId: string | null }

export interface Snapshot {
  now: Date
  thresholds: import('./thresholds').Thresholds
  org: {
    gpsConnected: boolean
    gpsSyncError: string | null
    gpsTokenExpiresAt: Date | null
    oilIntervalKm: number
    fuelDistanceMode: string
  }
  branches: BranchSnap[]
  vehicles: VehicleSnap[]
  /** FAQAT tasdiqlangan ta'mirlar, qaytarilgan qismlar ayirilgan holda */
  maintenance: MaintSnap[]
  /** Tasdiq kutayotgan ta'mirlar — faqat "tasdiqlanmagan" qoidasi uchun */
  pendingMaintenance: MaintSnap[]
  engine: EngineSnap[]
  intervals: IntervalSnap[]
  serviceRecords: ServiceRecSnap[]
  fuel: FuelSnap[]
  dailyKm: DailyKmSnap[]
  fuelAnomalies: FuelAnomalySnap[]
  inspections: InspectionSnap[]
  warranties: WarrantySnap[]
  tires: TireSnap[]
  tireDeductions: TireDeductionSnap[]
  tireTrackingVehicleIds: string[]
  inventory: InventorySnap[]
  receipts: ReceiptSnap[]
  shippedBatches: DocSnap[]
  pendingRequests: DocSnap[]
  pendingReturns: DocSnap[]
  oldDebts: OldDebtSnap[]
  suppliers: SupplierBalSnap[]
  waybills: WaybillSnap[]
  expenses: ExpenseSnap[]
  budgets: BudgetSnap[]
  fuelImports: FuelImportSnap[]
  fuelPrices: FuelPriceSnap[]
}

/** Qoida ta'rifi — registry'da saqlanadi */
export interface Rule {
  key: string
  no: number
  category: Category
  /** UI'da guruh sarlavhasi — qisqa nom */
  name: string
  run: (c: import('./context').Ctx) => Finding[]
  /**
   * Tizimli muammo: mashinalarning katta qismida chiqsa, har biri uchun alohida
   * savol o'rniga bitta tashkilot darajasidagi savol beriladi (shovqin qorovuli).
   */
  collapse?: { title: (n: number) => string; action: FindingAction; severity?: Severity }
  /**
   * Bir mavzu (masalan yoqilg'i sarfi) bo'yicha bir nechta qoida bitta mashinada chiqsa,
   * ular bitta savolga birlashtiriladi — eng og'iri asosiy, qolganlari qo'shimcha dalil.
   */
  mergeGroup?: string
}
