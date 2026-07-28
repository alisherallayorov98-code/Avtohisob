import { useState, useEffect, useCallback } from 'react'
import { Loader2, ShieldAlert, Filter, ChevronLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { dateTime as fmtDateTime } from '../ui/format'

interface AuditLog {
  id: string
  userId: string | null
  userName: string
  action: string
  actionLabel: string
  targetType: string
  targetId: string | null
  targetName: string | null
  amount: number | null
  details: Record<string, any> | null
  createdAt: string
}

interface SummaryUser {
  name: string
  count: number
  deletedAmount: number
}

interface Summary {
  days: number
  total: number
  byAction: { action: string; label: string; count: number }[]
  byUser: SummaryUser[]
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('uz-UZ') + " so'm")

// Bekor qilish amallari alohida ajratiladi — nazorat uchun eng muhimi shu
const DESTRUCTIVE = new Set(['payment.delete', 'talon.delete', 'talon.unpaid', 'entity.deactivate'])

const ACTION_OPTIONS = [
  { value: '', label: 'Barcha amallar' },
  { value: 'payment.create', label: "To'lov qabul qilindi" },
  { value: 'payment.delete', label: "To'lov bekor qilindi" },
  { value: 'talon.create', label: 'Talon qo\'shildi' },
  { value: 'talon.paid', label: 'Talon to\'landi' },
  { value: 'talon.unpaid', label: 'Talon to\'lovi bekor qilindi' },
  { value: 'talon.delete', label: 'Talon o\'chirildi' },
  { value: 'entity.deactivate', label: 'Tashkilot deaktiv qilindi' },
  { value: 'charge.recalc', label: 'Hisoblar qayta hisoblandi' },
]

const PAGE_SIZE = 50

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (action) params.set('action', action)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    ekoApi.get(`/audit?${params}`)
      .then(res => {
        setLogs(res.data.data ?? [])
        setTotal(res.data.meta?.total ?? 0)
      })
      .catch(() => toast.error('Jurnalni yuklashda xato'))
      .finally(() => setLoading(false))
  }, [page, action, from, to])

  useEffect(load, [load])

  useEffect(() => {
    ekoApi.get('/audit/summary')
      .then(res => setSummary(res.data.data))
      .catch(() => {})
  }, [])

  // Filtr o'zgarganda birinchi sahifaga qaytamiz
  useEffect(() => { setPage(1) }, [action, from, to])

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-green-700" />
        <div>
          <h1 className="text-lg font-semibold text-eko-text">Amallar jurnali</h1>
          <p className="text-xs text-gray-500">Pulga ta'sir qiluvchi har bir amal: kim, qachon, nima</p>
        </div>
      </div>

      {/* 30 kunlik xulosa — nazorat uchun */}
      {summary && summary.total > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="bg-eko-surface rounded-eko-lg border border-eko-line shadow-eko p-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">
              Oxirgi {summary.days} kun — amallar ({summary.total})
            </p>
            <div className="space-y-1.5">
              {summary.byAction.map(a => (
                <div key={a.action} className="flex items-center justify-between text-sm">
                  <span className={DESTRUCTIVE.has(a.action) ? 'text-red-600' : 'text-gray-700'}>{a.label}</span>
                  <span className="font-semibold text-gray-800">{a.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-eko-surface rounded-eko-lg border border-eko-line shadow-eko p-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">Xodimlar bo'yicha</p>
            <div className="space-y-1.5">
              {summary.byUser.slice(0, 8).map(u => (
                <div key={u.name} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 truncate mr-2">{u.name}</span>
                  <span className="shrink-0">
                    <span className="text-gray-500">{u.count} amal</span>
                    {u.deletedAmount > 0 && (
                      <span className="ml-2 text-red-600 font-semibold" title="Bekor qilingan summa">
                        −{fmt(u.deletedAmount)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filtrlar */}
      <div className="bg-eko-surface rounded-eko-lg border border-eko-line shadow-eko p-3 flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-gray-400" />
        <select
          value={action}
          onChange={e => setAction(e.target.value)}
          className="text-sm border border-eko-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="text-sm border border-eko-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <span className="text-gray-400 text-sm">—</span>
        <input
          type="date" value={to} onChange={e => setTo(e.target.value)}
          className="text-sm border border-eko-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        {(action || from || to) && (
          <button
            onClick={() => { setAction(''); setFrom(''); setTo('') }}
            className="text-xs text-gray-500 hover:text-gray-800 underline"
          >
            Tozalash
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{total} ta yozuv</span>
      </div>

      {/* Ro'yxat */}
      <div className="bg-eko-surface rounded-eko-lg border border-eko-line shadow-eko overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-green-600" /></div>
        ) : logs.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-16">Yozuv topilmadi</p>
        ) : (
          <div className="divide-y divide-eko-line">
            {logs.map(l => (
              <div key={l.id} className="px-4 py-3 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${DESTRUCTIVE.has(l.action) ? 'text-red-600' : 'text-gray-800'}`}>
                        {l.actionLabel}
                      </span>
                      {l.targetName && (
                        <span className="text-sm text-gray-600 truncate">· {l.targetName}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {l.userName} · {fmtDateTime(l.createdAt)}
                      {l.details?.month ? ` · ${l.details.month}` : ''}
                      {l.details?.receiptNumber ? ` · ${l.details.receiptNumber}` : ''}
                    </p>
                    {l.details?.reason && (
                      <p className="text-xs text-gray-500 mt-0.5 italic">Sabab: {l.details.reason}</p>
                    )}
                  </div>
                  {l.amount != null && (
                    <span className={`text-sm font-semibold shrink-0 ${DESTRUCTIVE.has(l.action) ? 'text-red-600' : 'text-green-700'}`}>
                      {DESTRUCTIVE.has(l.action) ? '−' : ''}{fmt(l.amount)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sahifalash */}
      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-2 rounded-lg border border-eko-line disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-gray-600">{page} / {lastPage}</span>
          <button
            onClick={() => setPage(p => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
            className="p-2 rounded-lg border border-eko-line disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
