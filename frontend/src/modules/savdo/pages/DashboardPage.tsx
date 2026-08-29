import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, Package, Users, AlertTriangle, Loader2, Receipt } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

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
}
interface DashboardData {
  revenueThisMonth: number
  costThisMonth: number
  profitThisMonth: number
  salesCountThisMonth: number
  stockValuation: number
  topDebtors: Debtor[]
  lowStockItems: LowStockItem[]
  recentSales: RecentSale[]
}

function StatTile({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone: 'green' | 'red' | 'amber' | 'gray' }) {
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
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    savdoApi.get('/dashboard')
      .then(res => setData(res.data.data))
      .catch(() => toast.error('Dashboard ma\'lumotlarini yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex-1 flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
  }
  if (!data) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Ma'lumot topilmadi</div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-800">Dashboard</h1>
        <p className="text-sm text-gray-500">Shu oy xulosasi</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatTile label="Aylanma (shu oy)" value={data.revenueThisMonth.toLocaleString()} icon={Receipt} tone="gray" />
        <StatTile label="Tannarx (shu oy)" value={data.costThisMonth.toLocaleString()} icon={Package} tone="amber" />
        <StatTile
          label="Foyda (shu oy)"
          value={data.profitThisMonth.toLocaleString()}
          icon={TrendingUp}
          tone={data.profitThisMonth >= 0 ? 'green' : 'red'}
        />
        <StatTile label="Ombor qiymati" value={data.stockValuation.toLocaleString()} icon={Package} tone="gray" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-amber-700" />
            <h2 className="text-sm font-semibold text-gray-800">Eng ko'p qarzdorlar</h2>
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
          <h2 className="text-sm font-semibold text-gray-800 mb-3">So'nggi sotuvlar</h2>
          {data.recentSales.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Hali sotuv yo'q</p>
          ) : (
            <div className="space-y-2">
              {data.recentSales.map(s => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <Link to={`/savdo/sales/${s.id}`} className="text-amber-700 hover:underline">{s.documentNumber}</Link>
                  <span className="text-gray-500">{s.customerName || (s.saleType === 'pos' ? "Ko'chadan mijoz" : '—')}</span>
                  <span className="text-gray-400 savdo-num">{new Date(s.createdAt).toLocaleDateString('uz-UZ')}</span>
                  <span className="font-medium text-gray-800 savdo-num">{Number(s.totalAmount).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
