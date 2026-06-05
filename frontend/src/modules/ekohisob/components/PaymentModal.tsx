import { useState, useEffect } from 'react'
import { X, Loader2, CheckCircle2, Receipt, History } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'

interface ChargeStatus {
  expectedAmount: number
  paidAmount: number
  remaining: number
  status: string
  billingMode: string
  payments: Array<{ id: string; amount: number; paidAt: string; note?: string; receiver?: string }>
}

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
  const [submitted, setSubmitted] = useState(false)
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null)
  const [charge, setCharge] = useState<ChargeStatus | null>(null)
  const [chargeLoading, setChargeLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Tanlangan oy uchun qarz holatini yuklash
  useEffect(() => {
    setChargeLoading(true)
    ekoApi.get('/payments/charge-status', { params: { entityId: entity.id, month: selectedMonth } })
      .then(res => {
        const d: ChargeStatus = res.data.data ?? res.data
        setCharge(d)
        // Qolgan qarzni default summa qilamiz (qisman to'langan bo'lsa qolganini taklif)
        if (d.remaining > 0) setAmount(String(d.remaining))
        else if (d.paidAmount === 0) setAmount(String(d.expectedAmount || entity.monthlyFee))
      })
      .catch(() => setCharge(null))
      .finally(() => setChargeLoading(false))
  }, [selectedMonth, entity.id])

  // To'liq to'langanmi?
  const isFullyPaid = charge !== null && charge.remaining === 0 && charge.paidAmount > 0
  // Qisman to'langanmi (qarz qolgan)? — UI ranglari uchun
  const isPartiallyPaid = charge !== null && charge.paidAmount > 0 && charge.remaining > 0
  const parsedNow = parseInt((amount || '').replace(/\D/g, ''), 10) || 0
  // Bu to'lovdan keyin qoladigan qarz
  const willRemain = charge ? Math.max(0, charge.remaining - parsedNow) : 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitted) return   // ikki marta bosilishni oldini olish
    const parsedAmount = parseInt(amount.replace(/\D/g, ''), 10)
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error('To\'lov summasini to\'g\'ri kiriting')
      return
    }
    setLoading(true)
    setSubmitted(true)
    try {
      const res = await ekoApi.post('/payments', {
        entityId: entity.id,
        month: selectedMonth,
        amount: parsedAmount,
        note: note.trim() || undefined,
      })
      const d = res.data.data ?? res.data
      if (d?.receiptNumber) {
        setReceiptNumber(d.receiptNumber)
      } else {
        toast.success('To\'lov muvaffaqiyatli qayd etildi!')
        onSuccess()
        onClose()
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'To\'lov qayd etishda xato'
      toast.error(msg)
      setSubmitted(false)   // xato bo'lsa qayta urinish imkonini berish
    } finally {
      setLoading(false)
    }
  }

  // Kvitansiya ko'rsatilmoqda
  if (receiptNumber) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { onSuccess(); onClose() }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-8 text-center space-y-4">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">To'lov qayd etildi!</p>
              <p className="text-sm text-gray-500 mt-1">{entity.name} · {formatMonth(selectedMonth)}</p>
              <p className="text-base font-semibold text-green-700 mt-1">{formatAmount(parseInt(amount.replace(/\D/g, ''), 10) || 0)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-center gap-2 text-gray-500 text-xs mb-2">
                <Receipt className="w-3.5 h-3.5" />
                Kvitansiya raqami
              </div>
              <p className="font-mono font-bold text-xl text-indigo-700 tracking-widest">{receiptNumber}</p>
            </div>
            <button
              onClick={() => { onSuccess(); onClose() }}
              className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              Yopish
            </button>
          </div>
        </div>
      </div>
    )
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
            <label className="block text-sm font-medium text-gray-700 mb-1">To'lov oyi</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => { setSelectedMonth(e.target.value); setSubmitted(false) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">{formatMonth(selectedMonth)}</p>
          </div>

          {/* Qarz holati — qisman to'lov */}
          {chargeLoading ? (
            <div className="flex items-center justify-center py-3 text-gray-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Holat yuklanmoqda...
            </div>
          ) : charge && charge.expectedAmount > 0 && (
            <div className={`rounded-xl p-3 border ${isFullyPaid ? 'bg-green-50 border-green-200' : isPartiallyPaid ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-gray-600">Oylik summa:</span>
                <span className="font-semibold text-gray-800">{formatAmount(charge.expectedAmount)}</span>
              </div>
              {charge.paidAmount > 0 && (
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-600">To'langan:</span>
                  <span className="font-semibold text-green-700">{formatAmount(charge.paidAmount)}</span>
                </div>
              )}
              {/* Progress bar */}
              <div className="w-full bg-gray-200 rounded-full h-2 mb-1.5">
                <div className={`h-2 rounded-full transition-all ${isFullyPaid ? 'bg-green-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, Math.round(charge.paidAmount * 100 / charge.expectedAmount))}%` }} />
              </div>
              {isFullyPaid ? (
                <p className="text-xs text-green-700 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> To'liq to'langan
                </p>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-amber-700 font-semibold">Qolgan qarz: {formatAmount(charge.remaining)}</span>
                  {charge.payments.length > 0 && (
                    <button type="button" onClick={() => setShowHistory(v => !v)}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                      <History className="w-3 h-3" /> {charge.payments.length} to'lov
                    </button>
                  )}
                </div>
              )}
              {/* To'lov tarixi */}
              {showHistory && charge.payments.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
                  {charge.payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-[11px] text-gray-500">
                      <span>{new Date(p.paidAt).toLocaleDateString('uz-UZ')} · {p.receiver || ''}</span>
                      <span className="font-medium text-gray-700">{formatAmount(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Amount — to'liq to'langan bo'lmasa */}
          {!isFullyPaid && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Summa (so'm)</label>
                {charge && charge.remaining > 0 && (
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setAmount(String(charge.remaining))}
                      className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded font-medium hover:bg-green-200">
                      To'liq ({formatAmount(charge.remaining)})
                    </button>
                    <button type="button" onClick={() => setAmount(String(Math.round(charge.remaining / 2)))}
                      className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-medium hover:bg-amber-200">
                      Yarmi
                    </button>
                  </div>
                )}
              </div>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={1}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
              />
              {/* Bu to'lovdan keyin qoladigan qarz */}
              {charge && parsedNow > 0 && parsedNow < charge.remaining && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠️ Qisman to'lov — keyin yana <b>{formatAmount(willRemain)}</b> qarz qoladi
                </p>
              )}
              {charge && parsedNow > charge.remaining && charge.remaining > 0 && (
                <p className="text-xs text-blue-600 mt-1">
                  Qolgan qarzdan {formatAmount(parsedNow - charge.remaining)} ortiq — keyingi oyga o'tkaziladi
                </p>
              )}
            </div>
          )}

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
              {isFullyPaid ? 'Yopish' : 'Bekor qilish'}
            </button>
            {!isFullyPaid && (
              <button
                type="submit"
                disabled={loading || submitted}
                className="flex-1 px-4 py-2.5 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saqlanmoqda...</>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    {charge && parsedNow < charge.remaining ? 'Qisman to\'lash' : 'To\'landi'}
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
