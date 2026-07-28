import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, CalendarDays, CheckCircle2, Plus, Download, Scale } from 'lucide-react'
import toast from 'react-hot-toast'
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
  billingMode: 'monthly_fixed' | 'variable' | 'talon'
  monthlyFee: number
  cubicPrice?: number
  totalDebt: number
  unpaidMonths?: string[]
  timeline: TimelineRow[]
}

const MODE_LABEL: Record<string, string> = {
  monthly_fixed: 'Belgilangan oylik',
  variable: "O'zgaruvchan",
  talon: 'Talon (kub asosida)',
}

interface Props {
  entityId: string
  entityName: string
  onClose: () => void
  onAddPayment: () => void
}

/**
 * Akt sverkani chop etish uchun ochadi.
 * Sahifa autentifikatsiya talab qiladi — HTML token bilan olinib blob'da ochiladi.
 */
async function openReconciliation(entityId: string) {
  try {
    const res = await ekoApi.get(`/entities/${entityId}/reconciliation/print`, { responseType: 'text' })
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html;charset=utf-8' }))
    const w = window.open(url, '_blank')
    if (!w) toast.error('Brauzer yangi oynani bloklab qo\'ydi — ruxsat bering')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch {
    toast.error('Akt sverkani ochishda xato')
  }
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
  const [invoiceLoading, setInvoiceLoading] = useState(false)

  async function handleDownloadInvoice() {
    setInvoiceLoading(true)
    try {
      const res = await ekoApi.get(`/entities/${entityId}/invoice`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `faktura_${entityName.slice(0, 30)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Faktura yuklab olishda xato')
    } finally {
      setInvoiceLoading(false)
    }
  }

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
      <div className="bg-eko-surface rounded-eko-lg shadow-eko-lg w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-eko-line">
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
            <div className="px-6 py-4 bg-gray-50 border-b border-eko-line grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500">To'lov rejimi</p>
                <p className="text-sm font-medium text-gray-800">
                  {MODE_LABEL[data.billingMode] ?? data.billingMode}
                </p>
                {data.billingMode === 'talon' && data.cubicPrice ? (
                  <p className="text-xs text-blue-600 mt-0.5">{formatAmount(data.cubicPrice)}/kub</p>
                ) : null}
              </div>
              {/* Qarz talon rejimida ham ko'rsatiladi — ilgari faqat oylik rejimda edi */}
              {data.billingMode !== 'variable' && (
                <div>
                  <p className="text-xs text-gray-500">Jami qarz</p>
                  <p className={`text-sm font-bold ${data.totalDebt > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatAmount(data.totalDebt)}
                  </p>
                  {data.unpaidMonths && data.unpaidMonths.length > 0 && (
                    <p className="text-xs text-red-500 mt-0.5">{data.unpaidMonths.length} oy qarzdor</p>
                  )}
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
            <div className="flex-1 overflow-y-auto px-6 py-3 divide-y divide-eko-line">
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
            <div className="px-6 py-4 border-t border-eko-line flex gap-2">
              <button
                onClick={handleDownloadInvoice}
                disabled={invoiceLoading}
                className="flex items-center justify-center gap-2 px-3 py-2.5 border border-eko-line hover:bg-gray-50 text-gray-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                title="Faktura (Excel) yuklab olish"
              >
                {invoiceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Faktura
              </button>
              <button
                onClick={() => openReconciliation(entityId)}
                className="flex items-center justify-center gap-2 px-3 py-2.5 border border-eko-line hover:bg-gray-50 text-gray-600 rounded-lg text-sm font-medium transition-colors"
                title="Solishtirma dalolatnoma (saldo bilan)"
              >
                <Scale className="w-4 h-4" />
                Akt sverka
              </button>
              <button
                onClick={onAddPayment}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
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
