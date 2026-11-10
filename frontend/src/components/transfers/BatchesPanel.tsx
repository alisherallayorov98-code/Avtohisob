import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Clock, FileText, Inbox, Package, Search, Send, XCircle, CheckCircle2 } from 'lucide-react'
import api from '../../lib/api'
import { formatDate } from '../../lib/utils'
import { useDebounce } from '../../hooks/useDebounce'
import Pagination from '../ui/Pagination'

export interface BatchRow {
  id: string
  documentNumber: string
  status: string
  createdAt: string
  shippedAt?: string | null
  receivedAt?: string | null
  fromWarehouse: { id: string; name: string }
  toWarehouse: { id: string; name: string }
  createdBy?: { fullName: string } | null
  _count?: { transfers: number }
  transfers: { quantity: number; receivedQuantity: number | null; sparePart: { name: string; partCode: string } }[]
  canShip: boolean
  canReceive: boolean
  hasShortage: boolean
}

interface Stats { pending: number; shipped: number; received: number; closed: number; incoming: number; stale: number; shortage: number }

export const STALE_DAYS = 3
const STATUS_LABEL: Record<string, string> = {
  pending: 'Kutmoqda', shipped: "Yo'lda", received: 'Qabul qilingan', cancelled: 'Bekor qilingan', rejected: 'Rad etilgan',
}
const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  shipped: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  received: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

const daysSince = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0)

type Filter = '' | 'pending' | 'shipped' | 'received' | 'closed' | 'incoming'

export default function BatchesPanel({ canCreate, onOpen, onAction }: {
  canCreate: boolean
  onOpen: (id: string) => void
  onAction: (id: string, mode: 'ship' | 'receive') => void
}) {
  const [filter, setFilter] = useState<Filter>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const limit = 20
  const dq = useDebounce(q, 350)

  const { data: stats } = useQuery({
    queryKey: ['batches', 'stats'],
    queryFn: () => api.get('/batches/stats').then(r => r.data.data as Stats),
    refetchInterval: 60_000,
  })

  const statusParam = filter === 'incoming' || filter === '' ? undefined : filter === 'closed' ? undefined : filter
  const { data, isLoading } = useQuery({
    queryKey: ['batches', 'list', filter, dq, page],
    queryFn: () => api.get('/batches', {
      params: { page, limit, status: statusParam, q: dq || undefined, incoming: filter === 'incoming' ? '1' : undefined },
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  let rows: BatchRow[] = data?.data || []
  // "Bekor/rad" bitta chip — server status bo'yicha bitta qiymat oladi, shuning uchun shu yerda saralaymiz
  if (filter === 'closed') rows = rows.filter(r => r.status === 'cancelled' || r.status === 'rejected')

  const cards: { key: Filter; label: string; value: number; icon: any; cls: string; sub?: string; subCls?: string }[] = [
    { key: 'pending', label: 'Kutmoqda', value: stats?.pending ?? 0, icon: Clock, cls: 'text-amber-600' },
    { key: 'shipped', label: "Yo'lda", value: stats?.shipped ?? 0, icon: Send, cls: 'text-blue-600',
      sub: stats?.stale ? `${stats.stale} ta ${STALE_DAYS} kundan oshdi` : undefined, subCls: 'text-red-600 dark:text-red-400 font-semibold' },
    { key: 'received', label: 'Qabul qilingan', value: stats?.received ?? 0, icon: CheckCircle2, cls: 'text-emerald-600',
      sub: stats?.shortage ? `${stats.shortage} ta qabul qilingan` : undefined },
    { key: 'closed', label: 'Bekor / rad', value: stats?.closed ?? 0, icon: XCircle, cls: 'text-gray-500' },
  ]
  // "Qabul qilingan" ostidagi qo'shimcha yozuvni olib tashlaymiz (kamomad alohida ro'yxatda emas) — chalg'itmasin
  cards[2].sub = undefined

  return (
    <div className="space-y-4">
      {/* Holat kartalari */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(c => {
          const Icon = c.icon
          const active = filter === c.key
          return (
            <button key={c.key} onClick={() => { setFilter(active ? '' : c.key); setPage(1) }}
              className={`text-left rounded-xl border p-4 transition-colors ${active
                ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-900/20 dark:border-blue-600'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}`}>
              <p className={`flex items-center gap-1.5 text-xs font-medium ${c.cls}`}><Icon className="w-3.5 h-3.5" />{c.label}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{c.value}</p>
              {c.sub && <p className={`text-xs mt-0.5 ${c.subCls || 'text-gray-400'}`}>{c.sub}</p>}
            </button>
          )
        })}
      </div>

      {/* Qabul qilishni kutayotganlar */}
      {(stats?.incoming ?? 0) > 0 && filter !== 'incoming' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200">
            <Package className="w-4 h-4" />
            <span><b>{stats!.incoming} ta</b> jo'natma qabul qilinishini kutmoqda</span>
          </p>
          <button onClick={() => { setFilter('incoming'); setPage(1) }} className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline">Ko'rish →</button>
        </div>
      )}

      {/* Qidiruv */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Hujjat raqami, qism yoki ombor…"
            className="h-10 w-full pl-9 pr-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {(filter || q) && (
          <button onClick={() => { setFilter(''); setQ(''); setPage(1) }} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Filtrni tozalash</button>
        )}
        <span className="text-xs text-gray-400 sm:ml-auto">{data?.meta?.total ?? 0} ta jo'natma</span>
      </div>

      {/* Ro'yxat */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
        {isLoading && <p className="py-12 text-center text-sm text-gray-400">Yuklanmoqda…</p>}
        {!isLoading && rows.length === 0 && (
          <div className="py-14 text-center text-gray-400">
            <Inbox className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{q || filter ? 'Hech narsa topilmadi' : "Hali jo'natma yo'q"}</p>
            {canCreate && !q && !filter && <p className="text-xs mt-1">Yuqoridagi «Jo'natma» tugmasi bilan birinchisini yarating</p>}
          </div>
        )}
        {rows.map(b => {
          const stale = b.status === 'shipped' && daysSince(b.shippedAt) >= STALE_DAYS
          const names = b.transfers.map(t => t.sparePart.name)
          const summary = names.slice(0, 2).join(', ') + (names.length > 2 ? ` va yana ${names.length - 2} ta` : '')
          return (
            <div key={b.id} className={`px-4 py-3.5 flex flex-wrap lg:flex-nowrap items-center gap-x-6 gap-y-2 ${stale ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
              <button onClick={() => onOpen(b.id)} className="text-left w-36 flex-shrink-0">
                <p className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline">{b.documentNumber}</p>
                <p className="text-xs text-gray-400">{formatDate(b.createdAt)}</p>
              </button>
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white min-w-0">
                  <span className="truncate">{b.fromWarehouse.name}</span>
                  <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="truncate">{b.toWarehouse.name}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{summary || '—'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 w-full lg:w-auto lg:min-w-[180px]">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${STATUS_CHIP[b.status] || STATUS_CHIP.cancelled}`}>{STATUS_LABEL[b.status] || b.status}</span>
                {stale && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    <AlertTriangle className="w-3 h-3" />{daysSince(b.shippedAt)} kundan beri yo'lda
                  </span>
                )}
                {b.hasShortage && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    <AlertTriangle className="w-3 h-3" />Kamomad
                  </span>
                )}
                <span className="text-xs text-gray-400">{b._count?.transfers || 0} xil qism</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                {b.status === 'pending' && b.canShip && (
                  <button onClick={() => onAction(b.id, 'ship')} className="flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
                    <Send className="w-3.5 h-3.5" /> Yuborish
                  </button>
                )}
                {b.status === 'shipped' && b.canReceive && (
                  <button onClick={() => onAction(b.id, 'receive')} className="flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Package className="w-3.5 h-3.5" /> Qabul qilish
                  </button>
                )}
                <button onClick={() => onOpen(b.id)} title="Hujjatni ko'rish" className="h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <FileText className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={() => {}} />
    </div>
  )
}
