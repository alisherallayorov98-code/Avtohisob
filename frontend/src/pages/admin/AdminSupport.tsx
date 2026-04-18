import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import toast from 'react-hot-toast'
import { Search, X, Send, ChevronLeft, ChevronRight } from 'lucide-react'

function priorityBadge(p: string) {
  const m: Record<string, string> = {
    low: 'bg-gray-800 text-gray-400',
    medium: 'bg-blue-900 text-blue-300',
    high: 'bg-orange-900 text-orange-300',
    urgent: 'bg-red-900 text-red-300',
  }
  return m[p] || 'bg-gray-800 text-gray-400'
}

function statusBadge(s: string) {
  const m: Record<string, string> = {
    open: 'bg-orange-900 text-orange-300',
    in_progress: 'bg-blue-900 text-blue-300',
    resolved: 'bg-green-900 text-green-300',
    closed: 'bg-gray-800 text-gray-400',
  }
  return m[s] || 'bg-gray-800 text-gray-400'
}

function formatTime(dt: string) {
  return new Date(dt).toLocaleString('uz-UZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AdminSupport() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [replyMsg, setReplyMsg] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tickets', search, status, priority, page],
    queryFn: () => api.get('/admin/support/tickets', {
      params: { search: search || undefined, status: status || undefined, priority: priority || undefined, page, limit: 20 }
    }).then(r => r.data),
  })

  const { data: ticketDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-ticket', selectedId],
    queryFn: () => api.get(`/admin/support/tickets/${selectedId}`).then(r => r.data.data),
    enabled: !!selectedId,
  })

  const replyMut = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => api.post(`/admin/support/tickets/${id}/reply`, { message }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-ticket', selectedId] })
      qc.invalidateQueries({ queryKey: ['admin-tickets'] })
      setReplyMsg('')
      toast.success('Javob yuborildi')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/admin/support/tickets/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-ticket', selectedId] })
      qc.invalidateQueries({ queryKey: ['admin-tickets'] })
      toast.success('Holat yangilandi')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const tickets = data?.data || []
  const stats = data?.stats || {}
  const pagination = data?.pagination || {}

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">Support Tickets</h2>
        <p className="text-gray-500 text-sm">Foydalanuvchi murojaaatlarini boshqarish</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Ochiq', key: 'open', color: 'text-orange-400 border-orange-800 bg-orange-900/20' },
          { label: 'Jarayonda', key: 'in_progress', color: 'text-blue-400 border-blue-800 bg-blue-900/20' },
          { label: 'Hal etilgan', key: 'resolved', color: 'text-green-400 border-green-800 bg-green-900/20' },
          { label: 'Yopilgan', key: 'closed', color: 'text-gray-400 border-gray-700 bg-gray-800/50' },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => { setStatus(status === s.key ? '' : s.key); setPage(1) }}
            className={`border rounded-xl p-4 text-left transition-all ${s.color} ${status === s.key ? 'ring-2 ring-offset-1 ring-offset-gray-950 ring-current' : ''}`}
          >
            <p className="text-2xl font-bold">{stats[s.key] || 0}</p>
            <p className="text-xs opacity-80 mt-1">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Ticket# yoki mavzu..."
            className="bg-gray-900 border border-gray-700 text-white pl-9 pr-4 py-2 rounded-lg text-sm w-60 focus:outline-none focus:border-red-500"
          />
        </div>
        <select value={priority} onChange={e => { setPriority(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-red-500">
          <option value="">Barcha muhimlik</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-10"><div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Ticket#', 'Foydalanuvchi', 'Mavzu', 'Kategoriya', 'Muhimlik', 'Holat', 'Javoblar', 'Sana'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-medium px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-10">Ticket topilmadi</td></tr>}
                {tickets.map((t: any) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-red-400">{t.ticketNumber}</td>
                    <td className="px-4 py-3">
                      <div className="text-white text-xs">{t.user?.fullName}</div>
                      <div className="text-gray-500 text-xs">{t.user?.email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-300 max-w-[180px] truncate">{t.subject}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{t.category}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded ${priorityBadge(t.priority)}`}>{t.priority}</span></td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded ${statusBadge(t.status)}`}>{t.status}</span></td>
                    <td className="px-4 py-3 text-gray-400 text-center">{t._count?.replies || 0}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatTime(t.createdAt)}</td>
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
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Ticket Detail Side Panel */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setSelectedId(null)} />
          <div className="w-full max-w-lg bg-gray-900 border-l border-gray-700 flex flex-col">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-800 flex-shrink-0">
              <h3 className="text-base font-semibold text-white">Ticket tafsiloti</h3>
              <button onClick={() => setSelectedId(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {detailLoading ? (
              <div className="flex justify-center py-10"><div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : ticketDetail ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {/* Ticket info */}
                  <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-red-400">{ticketDetail.ticketNumber}</span>
                      <div className="flex items-center gap-2">
                        <select
                          value={ticketDetail.status}
                          onChange={e => statusMut.mutate({ id: selectedId, status: e.target.value })}
                          disabled={statusMut.isPending}
                          className="bg-gray-700 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:outline-none disabled:opacity-50"
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                        </select>
                      </div>
                    </div>
                    <h4 className="text-white font-semibold">{ticketDetail.subject}</h4>
                    <p className="text-gray-400 text-sm">{ticketDetail.description}</p>
                    <div className="flex gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded ${priorityBadge(ticketDetail.priority)}`}>{ticketDetail.priority}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">{ticketDetail.category}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {ticketDetail.user?.fullName} ({ticketDetail.user?.email})
                      {ticketDetail.user?.branch?.name && ` · ${ticketDetail.user.branch.name}`}
                    </div>
                  </div>

                  {/* Chat replies */}
                  <div className="space-y-3">
                    {(ticketDetail.replies || []).map((r: any) => (
                      <div key={r.id} className={`flex ${r.isStaff ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-xl px-4 py-2.5 ${r.isStaff ? 'bg-red-900 text-red-100' : 'bg-gray-800 text-gray-200'}`}>
                          <p className="text-xs mb-1 opacity-70">{r.user?.fullName} · {r.isStaff ? 'Staff' : 'User'}</p>
                          <p className="text-sm">{r.message}</p>
                          <p className="text-xs opacity-50 mt-1">{formatTime(r.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                    {(!ticketDetail.replies || ticketDetail.replies.length === 0) && (
                      <p className="text-center text-gray-500 text-sm py-4">Hali javob yo'q</p>
                    )}
                  </div>
                </div>

                {/* Reply form */}
                <div className="border-t border-gray-800 p-4 flex-shrink-0">
                  <div className="flex gap-2">
                    <textarea
                      value={replyMsg}
                      onChange={e => setReplyMsg(e.target.value)}
                      rows={2}
                      placeholder="Javob yozing..."
                      className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-red-500"
                    />
                    <button
                      onClick={() => { if (replyMsg.trim()) replyMut.mutate({ id: selectedId, message: replyMsg }) }}
                      disabled={replyMut.isPending || !replyMsg.trim()}
                      className="p-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 self-end"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-center text-gray-500 py-8">Ma'lumot topilmadi</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
