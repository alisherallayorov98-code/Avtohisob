import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import toast from 'react-hot-toast'
import { Search, X, ChevronLeft, ChevronRight, Eye, UserX, UserCheck, Car, Users, DollarSign, Fuel } from 'lucide-react'
import ConfirmDialog from '../../components/ui/ConfirmDialog'

function planBadge(type: string) {
  const map: Record<string, string> = {
    free: 'bg-gray-800 text-gray-400',
    starter: 'bg-blue-900 text-blue-300',
    professional: 'bg-purple-900 text-purple-300',
    enterprise: 'bg-yellow-900 text-yellow-300',
  }
  return map[type] || 'bg-gray-800 text-gray-400'
}

function fmt(n: number) {
  return new Intl.NumberFormat('uz-UZ').format(n)
}

function formatDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('uz-UZ')
}

export default function AdminOrganizations() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [suspendConfirmId, setSuspendConfirmId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-orgs', search, status, page],
    queryFn: () => api.get('/admin/organizations', { params: { search: search || undefined, status: status || undefined, page, limit: 20 } }).then(r => r.data),
  })

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-org-detail', detailId],
    queryFn: () => api.get(`/admin/organizations/${detailId}`).then(r => r.data.data),
    enabled: !!detailId,
  })

  const suspendMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/organizations/${id}/suspend`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-orgs'] }); toast.success('Bloklandi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const activateMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/organizations/${id}/activate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-orgs'] }); toast.success('Faollashtirildi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const orgs = data?.data || []
  const pagination = data?.pagination || {}
  const detail = detailData

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">Tashkilotlar</h2>
        <p className="text-gray-500 text-sm">{pagination.total ?? 0} ta tashkilot</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Qidirish..."
            className="bg-gray-900 border border-gray-700 text-white pl-9 pr-4 py-2 rounded-lg text-sm w-60 focus:outline-none focus:border-red-500"
          />
        </div>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-red-500"
        >
          <option value="">Barcha holat</option>
          <option value="active">Aktiv</option>
          <option value="inactive">Bloklangan</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Tashkilot', 'Admin', 'Joylashuv', 'Avto', 'Foydalanuvchi', 'Plan', 'Holat', 'Amallar'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-medium px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orgs.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-gray-500 py-12">Ma'lumot topilmadi</td></tr>
                )}
                {orgs.map((o: any) => (
                  <tr key={o.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{o.name}</td>
                    <td className="px-4 py-3">
                      <div className="text-gray-300 text-xs">{o.adminName}</div>
                      <div className="text-gray-500 text-xs">{o.adminEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{o.location}</td>
                    <td className="px-4 py-3 text-gray-300 text-center">{o.vehicleCount}</td>
                    <td className="px-4 py-3 text-gray-300 text-center">{o.userCount}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${planBadge(o.planType)}`}>{o.plan}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${o.status === 'active' ? 'text-green-400' : 'text-red-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${o.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                        {o.status === 'active' ? 'Aktiv' : 'Bloklangan'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setDetailId(o.id)} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title="Ko'rish">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {o.status === 'active' ? (
                          <button onClick={() => setSuspendConfirmId(o.id)} className="p-1.5 hover:bg-gray-700 rounded text-yellow-400 hover:text-yellow-300">
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => activateMut.mutate(o.id)} className="p-1.5 hover:bg-gray-700 rounded text-green-400 hover:text-green-300">
                            <UserCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Sahifa {page} / {pagination.pages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setDetailId(null)} />
          <div className="w-full max-w-xl bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-800">
              <h3 className="text-lg font-semibold text-white">Tashkilot tafsiloti</h3>
              <button onClick={() => setDetailId(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {detailLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : detail ? (
                <div className="space-y-6">
                  {/* Header info */}
                  <div>
                    <h4 className="text-xl font-bold text-white">{detail.name}</h4>
                    <p className="text-gray-400 text-sm">{detail.adminEmail}</p>
                    <p className="text-xs text-gray-500 mt-1">Ro'yxatdan o'tgan: {formatDate(detail.createdAt)}</p>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
                      <Car className="w-5 h-5 text-blue-400" />
                      <div>
                        <p className="text-xs text-gray-500">Avtomobillar</p>
                        <p className="text-lg font-bold text-white">{detail.stats?.totalVehicles}</p>
                      </div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
                      <Users className="w-5 h-5 text-purple-400" />
                      <div>
                        <p className="text-xs text-gray-500">Foydalanuvchilar</p>
                        <p className="text-lg font-bold text-white">{detail.stats?.totalUsers}</p>
                      </div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
                      <Fuel className="w-5 h-5 text-orange-400" />
                      <div>
                        <p className="text-xs text-gray-500">Yoqilg'i xarajat</p>
                        <p className="text-sm font-bold text-white">{fmt(detail.stats?.fuelCost)} UZS</p>
                      </div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
                      <DollarSign className="w-5 h-5 text-green-400" />
                      <div>
                        <p className="text-xs text-gray-500">Jami to'lov</p>
                        <p className="text-sm font-bold text-white">{fmt(detail.stats?.totalRevenue)} UZS</p>
                      </div>
                    </div>
                  </div>

                  {/* Subscription */}
                  {detail.subscription && (
                    <div className="bg-gray-800 rounded-lg p-4">
                      <h5 className="text-sm font-semibold text-white mb-2">Obuna</h5>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Plan</span>
                          <span className="text-white">{detail.subscription.plan?.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Holat</span>
                          <span className="text-white">{detail.subscription.status}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Tugaydi</span>
                          <span className="text-white">{formatDate(detail.subscription.currentPeriodEnd)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Users table */}
                  {detail.users?.length > 0 && (
                    <div>
                      <h5 className="text-sm font-semibold text-white mb-2">Foydalanuvchilar</h5>
                      <div className="space-y-1">
                        {detail.users.map((u: any) => (
                          <div key={u.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                            <div>
                              <p className="text-sm text-white">{u.fullName}</p>
                              <p className="text-xs text-gray-500">{u.role}</p>
                            </div>
                            <span className={`text-xs ${u.isActive ? 'text-green-400' : 'text-red-400'}`}>
                              {u.isActive ? 'Aktiv' : 'Bloklangan'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">Ma'lumot topilmadi</p>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!suspendConfirmId}
        title="Tashkilotni bloklash"
        message="Bu tashkilotni bloklashni tasdiqlaysizmi? Foydalanuvchilar tizimga kira olmaydi."
        confirmLabel="Ha, bloklash"
        danger={false}
        loading={suspendMut.isPending}
        onConfirm={() => { suspendMut.mutate(suspendConfirmId!); setSuspendConfirmId(null) }}
        onCancel={() => setSuspendConfirmId(null)}
      />
    </div>
  )
}
