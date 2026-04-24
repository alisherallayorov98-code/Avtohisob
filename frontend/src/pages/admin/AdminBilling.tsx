import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import toast from 'react-hot-toast'
import { TrendingUp, DollarSign, Users, TrendingDown, ChevronLeft, ChevronRight, CheckCircle, XCircle, ShieldCheck } from 'lucide-react'

const PLAN_ORDER = ['free', 'starter', 'professional', 'enterprise']
const PLAN_LABELS: Record<string, string> = { free: 'Bepul', starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' }
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts'

type Tab = 'revenue' | 'subscriptions' | 'invoices'

const PLAN_COLORS = ['#dc2626', '#7c3aed', '#2563eb', '#059669']

function fmt(n: number) {
  return new Intl.NumberFormat('uz-UZ').format(Math.round(n))
}

function formatDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('uz-UZ')
}

function statusBadge(s: string) {
  const m: Record<string, string> = {
    paid: 'bg-green-900 text-green-300',
    pending: 'bg-yellow-900 text-yellow-300',
    failed: 'bg-red-900 text-red-300',
    active: 'bg-green-900 text-green-300',
    trialing: 'bg-blue-900 text-blue-300',
    canceled: 'bg-red-900 text-red-300',
    past_due: 'bg-orange-900 text-orange-300',
    expired: 'bg-gray-800 text-gray-400',
  }
  return m[s] || 'bg-gray-800 text-gray-400'
}

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: any; color: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-gray-400">{label}</p>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function RevenueTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-revenue'],
    queryFn: () => api.get('/admin/billing/revenue').then(r => r.data.data),
  })

  if (isLoading) return <div className="flex justify-center py-10"><div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
  if (isError) return <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center text-red-400">Daromad ma'lumotlarini yuklab bo'lmadi. Sahifani yangilang.</div>
  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="Jami Daromad" value={`${fmt(data.totalRevenue)} UZS`} icon={DollarSign} color="bg-green-600" />
        <StatCard label="MRR (Bu Oy)" value={`${fmt(data.mrr)} UZS`} sub={`ARR: ${fmt(data.arr)} UZS`} icon={TrendingUp} color="bg-blue-600" />
        <StatCard label="Aktiv Obunalar" value={data.activeSubscriptions} icon={Users} color="bg-purple-600" />
        <StatCard label="Bekor Bu Oy" value={data.canceledThisMonth} icon={TrendingDown} color="bg-red-600" />
        <StatCard label="Churn Rate" value={`${data.churnRate}%`} icon={TrendingDown} color="bg-orange-600" />
      </div>

      {/* Monthly Chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="font-semibold text-white mb-4">Oylik daromad (so'nggi 6 oy)</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthlyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" stroke="#6b7280" tick={{ fontSize: 11 }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} tickFormatter={v => `${fmt(v)}`} />
              <Tooltip
                formatter={(v: any) => [`${fmt(Number(v))} UZS`, 'Daromad']}
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff' }}
              />
              <Bar dataKey="revenue" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* By Provider */}
        {data.byProvider?.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="font-semibold text-white mb-4">To'lov tizimlari bo'yicha</h3>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.byProvider.map((p: any) => ({ name: p.provider, value: p.total }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name }) => name}>
                    {data.byProvider.map((_: any, i: number) => <Cell key={i} fill={PLAN_COLORS[i % PLAN_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => `${fmt(Number(v))} UZS`} contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* By Plan */}
        {data.byPlan?.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="font-semibold text-white mb-4">Rejalar bo'yicha aktiv</h3>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byPlan.map((p: any) => ({ name: p.plan, count: p.count }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff' }} />
                  <Bar dataKey="count" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Recent Invoices */}
      {data.recentInvoices?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-4">So'nggi to'lovlar</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['ID', 'Plan', 'Summa', 'Provider', 'To\'langan'].map(h => (
                  <th key={h} className="text-left text-gray-500 font-medium px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recentInvoices.map((i: any) => (
                <tr key={i.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="px-3 py-2 font-mono text-xs text-gray-400">{i.id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-gray-300">{i.planName || '—'}</td>
                  <td className="px-3 py-2 text-white font-medium">{fmt(i.amount)} {i.currency}</td>
                  <td className="px-3 py-2 text-gray-400">{i.provider}</td>
                  <td className="px-3 py-2 text-gray-400">{formatDate(i.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SubscriptionsTab() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-subs', status, page],
    queryFn: () => api.get('/admin/billing/subscriptions', { params: { status: status || undefined, page, limit: 20 } }).then(r => r.data),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/billing/subscriptions/${id}/approve`),
    onSuccess: () => { toast.success('Obuna tasdiqlandi va faollashtirildi'); qc.invalidateQueries({ queryKey: ['admin-subs'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xatolik'),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/billing/subscriptions/${id}/reject`),
    onSuccess: () => { toast.success('Obuna rad etildi'); qc.invalidateQueries({ queryKey: ['admin-subs'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xatolik'),
  })

  const setMaxPlanMutation = useMutation({
    mutationFn: ({ userId, maxPlanType }: { userId: string; maxPlanType: string }) =>
      api.patch(`/admin/users/${userId}/max-plan-type`, { maxPlanType }),
    onSuccess: (_, { maxPlanType }) => {
      toast.success(`Maksimal tarif: "${PLAN_LABELS[maxPlanType]}" ga o'rnatildi`)
      qc.invalidateQueries({ queryKey: ['admin-subs'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xatolik'),
  })

  const subs = data?.data || []
  const pagination = data?.pagination || {}

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-red-500">
          <option value="">Barcha holat</option>
          <option value="pending">⏳ Kutilmoqda</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="canceled">Canceled</option>
          <option value="past_due">Past Due</option>
        </select>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-10"><div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Tashkilot', 'Email', 'Faol tarif', 'Max chegara', 'Holat', 'Tugaydi', 'Jami To\'lov', 'Amallar'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-medium px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subs.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-10">Ma'lumot yo'q</td></tr>}
                {subs.map((s: any) => (
                  <tr key={s.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-white font-medium">{s.orgName}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{s.adminEmail}</td>
                    <td className="px-4 py-3 text-gray-300">{s.plan?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <select
                          value={s.maxPlanType || 'free'}
                          onChange={e => setMaxPlanMutation.mutate({ userId: s.userId, maxPlanType: e.target.value })}
                          disabled={setMaxPlanMutation.isPending}
                          className="text-xs bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                        >
                          {PLAN_ORDER.map(pt => (
                            <option key={pt} value={pt}>{PLAN_LABELS[pt]}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded ${statusBadge(s.status)}`}>{s.status}</span></td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(s.currentPeriodEnd)}</td>
                    <td className="px-4 py-3 text-white">{fmt(s.totalPaid)} UZS</td>
                    <td className="px-4 py-3">
                      {s.status === 'trialing' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => approveMutation.mutate(s.id)}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Tasdiqlash
                          </button>
                          <button
                            onClick={() => rejectMutation.mutate(s.id)}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Rad etish
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Sahifa {page} / {pagination.pages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function InvoicesTab() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-invoices', status, page],
    queryFn: () => api.get('/admin/billing/invoices', { params: { status: status || undefined, page, limit: 20 } }).then(r => r.data),
  })

  const invoices = data?.data || []
  const pagination = data?.pagination || {}

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-red-500">
          <option value="">Barcha holat</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-10"><div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Tashkilot', 'Email', 'Plan', 'Summa', 'Provider', 'Holat', 'To\'langan'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-medium px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 && <tr><td colSpan={7} className="text-center text-gray-500 py-10">Ma'lumot yo'q</td></tr>}
                {invoices.map((i: any) => (
                  <tr key={i.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-white font-medium">{i.orgName}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{i.adminEmail}</td>
                    <td className="px-4 py-3 text-gray-300">{i.planName || '—'}</td>
                    <td className="px-4 py-3 text-white font-medium">{fmt(i.amount)} {i.currency}</td>
                    <td className="px-4 py-3 text-gray-400">{i.provider}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded ${statusBadge(i.status)}`}>{i.status}</span></td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(i.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Sahifa {page} / {pagination.pages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminBilling() {
  const [tab, setTab] = useState<Tab>('revenue')

  const TABS: { id: Tab; label: string }[] = [
    { id: 'revenue', label: 'Daromad ko\'rinishi' },
    { id: 'subscriptions', label: 'Obunalar' },
    { id: 'invoices', label: 'Hisob-fakturalar' },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">Billing & Revenue</h2>
        <p className="text-gray-500 text-sm">Moliyaviy ko'rsatkichlar va obunalar</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'revenue' && <RevenueTab />}
      {tab === 'subscriptions' && <SubscriptionsTab />}
      {tab === 'invoices' && <InvoicesTab />}
    </div>
  )
}
