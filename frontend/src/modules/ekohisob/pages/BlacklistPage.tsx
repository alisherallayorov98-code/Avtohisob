import { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertCircle, CheckCircle2, Trash2, Loader2, Shield, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import { useAuthStore } from '../../../stores/authStore'

interface BlacklistEntry {
  id: string
  entityId: string
  entityName: string
  entityAddress: string
  reason: string
  govOrgName?: string
  govCaseId?: string
  addedAt: string
  resolvedAt?: string
  status: 'active' | 'resolved'
  districtId?: string
}

interface District { id: string; name: string }

const PAGE_SIZE = 20

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function BlacklistPage() {
  const ekoUser  = useEkoAuthStore(s => s.user)
  const mainUser = useAuthStore(s => s.user)
  const isAdmin  = ekoUser?.role === 'admin' || mainUser?.role === 'admin' || mainUser?.role === 'super_admin'

  const [entries, setEntries]         = useState<BlacklistEntry[]>([])
  const [districts, setDistricts]     = useState<District[]>([])
  const [filterDistrict, setFilterDistrict] = useState('')
  const [search, setSearch]           = useState('')
  const [activePage, setActivePage]   = useState(1)
  const [resolvedPage, setResolvedPage] = useState(1)
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  const fetchEntries = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterDistrict) params.set('districtId', filterDistrict)
    ekoApi.get(`/blacklist?${params}`)
      .then(res => {
        const data = res.data.data ?? res.data
        // Backend nested `entity` qaytarishi mumkin — flat shaklga keltiramiz
        const list: BlacklistEntry[] = (Array.isArray(data) ? data : []).map((b: any) => ({
          id: b.id,
          entityId: b.entityId ?? b.entity?.id,
          entityName: b.entityName ?? b.entity?.name ?? '—',
          entityAddress: b.entityAddress ?? b.entity?.address ?? '',
          reason: b.reason ?? '',
          govOrgName: b.govOrgName,
          govCaseId: b.govCaseId,
          addedAt: b.addedAt,
          resolvedAt: b.resolvedAt,
          status: b.status,
          districtId: b.districtId ?? b.entity?.district?.id,
        }))
        setEntries(list)
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [filterDistrict])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  async function handleResolve(entry: BlacklistEntry) {
    if (!window.confirm(`"${entry.entityName}" muammosi hal qilinganligini tasdiqlaysizmi?`)) return
    try {
      await ekoApi.patch(`/blacklist/${entry.id}/resolve`)
      toast.success('Hal qilingan deb belgilandi')
      fetchEntries()
    } catch { toast.error('Xato yuz berdi') }
  }

  async function handleRemove(entry: BlacklistEntry) {
    if (!window.confirm(`"${entry.entityName}"ni qora ro'yxatdan olib tashlaysizmi?`)) return
    try {
      await ekoApi.delete(`/blacklist/${entry.id}`)
      toast.success("Qora ro'yxatdan olib tashlandi")
      fetchEntries()
    } catch { toast.error('Xato yuz berdi') }
  }

  // Qidiruv filtri (client-side)
  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e =>
      e.entityName.toLowerCase().includes(q) ||
      e.entityAddress.toLowerCase().includes(q) ||
      e.reason.toLowerCase().includes(q) ||
      (e.govOrgName || '').toLowerCase().includes(q)
    )
  }, [entries, search])

  const activeEntries   = filtered.filter(e => e.status === 'active')
  const resolvedEntries = filtered.filter(e => e.status === 'resolved')

  // Pagination
  const activePaged   = activeEntries.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
  const resolvedPaged = resolvedEntries.slice((resolvedPage - 1) * PAGE_SIZE, resolvedPage * PAGE_SIZE)
  const activePages   = Math.ceil(activeEntries.length / PAGE_SIZE)
  const resolvedPages = Math.ceil(resolvedEntries.length / PAGE_SIZE)

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Qora ro'yxat</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Faol: {activeEntries.length} · Hal qilingan: {resolvedEntries.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterDistrict}
            onChange={e => setFilterDistrict(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[140px]"
          >
            <option value="">Barcha tumanlar</option>
            {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      {/* Qidiruv */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setActivePage(1); setResolvedPage(1) }}
          placeholder="Tashkilot, manzil, sabab yoki idora bo'yicha qidirish..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white shadow-sm"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
        </div>
      ) : (
        <>
          {/* Active blacklist */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <h2 className="font-semibold text-gray-800">Faol ({activeEntries.length})</h2>
            </div>

            {activeEntries.length === 0 ? (
              <div className="py-10 text-center">
                <Shield className="w-10 h-10 text-green-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">{search ? 'Qidiruv natijasi topilmadi' : "Faol muammolar yo'q"}</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Tashkilot</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Sabab</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Idora / Ish raqami</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Sana</th>
                        {isAdmin && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amallar</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {activePaged.map(entry => (
                        <tr key={entry.id} className="hover:bg-red-50/30 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{entry.entityName}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{entry.entityAddress}</p>
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden md:table-cell max-w-[200px]">
                            <p className="line-clamp-2" title={entry.reason}>{entry.reason}</p>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">
                            {entry.govOrgName || '—'}
                            {entry.govCaseId && <p className="text-gray-400 mt-0.5">#{entry.govCaseId}</p>}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{formatDate(entry.addedAt)}</td>
                          {isAdmin && (
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <button onClick={() => handleResolve(entry)} title="Hal qilingan" className="p-1.5 hover:bg-green-50 hover:text-green-600 rounded-lg transition-colors text-gray-400">
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleRemove(entry)} title="O'chirish" className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-gray-400">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {activePages > 1 && (
                  <div className="flex justify-center gap-1 p-3 border-t border-gray-100">
                    {Array.from({ length: activePages }, (_, i) => (
                      <button key={i} onClick={() => setActivePage(i + 1)}
                        className={`w-8 h-8 text-xs rounded-lg ${activePage === i + 1 ? 'bg-red-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Resolved */}
          {resolvedEntries.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <h2 className="font-semibold text-gray-800">Hal qilinganlar ({resolvedEntries.length})</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {resolvedPaged.map(entry => (
                  <div key={entry.id} className="flex items-start gap-4 px-5 py-3 opacity-70">
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{entry.entityName}</p>
                      <p className="text-xs text-gray-400 truncate" title={entry.reason}>{entry.reason}</p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{entry.resolvedAt ? formatDate(entry.resolvedAt) : ''}</span>
                  </div>
                ))}
              </div>
              {resolvedPages > 1 && (
                <div className="flex justify-center gap-1 p-3 border-t border-gray-100">
                  {Array.from({ length: resolvedPages }, (_, i) => (
                    <button key={i} onClick={() => setResolvedPage(i + 1)}
                      className={`w-8 h-8 text-xs rounded-lg ${resolvedPage === i + 1 ? 'bg-green-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
