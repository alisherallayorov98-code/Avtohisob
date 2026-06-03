import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, CalendarDays, CheckCircle2, AlertCircle, Plus } from 'lucide-react'
import ekoApi from '../lib/ekoApi'

const UZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
]

function formatMonth(month: string): string {
  const [year, m] = month.split('-')
  return `${UZ_MONTHS[parseInt(m) - 1]} ${year}`
}

function formatAmount(amount: number | null): string {
  if (amount == null) return '—'
  return amount.toLocaleString('uz-UZ') + " so'm"
}

interface TimelineRow {
  month: string
  expected: number | null
  paid: number
  status: 'paid' | 'partial' | 'unpaid' | 'none'
}

interface LedgerData {
  billingMode: 'monthly_fixed' | 'variable'
  monthlyFee: number
  totalDebt: number
  timeline: TimelineRow[]
}

interface Props {
  entityId: string
  entityName: string
  onClose: () => void
  onAddPayment: () => void
}

const STATUS_STYLE: Record<string, { dot: string; label: string; text: string }> = {
  paid: { dot: 'bg-green-500', label: "To'langan", text: 'text-green-700' },
  partial: { dot: 'bg-orange-500', label: 'Qisman', text: 'text-orange-700' },
  unpaid: { dot: 'bg-red-500', label: "To'lanmagan", text: 'text-red-700' },
  none: { dot: 'bg-gray-300', label: '—', text: 'text-gray-400' },
}

export default function EntityLedgerModal({ entityId, entityName, onClose, onAddPayment }: Props) {
  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchLedger = useCallback(() => {
    setLoading(true)
    ekoApi.get(`/charges/entity/${entityId}`)
      .then(res => setData(res.data.data ?? res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [entityId])

  useEffect(() => { fetchLedger() }, [fetchLedger])

  // Eng so'nggi to'langan oy ("X oygacha to'lagan")
  const paidThrough = data?.timeline
    ? [...data.timeline].reverse().find(r => r.status === 'paid')?.month
    : undefined

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDays className="w-5 h-5 text-green-600 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-800 truncate">{entityName}</h3>
              <p className="text-xs text-gray-500">To'lovlar tasmasi</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
          </div>
        ) : !data ? (
          <div className="py-16 text-center text-gray-400 text-sm">Ma'lumot topilmadi</div>
        ) : (
          <>
            {/* Summary */}
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500">To'lov rejimi</p>
                <p className="text-sm font-medium text-gray-800">
                  {data.billingMode === 'monthly_fixed' ? 'Belgilangan oylik' : "O'zgaruvchan"}
                </p>
              </div>
              {data.billingMode === 'monthly_fixed' && (
                <div>
                  <p className="text-xs text-gray-500">Jami qarz</p>
                  <p className={`text-sm font-bold ${data.totalDebt > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatAmount(data.totalDebt)}
                  </p>
                </div>
              )}
              {paidThrough && (
                <div className="col-span-2 flex items-center gap-1.5 text-xs text-green-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {formatMonth(paidThrough)} gacha to'lagan
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-6 py-3 divide-y divide-gray-50">
              {[...data.timeline].reverse().map(row => {
                const s = STATUS_STYLE[row.status]
                return (
                  <div key={row.month} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                      <span className="text-sm text-gray-700">{formatMonth(row.month)}</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
                      {row.paid > 0 && (
                        <span className="text-xs text-gray-500 ml-2">{formatAmount(row.paid)}</span>
                      )}
                      {row.status === 'partial' && row.expected != null && (
                        <span className="text-xs text-orange-500 ml-1">/ {formatAmount(row.expected)}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100">
              <button
                onClick={onAddPayment}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                <Plus className="w-4 h-4" />
                To'lov qo'shish
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
