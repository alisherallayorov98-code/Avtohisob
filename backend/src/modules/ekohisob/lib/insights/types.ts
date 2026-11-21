// EkoHisob robot yordamchi — umumiy turlar.
// Yadro PURE: Prisma'ga bog'liq emas. Loader (services/insightsLoader.ts) bazadan
// ma'lumotni Snapshot'ga yig'adi, qoidalar faqat Snapshot'dan o'qiydi — har qoida
// jest bilan DB'siz testlanadi. AvtoHisob "Tahlil" robotining arxitekturasi takrorlangan,
// lekin kod alohida (modul izolatsiyasi).

export type Severity = 'critical' | 'warning' | 'info'

/**
 * money      — pul nazorati (bekor qilingan kvitansiya, dublikat, ziddiyat)
 * collection — qarz undirish (va'da, to'xtagan mijoz, e'tiborsiz qarzdor)
 * data       — avtomatlashtirishni buzayotgan ma'lumot (telefon, summa, dublikat)
 * system     — tizim jarayonlari (oylik hisob, avto-SMS, limit, KPI)
 * staff      — xodimlar (bot, tuman, tashrif joyi) — FAQAT admin ko'radi
 */
export type Category = 'money' | 'collection' | 'data' | 'system' | 'staff'

/**
 * fact   — ma'lumotning o'zi shunday (xato bo'lishi mumkin emas)
 * strong — ikki mustaqil yozuv bir-biriga zid
 * guess  — taxmin: tekshirmasdan hech kim ayblanmaydi
 */
export type Confidence = 'fact' | 'strong' | 'guess'

/** auto — robot tuman inspektoriga o'zi yuboradi; admin — admin qarori kerak */
export type Tier = 'auto' | 'admin'

export interface FindingAction { label: string; path: string }

export interface Evidence {
  note?: string
  columns: string[]
  rows: Array<Array<string | number>>
  /** rows bilan bir xil tartibda: qator qaysi tashkilotga tegishli (bosilsa kartochka ochiladi) */
  entityIds?: Array<string | null>
}

export interface Finding {
  ruleKey: string
  category: Category
  severity: Severity
  entityId: string | null
  /** Bir tashkilotda bir qoidaning bir nechta topilmasini ajratish (masalan kvitansiya id) */
  subjectKey: string
  title: string
  detail: string
  action?: FindingAction
  /** Taxminiy pul ta'siri (so'm) — tartiblash uchun */
  impactUzs?: number
  evidence?: Evidence
  confidence?: Confidence
  basis?: string
  /** Topilma alohida xodimga tegishli bo'lsa (masalan tashrif qaydi) — ayblashdan himoya uchun */
  staffUserId?: string | null
}

export interface RuleAccuracy {
  confirmed: number
  wrong: number
  normal: number
  pct: number | null
  low: boolean
}

export interface TaskInfo {
  id: string
  status: TaskStatus
  assigneeId: string
  assigneeName: string | null
  dueDate: string | null
  overdue: boolean
  answer: string | null
  autoSent: boolean
  verifyNote: string | null
}

export interface FindingOut extends Finding {
  fingerprint: string
  entityName: string | null
  districtId: string | null
  districtName: string | null
  tier: Tier
  priority: number
  ruleAccuracy?: RuleAccuracy
  lowAccuracy?: boolean
  verdict?: { verdict: 'confirmed'; at: string; by: string | null; reason: string; resolution: string | null }
  task?: TaskInfo
}

export type TaskStatus = 'open' | 'answered' | 'resolved' | 'suspicious' | 'closed'

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface EntitySnap {
  id: string
  name: string
  status: string
  billingMode: string
  monthlyFee: number
  cubicPrice: number
  phone: string | null
  lat: number | null
  lon: number | null
  mahallId: string | null
  stir: string | null
  entityType: string
  districtId: string
  districtName: string | null
  debtLevel: string
  smsOptOut: boolean
  createdAt: Date
  /** Kanonik qarz (reportQueries.queryEntityDebts) */
  debt: number
  debtMonths: number
  oldestDebtMonth: string | null
}

export interface PaymentSnap {
  id: string
  entityId: string
  month: string
  amount: number
  paidAt: Date
  receivedBy: string
  groupId: string | null
  method: string
  hasReceipt: boolean
}

export interface VoidedReceiptSnap {
  id: string
  receiptNumber: string
  entityId: string
  amount: number
  month: string
  issuedBy: string
  issuedAt: Date
  voidedAt: Date
  voidedBy: string | null
  voidReason: string | null
}

export interface TalonSnap {
  id: string
  entityId: string
  volume: number
  amount: number
  date: Date
  paid: boolean
  paidAmount: number
  paymentId: string | null
  /** paymentId bo'lsa — shu to'lov hali bazada bormi */
  paymentExists: boolean
  createdBy: string | null
  createdAt: Date
}

export interface ChargeMismatchSnap {
  entityId: string
  month: string
  expected: number
  chargePaid: number
  paymentsSum: number
}

export interface VisitSnap {
  id: string
  entityId: string
  userId: string
  kind: string
  promisedDate: string | null
  lat: number | null
  lon: number | null
  createdAt: Date
}

export interface SmsSnap { entityId: string; status: string; createdAt: Date; error: string | null }

export interface AuditSnap {
  id: string
  action: string
  userId: string | null
  userName: string
  targetId: string | null
  targetName: string | null
  details: any
  createdAt: Date
}

export interface UserSnap {
  id: string
  fullName: string
  role: string
  isActive: boolean
  districtIds: string[]
  botLinked: boolean
  createdAt: Date
  /** Oxirgi faollik: to'lov, tashrif yoki tashkilot kiritish (null — hech qachon) */
  lastActivityAt: Date | null
}

export interface BlacklistSnap { entityId: string; status: string; addedAt: Date }

export interface OrgStateSnap {
  smsAutoEnabled: boolean
  smsAutoDay: number
  smsAutoLastMonth: string | null
  smsLimit: number
  smsUsedThisMonth: number
  /** Faol KPI ko'rsatkichlari bor */
  kpiConfigured: boolean
  /** O'tgan oy KPI davri holati: open | closed | null (yozuv yo'q) */
  prevKpiStatus: string | null
}

export interface Snapshot {
  now: Date
  /** Kimning ko'zi bilan: admin bo'lmasa tuman doirasi qo'llangan */
  fullScope: boolean
  entities: EntitySnap[]
  payments: PaymentSnap[]
  /** Hech bo'lmasa bitta to'lovi bor tashkilotlar (butun tarix) */
  everPaid: Set<string>
  voidedReceipts: VoidedReceiptSnap[]
  talons: TalonSnap[]
  chargeMismatches: ChargeMismatchSnap[]
  /** Joriy oy uchun hisob yozilmagan monthly_fixed faol tashkilotlar */
  missingCharges: string[]
  visits: VisitSnap[]
  sms: SmsSnap[]
  audit: AuditSnap[]
  users: UserSnap[]
  blacklist: BlacklistSnap[]
  /** Qora ro'yxatga TAVSIYA qilingan (eskalatsiya jurnali) */
  blacklistSuggested: Array<{ entityId: string; at: Date }>
  /** To'xtagan mijoz tahlili uchun: baholanadigan oylar va tashkilot bo'yicha to'langan oylar */
  evalMonths: string[]
  paidMonths: Map<string, { months: string[]; avg: number }>
  org: OrgStateSnap
}

export interface Rule {
  key: string
  no: number
  category: Category
  name: string
  confidence: Confidence
  tier: Tier
  /** Shuncha tashkilotda chiqsa — bitta umumiy savolga yig'iladi */
  collapse?: { title: (n: number) => string; action?: FindingAction; severity?: Severity }
  run: (c: import('./ctx').Ctx) => Finding[]
}
