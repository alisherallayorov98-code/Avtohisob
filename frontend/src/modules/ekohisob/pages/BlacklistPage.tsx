import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, CheckCircle2, Trash2, Loader2, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { useEkoAuthStore } from '../stores/ekoAuthStore'

interface BlacklistEntry {
  id: string
  entityId: string
  entityName: string
  entityAddress: string
  reason: string
  govOrgName?: string
  addedAt: string
  resolvedAt?: string
  status: 'active' | 'resolved'
  districtId?: string
}

interface District {
  id: string
  name: string
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function BlacklistPage() {
  const user = useEkoAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'

  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [filterDistrict, setFilterDistrict] = useState('')
  const [loading, setLoading] = useState(false)

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
    ekoApi.get(`/blacklist?${params.toString()}`)
      .then(res => {
        const data = res.data.data ?? res.data
        setEntries(Array.isArray(data) ? data : [])
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
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  async function handleRemove(entry: BlacklistEntry) {
    if (!window.confirm(`"${entry.entityName}"ni qora ro'yxatdan olib tashlaysizmi?`)) return
    try {
      await ekoApi.delete(`/blacklist/${entry.id}`)
      toast.success("Qora ro'yxatdan olib tashlandi")
      fetchEntries()
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  const activeEntries = entries.filter(e => e.status === 'active')
  const resolvedEntries = entries.filter(e => e.status === 'resolved')

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Qora ro'yxat</h1>
          <p className="text-sm text-gray-500 mt-0.5">Muammoli tashkilotlar boshqaruvi</p>
        </div>

        <select
          value={filterDistrict}
          onChange={e => setFilterDistrict(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[140px]"
        >
          <option value="">Barcha tumanlar</option>
          {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
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
                <p className="text-gray-500 text-sm">Faol muammolar yo'q</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Tashkilot</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Sabab</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Idora</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Sana</th>
                      {isAdmin && (
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amallar</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {activeEntries.map(entry => (
                      <tr key={entry.id} className="hover:bg-red-50/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{entry.entityName}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{entry.entityAddress}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-600 hidden md:table-cell max-w-[200px]">
                          <p className="truncate">{entry.reason}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">
                          {entry.govOrgName || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {formatDate(entry.addedAt)}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleResolve(entry)}
                                title="Hal qilingan deb belgilash"
                                className="p-1.5 hover:bg-green-50 hover:text-green-600 rounded-lg transition-colors text-gray-400"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleRemove(entry)}
                                title="Ro'yxatdan olib tashlash"
                                className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-gray-400"
                              >
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
                {resolvedEntries.map(entry => (
                  <div key={entry.id} className="flex items-center gap-4 px-5 py-3 opacity-60">
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{entry.entityName}</p>
                      <p className="text-xs text-gray-400 truncate">{entry.reason}</p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      {entry.resolvedAt ? formatDate(entry.resolvedAt) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
