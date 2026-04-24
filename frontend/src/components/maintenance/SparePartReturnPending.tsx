import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Loader2, RotateCcw, Image, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiBaseUrl } from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import Button from '../ui/Button'

interface PendingReturn {
  id: string
  branchId: string
  reason: string
  notes?: string
  status: string
  returnDate: string
  createdAt: string
  returnedBy: { fullName: string }
  maintenance?: {
    id: string
    installationDate: string
    vehicle: { registrationNumber: string; brand: string; model: string }
  }
  items: Array<{
    id: string
    sparePart: { name: string; partCode: string }
    quantity: number
    unitCost: number
  }>
  evidence: Array<{ id: string; fileUrl: string }>
}

export default function SparePartReturnPending() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['returns-pending'],
    queryFn: () => api.get('/spare-part-returns/pending').then(r => r.data),
    refetchInterval: 30_000,
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/spare-part-returns/${id}/approve`),
    onSuccess: () => {
      toast.success('Qaytarish tasdiqlandi, ombor tiklandi')
      qc.invalidateQueries({ queryKey: ['returns-pending'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/spare-part-returns/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success('Rad etildi')
      setRejectId(null); setRejectReason('')
      qc.invalidateQueries({ queryKey: ['returns-pending'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const records: PendingReturn[] = data?.data || []

  if (isLoading) return (
    <div className="flex items-center justify-center py-12 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Yuklanmoqda...
    </div>
  )

  if (records.length === 0) return (
    <div className="text-center py-12 text-gray-400 dark:text-gray-500">
      <RotateCcw className="mx-auto w-10 h-10 mb-3 opacity-40" />
      <p className="text-sm">Tasdiqlash kutayotgan qaytarish so'rovi yo'q</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {records.map(r => {
        const isExpanded = expanded === r.id
        const totalValue = r.items.reduce((s, i) => s + i.quantity * Number(i.unitCost), 0)
        const hasEvidence = r.evidence.length > 0

        return (
          <div key={r.id} className="border border-orange-200 dark:border-orange-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800">
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-900/10"
              onClick={() => setExpanded(isExpanded ? null : r.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <RotateCcw className="w-4 h-4 text-orange-500 shrink-0" />
                  {r.maintenance ? (
                    <span className="font-mono font-semibold text-gray-900 dark:text-white">
                      {r.maintenance.vehicle.registrationNumber}
                    </span>
                  ) : (
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Erkin qaytarish</span>
                  )}
                  <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full font-medium">
                    Kutmoqda
                  </span>
                  {hasEvidence
                    ? <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><Image className="w-3 h-3" />{r.evidence.length} ta rasm</span>
                    : <span className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Rasm yo'q</span>
                  }
                </div>
                <div className="mt-1 text-xs text-gray-400 space-x-3">
                  <span>{r.returnedBy.fullName}</span>
                  <span>{formatDate(r.createdAt)}</span>
                  {totalValue > 0 && <span className="font-medium text-gray-600 dark:text-gray-300">{formatCurrency(totalValue)}</span>}
                </div>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 italic line-clamp-1">Sabab: {r.reason}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-700"
                  onClick={e => { e.stopPropagation(); setRejectId(r.id); setRejectReason('') }}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  <XCircle className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white gap-1"
                  onClick={e => { e.stopPropagation(); approveMutation.mutate(r.id) }}
                  disabled={approveMutation.isPending || rejectMutation.isPending || !hasEvidence}
                  title={!hasEvidence ? 'Tasdiqlash uchun foto kerak' : ''}
                >
                  {approveMutation.isPending && approveMutation.variables === r.id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CheckCircle className="w-4 h-4" />}
                  Tasdiqlash
                </Button>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
                {r.maintenance && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    <span className="font-medium">Ta'mirlash:</span>{' '}
                    {r.maintenance.vehicle.brand} {r.maintenance.vehicle.model} • {formatDate(r.maintenance.installationDate)}
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Qaytariladigan qismlar</p>
                  <div className="space-y-1">
                    {r.items.map(item => (
                      <div key={item.id} className="flex justify-between text-sm text-gray-700 dark:text-gray-300">
                        <span>{item.sparePart.name} <span className="text-gray-400 text-xs">× {item.quantity}</span></span>
                        <span>{formatCurrency(Number(item.unitCost) * item.quantity)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {r.notes && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Izoh</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{r.notes}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Foto-otchet</p>
                  {!hasEvidence ? (
                    <p className="text-sm text-red-500 italic flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" /> Rasm yuklanmagan — tasdiqlash mumkin emas
                    </p>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      {r.evidence.map(ev => (
                        <a key={ev.id} href={`${apiBaseUrl}${ev.fileUrl}`} target="_blank" rel="noopener noreferrer">
                          <img src={`${apiBaseUrl}${ev.fileUrl}`} alt="evidence" className="w-32 h-32 object-cover rounded-lg border border-gray-200 dark:border-gray-600 hover:opacity-90 transition-opacity" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {rejectId === r.id && (
              <div className="border-t border-red-100 dark:border-red-800 p-4 bg-red-50 dark:bg-red-900/10">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2">
                  Rad etish sababi <span className="text-red-500">*</span>
                </p>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Nima uchun rad etildi..."
                  rows={2}
                  className="w-full text-sm rounded-lg border border-red-200 dark:border-red-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-700 dark:text-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                <div className="flex gap-2 justify-end mt-2">
                  <Button size="sm" variant="outline" onClick={() => setRejectId(null)}>Bekor</Button>
                  <Button
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => rejectMutation.mutate({ id: r.id, reason: rejectReason })}
                    disabled={rejectMutation.isPending || !rejectReason.trim()}
                  >
                    {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rad etish'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
