import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Package, Loader2, X, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { getFileUrl } from '../../lib/api'
import { formatDate } from '../../lib/utils'
import Button from '../ui/Button'

interface OldPartDebt {
  id: string
  vehicleLabel: string
  workerName: string
  sparePartName: string
  quantity: number
  status: 'open' | 'submitted' | 'cleared' | 'rejected'
  submittedAt?: string
  deliveryMethod?: string
  submissionNote?: string
  rejectedReason?: string
  approvedAt?: string
  createdAt: string
  worker: { id: string; fullName: string }
  approvedBy?: { id: string; fullName: string }
  evidence: Array<{ id: string; fileUrl: string }>
}

const METHOD_LABELS: Record<string, string> = {
  photo: '📷 Foto yubordi',
  physical: '🏢 Jismoniy olib keladi',
}

function StatusBadge({ status }: { status: OldPartDebt['status'] }) {
  const map = {
    open:      { label: 'Topshirilmagan', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    submitted: { label: 'Tekshirilmoqda', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    cleared:   { label: 'Qabul qilindi',  cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    rejected:  { label: 'Rad etildi',     cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  }
  const s = map[status]
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
}

const LIMIT = 20

export default function OldPartDebtAdmin() {
  const qc = useQueryClient()
  const [filterStatus, setFilterStatus] = useState<'submitted' | 'open' | 'cleared' | ''>('submitted')
  const [branchId, setBranchId] = useState('')
  const [page, setPage] = useState(1)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [lightbox, setLightbox] = useState<string | null>(null)

  const { data: branchesData } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data || []),
    staleTime: 60_000,
  })

  const { data: resp, isLoading } = useQuery({
    queryKey: ['old-part-debts', filterStatus, branchId, page],
    queryFn: () => api.get('/old-part-debts', {
      params: {
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(branchId ? { branchId } : {}),
        page,
        limit: LIMIT,
      }
    }).then(r => r.data),
  })

  const debts: OldPartDebt[] = resp?.data || []
  const meta = resp?.meta || { total: 0, totalPages: 1 }

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/old-part-debts/${id}/approve`),
    onSuccess: () => { toast.success('Qabul qilindi'); qc.invalidateQueries({ queryKey: ['old-part-debts'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/old-part-debts/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success('Rad etildi')
      qc.invalidateQueries({ queryKey: ['old-part-debts'] })
      setRejectId(null); setRejectReason('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const branches = branchesData || []

  const tabs: Array<{ key: typeof filterStatus; label: string }> = [
    { key: 'submitted', label: 'Tekshirilmoqda' },
    { key: 'open',      label: 'Topshirilmagan' },
    { key: 'cleared',   label: 'Qabul qilingan' },
    { key: '',          label: 'Hammasi' },
  ]

  function handleTabChange(key: typeof filterStatus) {
    setFilterStatus(key)
    setPage(1)
  }

  function handleBranchChange(val: string) {
    setBranchId(val)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      {/* Filtrlar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tablari */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filterStatus === t.key
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Filial filtri */}
        {branches.length > 1 && (
          <select
            value={branchId}
            onChange={e => handleBranchChange(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option value="">Barcha filiallar</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}

        <span className="text-xs text-gray-400 ml-auto">
          Jami: {meta.total} ta
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : debts.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Hech narsa yo'q</p>
        </div>
      ) : (
        <div className="space-y-3">
          {debts.map(debt => (
            <div key={debt.id} className={`rounded-xl border p-4 ${
              debt.status === 'submitted' ? 'border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10' :
              debt.status === 'cleared'   ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800' :
              'border-red-100 dark:border-red-900 bg-white dark:bg-gray-800'
            }`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">{debt.sparePartName} × {debt.quantity}</span>
                    <StatusBadge status={debt.status} />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{debt.vehicleLabel}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0">{formatDate(debt.createdAt)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-2 py-1.5">
                  <span className="text-gray-500">Xodim: </span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{debt.worker?.fullName || debt.workerName}</span>
                </div>
                {debt.deliveryMethod && (
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-2 py-1.5">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{METHOD_LABELS[debt.deliveryMethod] || debt.deliveryMethod}</span>
                  </div>
                )}
                {debt.submissionNote && (
                  <div className="col-span-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-2 py-1.5 text-blue-700 dark:text-blue-400">
                    Izoh: {debt.submissionNote}
                  </div>
                )}
                {debt.rejectedReason && (
                  <div className="col-span-2 bg-red-50 dark:bg-red-900/20 rounded-lg px-2 py-1.5 text-red-600 dark:text-red-400">
                    Rad sababi: {debt.rejectedReason}
                  </div>
                )}
                {debt.approvedBy && (
                  <div className="col-span-2 bg-green-50 dark:bg-green-900/20 rounded-lg px-2 py-1.5 text-green-700 dark:text-green-400">
                    Qabul qildi: {debt.approvedBy.fullName} — {formatDate(debt.approvedAt!)}
                  </div>
                )}
              </div>

              {debt.evidence.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-3">
                  {debt.evidence.map(ev => (
                    <img key={ev.id} src={getFileUrl(ev.fileUrl)} alt=""
                      onClick={() => setLightbox(getFileUrl(ev.fileUrl))}
                      className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700 cursor-zoom-in hover:opacity-80 transition-opacity" />
                  ))}
                </div>
              )}

              {debt.status === 'submitted' && debt.deliveryMethod === 'photo' && debt.evidence.length === 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Foto hali yuklanmagan — tasdiqlash mumkin emas
                </div>
              )}

              {debt.status === 'submitted' && (
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline"
                    onClick={() => { setRejectId(debt.id); setRejectReason('') }}
                    disabled={rejectMutation.isPending || approveMutation.isPending}
                    className="text-red-600 border-red-300 hover:bg-red-50">
                    <XCircle className="w-4 h-4 mr-1" /> Rad etish
                  </Button>
                  <Button size="sm"
                    onClick={() => approveMutation.mutate(debt.id)}
                    disabled={approveMutation.isPending || rejectMutation.isPending ||
                      (debt.deliveryMethod === 'photo' && debt.evidence.length === 0)}>
                    {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                    Qabul qilish
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-gray-500">{page}-sahifa / {meta.totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, meta.totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2 + i, meta.totalPages - 4 + i))
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 text-xs rounded-lg border transition-colors ${
                    p === page
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}>
                  {p}
                </button>
              )
            })}
            <button onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))} disabled={page === meta.totalPages}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Rad etish modali */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">Rad etish sababi</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
              placeholder="Nima uchun rad etilmoqda? Xodimga tushuntirilsin..."
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejectId(null)} disabled={rejectMutation.isPending}>Bekor</Button>
              <Button onClick={() => rejectMutation.mutate({ id: rejectId, reason: rejectReason })}
                disabled={rejectMutation.isPending || !rejectReason.trim()}
                className="bg-red-600 hover:bg-red-700">
                {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rad etish'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 cursor-zoom-out" onClick={() => setLightbox(null)}>
          <button onClick={e => { e.stopPropagation(); setLightbox(null) }}
            className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full">
            <X className="w-5 h-5" />
          </button>
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
