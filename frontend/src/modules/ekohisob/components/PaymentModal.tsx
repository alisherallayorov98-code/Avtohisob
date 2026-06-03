import { useState } from 'react'
import { X, Loader2, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'

export interface EntityBasic {
  id: string
  name: string
  address: string
  monthlyFee: number
  unpaidMonths?: string[] // array of 'YYYY-MM' strings
}

interface PaymentModalProps {
  entity: EntityBasic
  onClose: () => void
  onSuccess: () => void
}

const UZ_MONTHS = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr',
]

function formatMonth(month: string): string {
  const [year, m] = month.split('-')
  return `${UZ_MONTHS[parseInt(m) - 1]} ${year}`
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('uz-UZ') + ' so\'m'
}

export default function PaymentModal({ entity, onClose, onSuccess }: PaymentModalProps) {
  const unpaidMonths = entity.unpaidMonths ?? [currentMonth()]
  const [selectedMonth, setSelectedMonth] = useState<string>(unpaidMonths[0] ?? currentMonth())
  const [amount, setAmount] = useState<string>(String(entity.monthlyFee))
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsedAmount = parseInt(amount.replace(/\D/g, ''), 10)
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error('To\'lov summasini to\'g\'ri kiriting')
      return
    }
    setLoading(true)
    try {
      await ekoApi.post('/payments', {
        entityId: entity.id,
        month: selectedMonth,
        amount: parsedAmount,
        note: note.trim() || undefined,
      })
      toast.success('To\'lov muvaffaqiyatli qayd etildi!')
      onSuccess()
      onClose()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error ||
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'To\'lov qayd etishda xato'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-gray-800">To'lovni qayd etish</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Entity info */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
          <p className="font-medium text-gray-900 text-sm">{entity.name}</p>
          <p className="text-gray-500 text-xs mt-0.5">{entity.address}</p>
          <p className="text-green-700 text-xs font-medium mt-1">
            Oylik to'lov: {formatAmount(entity.monthlyFee)}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Unpaid months quick select */}
          {unpaidMonths.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                To'lanmagan oylar (tez tanlash)
              </label>
              <div className="flex flex-wrap gap-2">
                {unpaidMonths.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSelectedMonth(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selectedMonth === m
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-green-400 hover:text-green-700'
                    }`}
                  >
                    {formatMonth(m)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Month input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              To'lov oyi
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">{formatMonth(selectedMonth)}</p>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Summa (so'm)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={1}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Izoh (ixtiyoriy)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Naqd, karta, bank o'tkazma..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm resize-none"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saqlanmoqda...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  To'landi
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
