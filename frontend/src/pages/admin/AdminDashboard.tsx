import { useQuery } from '@tanstack/react-query'
import api from '../../lib/api'
import {
  Users, Building2, Car, CreditCard, DollarSign, MessageSquare,
  Clock, Cpu, Server, Activity
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

function StatCard({ title, value, sub, icon: Icon, color }: {
  title: string; value: string | number; sub?: string; icon: any; color: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-gray-400 text-sm">{title}</p>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('uz-UZ').format(n) + ' UZS'
}

function formatTime(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('uz-UZ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function actionColor(action: string) {
  if (action.includes('login')) return 'text-green-400'
  if (action.includes('delete')) return 'text-red-400'
  if (action.includes('update') || action.includes('reset')) return 'text-yellow-400'
  if (action.includes('create')) return 'text-blue-400'
  return 'text-gray-400'
}

export default function AdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => api.get('/admin/dashboard').then(r => r.data.data),
    refetchInterval: 60000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const d = data || {}
  const memPercent = d.system?.memoryPercent || 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Dashboard</h2>
        <p className="text-gray-500 text-sm">Platform ko'rsatkichlari</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard title="Jami Foydalanuvchilar" value={d.users?.total ?? 0} sub={`${d.users?.newThisMonth ?? 0} ta bu oy yangi`} icon={Users} color="bg-blue-600" />
        <StatCard title="Tashkilotlar" value={d.users?.organizations ?? 0} sub={`${d.users?.active ?? 0} ta aktiv`} icon={Building2} color="bg-purple-600" />
        <StatCard title="Jami Avtomobillar" value={d.vehicles?.total ?? 0} sub={`${d.vehicles?.active ?? 0} ta aktiv`} icon={Car} color="bg-emerald-600" />
        <StatCard title="Filiallar" value={d.branches?.total ?? 0} icon={Building2} color="bg-orange-600" />
        <StatCard title="Bu Oy Daromad" value={formatMoney(d.revenue?.thisMonth ?? 0)} sub={`Yil: ${formatMoney(d.revenue?.thisYear ?? 0)}`} icon={DollarSign} color="bg-green-600" />
        <StatCard title="Ochiq Ticketlar" value={d.support?.openTickets ?? 0} icon={MessageSquare} color="bg-red-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* System Health */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Server className="w-4 h-4 text-red-500" /> Tizim holati
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Clock className="w-4 h-4" /> Uptime
              </div>
              <span className="text-white font-mono text-sm">{d.system?.uptimeFormatted || '—'}</span>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400 flex items-center gap-1"><Cpu className="w-4 h-4" /> Memory</span>
                <span className="text-white">{d.system?.memoryUsedMB ?? 0} / {d.system?.memoryTotalMB ?? 0} MB ({memPercent}%)</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full">
                <div
                  className={`h-2 rounded-full transition-all ${memPercent > 80 ? 'bg-red-500' : memPercent > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${memPercent}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Node.js</span>
              <span className="text-white font-mono text-sm">{d.system?.nodeVersion || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Platform</span>
              <span className="text-white text-sm">{d.system?.platform || '—'}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${memPercent > 80 ? 'bg-red-500' : 'bg-green-500'}`} />
              <span className={`text-sm font-medium ${memPercent > 80 ? 'text-red-400' : 'text-green-400'}`}>
                {memPercent > 80 ? 'Xotira kritik darajada!' : 'Barcha tizimlar ishlayapti'}
              </span>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-red-500" /> So'nggi faoliyat
          </h3>
          <div className="space-y-2">
            {(d.recentActivity || []).length === 0 && (
              <p className="text-gray-500 text-sm text-center py-4">Ma'lumot yo'q</p>
            )}
            {(d.recentActivity || []).map((log: any) => (
              <div key={log.id} className="flex items-start gap-3 py-2 border-b border-gray-800 last:border-0">
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-mono font-medium ${actionColor(log.action)}`}>{log.action}</span>
                  <div className="text-xs text-gray-500 truncate">
                    {log.user?.fullName || 'System'} · {log.entityType}
                  </div>
                </div>
                <span className="text-xs text-gray-600 whitespace-nowrap">{formatTime(log.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Subscriptions by plan */}
      {d.subscriptionsByPlan?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-red-500" /> Aktiv obunalar (rejalar bo'yicha)
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.subscriptionsByPlan.map((s: any) => ({ name: s.planId?.slice(0, 8) || 'Plan', count: s._count }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 11 }} />
                <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }} />
                <Bar dataKey="count" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
