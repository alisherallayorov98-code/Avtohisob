import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield, Search, ChevronLeft, ChevronRight, User, Clock } from 'lucide-react'
import api from '../../lib/api'

interface AuditLog {
  id: string
  action: string
  entityType: string
  entityId: string | null
  ipAddress: string | null
  createdAt: string
  user: { fullName: string; email: string; role: string } | null
}

const ACTION_COLOR: Record<string, string> = {
  login: 'bg-green-900/40 text-green-400',
  logout: 'bg-gray-800 text-gray-400',
  delete: 'bg-red-900/40 text-red-400',
  create: 'bg-blue-900/40 text-blue-400',
  update: 'bg-yellow-900/40 text-yellow-400',
  suspend: 'bg-orange-900/40 text-orange-400',
  reset: 'bg-purple-900/40 text-purple-400',
}

function getActionColor(action: string): string {
  for (const key of Object.keys(ACTION_COLOR)) {
    if (action.toLowerCase().includes(key)) return ACTION_COLOR[key]
  }
  return 'bg-gray-800 text-gray-400'
}

export default function AdminAuditLogs() {
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-logs', search, page],
    queryFn: () => api.get('/admin/audit-logs', { params: { search: search || undefined, page, limit: 50 } }).then(r => r.data),
  })

  const logs: AuditLog[] = data?.data || []
  const pagination = data?.pagination

  const handleSearch = () => { setSearch(searchInput); setPage(1) }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-500" /> Audit Logs
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Tizimda amalga oshirilgan barcha amallar</p>
        </div>
        {pagination && (
          <div className="text-xs text-gray-500">Jami: {pagination.total.toLocaleString()} ta yozuv</div>
        )}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Amal yoki entity bo'yicha qidirish..."
            className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
          />
        </div>
        <button onClick={handleSearch} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors">
          Qidirish
        </button>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-gray-600">
            <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>Yozuvlar topilmadi</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Sana/Vaqt', 'Foydalanuvchi', 'Amal', 'Entity', 'IP Manzil'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <div>
                          <div className="text-gray-300">{new Date(log.createdAt).toLocaleDateString('uz-UZ')}</div>
                          <div>{new Date(log.createdAt).toLocaleTimeString('uz-UZ')}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {log.user ? (
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-xs text-gray-400 flex-shrink-0">
                            {log.user.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-gray-200 text-xs font-medium">{log.user.fullName}</div>
                            <div className="text-gray-500 text-xs">{log.user.email}</div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-600 text-xs">Tizim</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-medium ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-400 text-xs">
                        <span className="text-gray-300">{log.entityType}</span>
                        {log.entityId && (
                          <span className="ml-1 text-gray-600 font-mono">#{log.entityId.slice(0, 8)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                      {log.ipAddress || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {((page - 1) * 50) + 1}–{Math.min(page * 50, pagination.total)} / {pagination.total}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-xs text-gray-400">{page} / {pagination.pages}</span>
            <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages}
              className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
