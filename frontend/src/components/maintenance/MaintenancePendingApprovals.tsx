import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Image, ChevronDown, ChevronUp, Loader2, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import Button from '../ui/Button'
import Badge from '../ui/Badge'

interface Evidence {
  id: string
  fileUrl: string
  fileSizeBytes: number
  createdAt: string
}

interface PendingRecord {
  id: string
  vehicleId: string
  installationDate: string
  cost: number
  laborCost: number
  workerName?: string
  notes?: string
  status: string
  vehicle: { id: string; registrationNumber: string; brand: string; model: string }
  performedBy: { id: string; fullName: string }
  items: Array<{
    id: string
    sparePart: { name: string; partCode: string }
    quantityUsed: number
    unitCost: number
    warehouse?: { name: string }
  }>
  evidence: Evidence[]
}

export default function MaintenancePendingApprovals() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance-pending'],
    queryFn: () => api.get('/maintenance/pending').then(r => r.data),
    refetchInterval: 30_000,
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/maintenance/${id}/approve`),
    onSuccess: () => {
      toast.success('Tasdiqlandi, ehtiyot qism hisobdan chiqarildi')
      qc.invalidateQueries({ queryKey: ['maintenance-pending'] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/maintenance/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success("Rad etildi")
      setRejectId(null)
      setRejectReason('')
      qc.invalidateQueries({ queryKey: ['maintenance-pending'] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const records: PendingRecord[] = data?.data || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Yuklanmoqda...
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        <Clock className="mx-auto w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm">Tasdiqlash kutayotgan yozuv yo'q</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {records.map(r => {
        const isExpanded = expanded === r.id
        const totalCost = Number(r.cost) + Number(r.laborCost)
        const hasEvidence = r.evidence.length > 0

        return (
          <div
            key={r.id}
            className="border border-amber-200 dark:border-amber-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800"
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/10"
              onClick={() => setExpanded(isExpanded ? null : r.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {r.vehicle.registrationNumber}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {r.vehicle.brand} {r.vehicle.model}
                  </span>
                  <Badge variant="warning">Kutmoqda</Badge>
                  {hasEvidence ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <Image className="w-3 h-3" /> {r.evidence.length} ta rasm
                    </span>
                  ) : (
                    <span className="text-xs text-red-500 flex items-center gap-1">
                      <Image className="w-3 h-3" /> Rasm yo'q
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-400 space-x-3">
                  <span>{r.performedBy.fullName}</span>
                  <span>{formatDate(r.installationDate)}</span>
                  <span className="font-medium text-gray-600 dark:text-gray-300">{formatCurrency(totalCost)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20"
                  onClick={e => { e.stopPropagation(); setRejectId(r.id); setRejectReason('') }}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  <XCircle className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white gap-1"
                  onClick={e => { e.stopPropagation(); approveMutation.mutate(r.id) }}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  {approveMutation.isPending && approveMutation.variables === r.id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CheckCircle className="w-4 h-4" />}
                  Tasdiqlash
                </Button>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </div>
            </div>

            {/* Details */}
            {isExpanded && (
              <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
                {/* Parts */}
                {r.items.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                      Ehtiyot qismlar
                    </p>
                    <div className="space-y-1">
                      {r.items.map(item => (
                        <div key={item.id} className="flex justify-between text-sm text-gray-700 dark:text-gray-300">
                          <span>{item.sparePart.name} <span className="text-gray-400 text-xs">× {item.quantityUsed}</span></span>
                          <span>{formatCurrency(Number(item.unitCost) * item.quantityUsed)}</span>
                        </div>
                      ))}
                      {Number(r.laborCost) > 0 && (
                        <div className="flex justify-between text-sm text-gray-700 dark:text-gray-300">
                          <span>Usta haqi {r.workerName ? `(${r.workerName})` : ''}</span>
                          <span>{formatCurrency(Number(r.laborCost))}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {r.notes && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Izoh</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{r.notes}</p>
                  </div>
                )}

                {/* Evidence photos */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    Foto-otchet
                  </p>
                  {r.evidence.length === 0 ? (
                    <p className="text-sm text-red-500 dark:text-red-400 italic">Rasm yuklanmagan</p>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      {r.evidence.map(ev => (
                        <a
                          key={ev.id}
                          href={ev.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={ev.fileUrl}
                            alt="evidence"
                            className="w-32 h-32 object-cover rounded-lg border border-gray-200 dark:border-gray-600 hover:opacity-90 transition-opacity"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Reject dialog inline */}
            {rejectId === r.id && (
              <div className="border-t border-red-100 dark:border-red-800 p-4 bg-red-50 dark:bg-red-900/10">
                <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">Rad etish sababi</p>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Nima uchun rad etildi (ixtiyoriy)..."
                  rows={2}
                  className="w-full text-sm rounded-lg border border-red-200 dark:border-red-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-700 dark:text-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                <div className="flex gap-2 justify-end mt-2">
                  <Button size="sm" variant="outline" onClick={() => setRejectId(null)}>
                    Bekor
                  </Button>
                  <Button
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => rejectMutation.mutate({ id: r.id, reason: rejectReason })}
                    disabled={rejectMutation.isPending}
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
