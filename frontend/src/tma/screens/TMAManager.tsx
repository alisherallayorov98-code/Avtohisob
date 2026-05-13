import { useEffect, useState } from 'react'
import { AxiosInstance } from 'axios'
import {
  Truck, Wrench, AlertTriangle, CheckCircle, XCircle,
  TrendingUp, Activity, Clock, ChevronRight, RefreshCw,
} from 'lucide-react'

interface Props {
  api: AxiosInstance
  user: { id: string; fullName: string; role: string; branchId: string | null }
  tg: any
}

type Tab = 'summary' | 'pending' | 'fleet'

// ── Summary ──────────────────────────────────────────────────────────────────

interface DashStat {
  totalVehicles: number
  activeVehicles: number
  maintenanceVehicles: number
  activeWaybills: number
  waybillsThisMonth: number
  overdueMaintenanceCount: number
  expiringWarrantiesCount: number
  totalExpensesMonth: number
  fuelCostMonth: number
  maintenanceCostMonth: number
}

function formatMoney(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function SummaryTab({ api, tg }: { api: AxiosInstance; tg: any }) {
  const [data, setData] = useState<DashStat | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await api.get('/reports/dashboard')
      setData(res.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <Spinner />

  if (!data) return <Empty text="Ma'lumot yuklanmadi" />

  const statCards = [
    { label: "Jami mashina",    value: data.totalVehicles,         color: 'text-blue-500',  icon: Truck },
    { label: "Faol",            value: data.activeVehicles,        color: 'text-green-500', icon: Activity },
    { label: "Ta'mirda",        value: data.maintenanceVehicles,   color: 'text-amber-500', icon: Wrench },
    { label: "Aktiv yo'llanma", value: data.activeWaybills,        color: 'text-purple-500', icon: TrendingUp },
    { label: "Bu oy safar",     value: data.waybillsThisMonth,     color: 'text-indigo-500', icon: Clock },
    { label: "Muddati o'tgan",  value: data.overdueMaintenanceCount, color: 'text-red-500', icon: AlertTriangle },
  ]

  const costCards = [
    { label: "Umumiy xarajat", value: data.totalExpensesMonth, suffix: "so'm" },
    { label: "Yoqilg'i",       value: data.fuelCostMonth,       suffix: "so'm" },
    { label: "Ta'mirlash",     value: data.maintenanceCostMonth, suffix: "so'm" },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold opacity-60 uppercase tracking-wide">Bu oy xulosa</h2>
        <button onClick={() => { tg?.HapticFeedback?.impactOccurred('light'); load() }} className="opacity-40 hover:opacity-70">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {statCards.map(c => (
          <div key={c.label} className="rounded-2xl p-3" style={{ background: 'var(--tg-theme-secondary-bg-color,#fff)' }}>
            <c.icon className={`w-4 h-4 mb-1 ${c.color}`} />
            <div className="font-bold text-xl leading-none">{c.value}</div>
            <div className="text-[10px] opacity-50 mt-0.5 leading-tight">{c.label}</div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-semibold opacity-60 uppercase tracking-wide">Xarajatlar (so'm)</h2>
      <div className="grid grid-cols-1 gap-2">
        {costCards.map(c => (
          <div key={c.label} className="rounded-2xl px-4 py-3 flex items-center justify-between"
            style={{ background: 'var(--tg-theme-secondary-bg-color,#fff)' }}>
            <span className="text-sm opacity-60">{c.label}</span>
            <span className="font-bold text-base">{formatMoney(c.value)}</span>
          </div>
        ))}
      </div>

      {data.expiringWarrantiesCount > 0 && (
        <div className="rounded-2xl p-3 flex items-center gap-3 border border-amber-400/30 bg-amber-50/10">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium">Kafolat muddati tugaydi</div>
            <div className="text-xs opacity-60">{data.expiringWarrantiesCount} ta — 30 kun ichida</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pending maintenance ───────────────────────────────────────────────────────

interface MaintenanceItem {
  id: string
  status: string
  installationDate: string
  cost: number | null
  laborCost: number | null
  description: string | null
  vehicle: { id: string; registrationNumber: string; brand: string; model: string }
  sparePart: { name: string; partCode: string } | null
  performedBy: { fullName: string } | null
  items: { sparePart: { name: string } }[]
}

function PendingTab({ api, tg }: { api: AxiosInstance; tg: any }) {
  const [items, setItems] = useState<MaintenanceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await api.get('/maintenance?status=pending&limit=20')
      setItems(res.data.data || res.data.records || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function approve(id: string) {
    setActing(id)
    try {
      await api.post(`/maintenance/${id}/approve`)
      tg?.HapticFeedback?.impactOccurred('medium')
      setItems(p => p.filter(i => i.id !== id))
    } catch {
      tg?.HapticFeedback?.impactOccurred('heavy')
    }
    setActing(null)
  }

  async function reject(id: string) {
    setActing(id)
    try {
      await api.post(`/maintenance/${id}/reject`, { reason: 'TMA orqali rad etildi' })
      tg?.HapticFeedback?.impactOccurred('medium')
      setItems(p => p.filter(i => i.id !== id))
    } catch {
      tg?.HapticFeedback?.impactOccurred('heavy')
    }
    setActing(null)
  }

  if (loading) return <Spinner />

  if (items.length === 0) return (
    <div className="flex flex-col items-center py-12 opacity-50">
      <CheckCircle className="w-10 h-10 mb-2 text-green-500" />
      <p className="text-sm">Tasdiqlash kutayotgan yozuv yo'q</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-sm opacity-60">{items.length} ta yozuv tasdiqlash kutmoqda</p>
      {items.map(item => {
        const spName = item.sparePart?.name
          || item.items[0]?.sparePart?.name
          || "Ta'mirlash"
        const totalCost = (item.cost || 0) + (item.laborCost || 0)
        return (
          <div key={item.id} className="rounded-2xl p-4 space-y-3"
            style={{ background: 'var(--tg-theme-secondary-bg-color,#fff)' }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-sm">{spName}</div>
                <div className="text-xs opacity-50 mt-0.5">
                  {item.vehicle.registrationNumber} · {item.vehicle.brand} {item.vehicle.model}
                </div>
              </div>
              {totalCost > 0 && (
                <div className="text-sm font-bold text-blue-500 flex-shrink-0">
                  {formatMoney(totalCost)} so'm
                </div>
              )}
            </div>

            {item.performedBy && (
              <div className="text-xs opacity-50">Bajaruvchi: {item.performedBy.fullName}</div>
            )}
            {item.description && (
              <div className="text-xs opacity-60 italic leading-snug">{item.description}</div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => reject(item.id)}
                disabled={acting === item.id}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm border disabled:opacity-40"
                style={{ borderColor: 'var(--tg-theme-hint-color,#ddd)', color: '#ef4444' }}
              >
                <XCircle className="w-4 h-4" />
                Rad etish
              </button>
              <button
                onClick={() => approve(item.id)}
                disabled={acting === item.id}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: '#10b981' }}
              >
                <CheckCircle className="w-4 h-4" />
                {acting === item.id ? '...' : 'Tasdiqlash'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Fleet status ──────────────────────────────────────────────────────────────

interface FleetIssue {
  vehicleId: string
  plateNumber: string
  make: string
  model: string
  severity: 'critical' | 'warning'
  issues: string[]
  healthScore: number | null
}

function FleetTab({ api }: { api: AxiosInstance }) {
  const [summary, setSummary] = useState<any>(null)
  const [issues, setIssues] = useState<FleetIssue[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/reports/fleet-status')
      .then(r => { setSummary(r.data.summary); setIssues(r.data.issues || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />

  const critical = issues.filter(i => i.severity === 'critical')
  const warning  = issues.filter(i => i.severity === 'warning')

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Jami mashina",  value: summary.totalVehicles,       color: 'text-blue-500' },
            { label: "Muammo bor",   value: summary.vehiclesWithIssues,   color: 'text-red-500' },
            { label: "Kritik",        value: summary.criticalHealth,       color: 'text-red-600' },
            { label: "Qoniqarli",    value: summary.poorHealth,           color: 'text-amber-500' },
          ].map(c => (
            <div key={c.label} className="rounded-2xl p-3" style={{ background: 'var(--tg-theme-secondary-bg-color,#fff)' }}>
              <div className={`font-bold text-2xl ${c.color}`}>{c.value}</div>
              <div className="text-xs opacity-50 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {issues.length === 0 ? (
        <div className="flex flex-col items-center py-8 opacity-50">
          <CheckCircle className="w-10 h-10 mb-2 text-green-500" />
          <p className="text-sm">Barcha mashinalar yaxshi holatda</p>
        </div>
      ) : (
        <>
          {critical.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">Kritik ({critical.length})</h3>
              <div className="space-y-2">
                {critical.map(v => <VehicleIssueCard key={v.vehicleId} item={v} />)}
              </div>
            </div>
          )}
          {warning.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-2">Diqqat ({warning.length})</h3>
              <div className="space-y-2">
                {warning.map(v => <VehicleIssueCard key={v.vehicleId} item={v} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function VehicleIssueCard({ item }: { item: FleetIssue }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`rounded-2xl p-3 border-l-4 ${item.severity === 'critical' ? 'border-red-500' : 'border-amber-400'}`}
      style={{ background: 'var(--tg-theme-secondary-bg-color,#fff)' }}
    >
      <button onClick={() => setOpen(p => !p)} className="w-full flex items-center justify-between">
        <div className="text-left">
          <div className="font-mono font-bold text-sm">{item.plateNumber}</div>
          <div className="text-xs opacity-50">{item.make} {item.model}</div>
        </div>
        <div className="flex items-center gap-2">
          {item.healthScore !== null && (
            <span className={`text-xs font-bold ${item.healthScore < 40 ? 'text-red-500' : 'text-amber-500'}`}>
              {item.healthScore}%
            </span>
          )}
          <ChevronRight className={`w-4 h-4 opacity-40 transition-transform ${open ? 'rotate-90' : ''}`} />
        </div>
      </button>
      {open && item.issues.length > 0 && (
        <ul className="mt-2 space-y-1 pl-2 border-t pt-2" style={{ borderColor: 'var(--tg-theme-hint-color,#eee)' }}>
          {item.issues.map((iss, i) => (
            <li key={i} className="text-xs opacity-70 flex gap-1.5">
              <span className="opacity-40">•</span>
              <span>{iss}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center py-12 opacity-50">
      <p className="text-sm">{text}</p>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TMAManager({ api, user, tg }: Props) {
  const [tab, setTab] = useState<Tab>('summary')

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'summary', label: 'Xulosa',       icon: TrendingUp },
    { id: 'pending', label: 'Kutayotgan',   icon: Clock },
    { id: 'fleet',   label: 'Park holati',  icon: Truck },
  ]

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Nazorat markazi</h1>
        <p className="text-xs opacity-50">{user.fullName} · {user.role.replace(/_/g, ' ')}</p>
      </div>

      {/* Sub-tabs */}
      <div
        className="flex rounded-2xl p-1 gap-1"
        style={{ background: 'var(--tg-theme-secondary-bg-color,#fff)' }}
      >
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => { tg?.HapticFeedback?.impactOccurred('light'); setTab(t.id) }}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl text-xs font-medium transition-colors"
            style={{
              background: tab === t.id ? 'var(--tg-theme-button-color,#3b82f6)' : 'transparent',
              color: tab === t.id ? 'var(--tg-theme-button-text-color,#fff)' : 'var(--tg-theme-hint-color,#999)',
            }}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'summary' && <SummaryTab api={api} tg={tg} />}
      {tab === 'pending' && <PendingTab api={api} tg={tg} />}
      {tab === 'fleet'   && <FleetTab   api={api} />}
    </div>
  )
}
