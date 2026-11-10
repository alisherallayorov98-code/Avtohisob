import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, Package, Users, AlertTriangle, Loader2, Receipt, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import DateRangeFilter from '../ui/DateRangeFilter'
import { formatDate } from '../../../lib/utils'

interface Debtor { id: string; name: string; debt: number }
interface LowStockItem {
  product: { id: string; name: string; sku: string; unit: string }
  warehouse: { id: string; name: string }
  quantityOnHand: number
  reorderLevel: number
}
interface RecentSale {
  id: string
  documentNumber: string
  totalAmount: string
  createdAt: string
  customerName: string | null
  saleType: 'invoice' | 'pos'
  status: 'completed' | 'cancelled'
}
interface ExpenseGroup { category: string; label: string; total: number; share: number }
interface DashboardData {
  period: { from: string; to: string; label: string }
  revenue: number
  cost: number
  grossProfit: number
  expenses: number
  netProfit: number
  expenseByCategory: ExpenseGroup[]
  salesCount: number
  stockValuation: number
  topDebtors: Debtor[]
  lowStockItems: LowStockItem[]
  recentSales: RecentSale[]
}

// Sana YYYY-MM-DD (mahalliy vaqt bo'yicha — toISOString() UTC'ga o'tkazib,
// kechqurun bir kun oldingi sanani berib qo'yardi)
function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

type PresetKey = 'today' | 'week' | 'month' | 'prevMonth'

function presetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date()
  if (key === 'today') return { from: iso(now), to: iso(now) }
  if (key === 'week') {
    const from = new Date(now)
    from.setDate(from.getDate() - 6)
    return { from: iso(from), to: iso(now) }
  }
  if (key === 'prevMonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: iso(first), to: iso(last) }
  }
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Bugun' },
  { key: 'week', label: '7 kun' },
  { key: 'month', label: 'Shu oy' },
  { key: 'prevMonth', label: "O'tgan oy" },
]

function StatTile({ label, value, hint, icon: Icon, tone }: {
  label: string; value: string; hint?: string; icon: any; tone: 'green' | 'red' | 'amber' | 'gray'
}) {
  const toneClasses = {
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    gray: 'bg-gray-100 text-gray-700',
  }[tone]
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${toneClasses}`}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      <p className="text-xl font-semibold text-gray-800 savdo-num">{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const initial = presetRange('month')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  const activePreset = PRESETS.find(p => {
    const r = presetRange(p.key)
    return r.from === from && r.to === to
  })?.key

  const fetchDashboard = useCallback(() => {
    setLoading(true)
    savdoApi.get('/dashboard', { params: { ...(from && { from }), ...(to && { to }) } })
      .then(res => setData(res.data.data))
      .catch(() => toast.error('Dashboard ma\'lumotlarini yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  function applyPreset(key: PresetKey) {
    const r = presetRange(key)
    setFrom(r.from); setTo(r.to)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Dashboard</h1>
          <p className="text-sm text-gray-500">
            {data ? `${formatDate(data.period.from)} — ${formatDate(data.period.to)}` : 'Davr xulosasi'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key)}
                className={`px-2.5 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  activePreset === p.key
                    ? 'bg-amber-700 border-amber-700 text-white'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : !data ? (
        <div className="text-center py-16 text-sm text-gray-400">Ma'lumot topilmadi</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatTile
              label="Aylanma" value={data.revenue.toLocaleString()}
              hint={`${data.salesCount} ta sotuv`} icon={Receipt} tone="gray"
            />
            <StatTile label="Tannarx" value={data.cost.toLocaleString()} icon={Package} tone="amber" />
            <StatTile
              label="Yalpi foyda" value={data.grossProfit.toLocaleString()}
              hint="aylanma − tannarx" icon={TrendingUp}
              tone={data.grossProfit >= 0 ? 'green' : 'red'}
            />
            <StatTile
              label="Sof foyda" value={data.netProfit.toLocaleString()}
              hint={`xarajat: ${data.expenses.toLocaleString()}`} icon={Wallet}
              tone={data.netProfit >= 0 ? 'green' : 'red'}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatTile label="Ombor qiymati (hozirgi)" value={data.stockValuation.toLocaleString()} icon={Package} tone="gray" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {data.expenseByCategory.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 lg:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-amber-700" />
                    <h2 className="text-sm font-semibold text-gray-800">Xarajat taqsimoti</h2>
                  </div>
                  <Link to="/savdo/xarajatlar" className="text-xs text-amber-700 hover:underline">Batafsil</Link>
                </div>
                <div className="space-y-2">
                  {data.expenseByCategory.map(g => (
                    <div key={g.category}>
                      <div className="flex items-center justify-between text-sm mb-0.5">
                        <span className="text-gray-700">{g.label}</span>
                        <span className="text-gray-800 savdo-num">
                          {g.total.toLocaleString()} <span className="text-gray-400 text-xs">({g.share}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-600 rounded-full" style={{ width: `${Math.min(100, g.share)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-amber-700" />
                <h2 className="text-sm font-semibold text-gray-800">Eng ko'p qarzdorlar</h2>
                <span className="text-[11px] text-gray-400">(hozirgi holat)</span>
              </div>
              {data.topDebtors.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">Qarzdor mijoz yo'q</p>
              ) : (
                <div className="space-y-2">
                  {data.topDebtors.map(d => (
                    <div key={d.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{d.name}</span>
                      <span className="font-medium text-red-600 savdo-num">{d.debt.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <h2 className="text-sm font-semibold text-gray-800">Kam qoldiq</h2>
                <span className="text-[11px] text-gray-400">(hozirgi holat)</span>
              </div>
              {data.lowStockItems.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">Kam qoldiq yo'q</p>
              ) : (
                <div className="space-y-2">
                  {data.lowStockItems.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{s.product.name} <span className="text-gray-400 text-xs">({s.warehouse.name})</span></span>
                      <span className="font-medium text-red-600 savdo-num">{s.quantityOnHand} {s.product.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 lg:col-span-2">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Davrdagi so'nggi sotuvlar</h2>
              {data.recentSales.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">Bu davrda sotuv yo'q</p>
              ) : (
                <div className="space-y-2">
                  {data.recentSales.map(s => (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <Link to={`/savdo/sales/${s.id}`} className="text-amber-700 hover:underline">
                        {s.documentNumber}
                        {s.status === 'cancelled' && <span className="ml-1.5 text-[11px] text-red-600">bekor</span>}
                      </Link>
                      <span className="text-gray-500">{s.customerName || (s.saleType === 'pos' ? "Ko'chadan mijoz" : '—')}</span>
                      <span className="text-gray-400 savdo-num">{formatDate(s.createdAt)}</span>
                      <span className={`font-medium savdo-num ${s.status === 'cancelled' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                        {Number(s.totalAmount).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
