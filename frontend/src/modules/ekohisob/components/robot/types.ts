// Robot yordamchi — backend (modules/ekohisob/lib/insights/types.ts) bilan mos turlar.

export type Severity = 'critical' | 'warning' | 'info'
export type Category = 'money' | 'collection' | 'data' | 'system' | 'staff'
export type Confidence = 'fact' | 'strong' | 'guess'
export type TaskStatus = 'open' | 'answered' | 'resolved' | 'suspicious' | 'closed'

export interface Evidence {
  note?: string
  columns: string[]
  rows: Array<Array<string | number>>
  entityIds?: Array<string | null>
}

export interface RuleAccuracy { confirmed: number; wrong: number; normal: number; pct: number | null; low: boolean }

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

export interface Finding {
  ruleKey: string
  category: Category
  severity: Severity
  entityId: string | null
  subjectKey: string
  title: string
  detail: string
  action?: { label: string; path: string }
  impactUzs?: number
  evidence?: Evidence
  confidence?: Confidence
  basis?: string
  staffUserId?: string | null
  fingerprint: string
  entityName: string | null
  districtId: string | null
  districtName: string | null
  tier: 'auto' | 'admin'
  priority: number
  ruleAccuracy?: RuleAccuracy
  lowAccuracy?: boolean
  verdict?: { verdict: 'confirmed'; at: string; by: string | null; reason: string; resolution: string | null }
  task?: TaskInfo
}

export interface InsightsData {
  generatedAt: string
  role: string
  findings: Finding[]
  counts: { total: number; critical: number; warning: number; info: number; byCategory: Record<string, number> }
  hidden: number
  ruleErrors: Array<{ ruleKey: string; error: string }>
}

export interface TaskRow {
  id: string
  fingerprint: string
  ruleKey: string
  ruleName: string
  category: Category | null
  entityId: string | null
  entityName: string | null
  districtName: string | null
  title: string
  detail: string
  evidence: Evidence | null
  assigneeId: string
  assigneeName: string | null
  assignedByName: string | null
  autoSent: boolean
  status: TaskStatus
  dueDate: string | null
  overdue: boolean
  answer: string | null
  answeredAt: string | null
  verifiedAt: string | null
  verifyNote: string | null
  closedAt: string | null
  closedByName: string | null
  notifiedAt: string | null
  createdAt: string
}

export const CATEGORY_LABEL: Record<Category, string> = {
  money: 'Pul nazorati', collection: 'Qarz undirish', data: "Ma'lumot", system: 'Tizim', staff: 'Xodimlar',
}

export const CONFIDENCE_META: Record<Confidence, { label: string; tone: 'success' | 'info' | 'warn'; hint: string }> = {
  fact: { label: 'Fakt', tone: 'success', hint: "Ma'lumotning o'zi shunday — xato bo'lishi mumkin emas." },
  strong: { label: 'Kuchli dalil', tone: 'info', hint: 'Ikki mustaqil yozuv bir-biriga zid. Tekshirib ko\'ring.' },
  guess: { label: 'Taxmin', tone: 'warn', hint: "Taxmin — tekshirmasdan hech kim ayblanmaydi. Avval tushuntirish so'rang." },
}

export const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warn' | 'danger' }> = {
  open: { label: 'Javob kutilmoqda', tone: 'info' },
  answered: { label: 'Javob berildi', tone: 'warn' },
  resolved: { label: 'Hal qilindi', tone: 'success' },
  suspicious: { label: 'Shubhali', tone: 'danger' },
  closed: { label: 'Yopildi', tone: 'neutral' },
}
