import { useState, useEffect } from 'react'
import { X, Loader2, CheckCircle2, Receipt, History, Printer, ArrowDownToLine } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { date as fmtDate } from '../ui/format'
import { MonthInput, useConfirm } from '../ui'

interface ChargeStatus {
  expectedAmount: number
  paidAmount: number
  remaining: number
  status: string
  billingMode: string
  payments: Array<{ id: string; amount: number; paidAt: string; note?: string; receiver?: string }>
  /** Tanlangan oydan boshqa ochiq qarz oylari — ortiqcha summa shularga o'tadi */
  openDebts?: Array<{ month: string; debt: number }>
}

interface Allocation { month: string; amount: number }

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

/**
 * To'lovning oylar bo'yicha taqsimotini OLDINDAN ko'rsatadi (backend'dagi
 * `paymentAllocation.allocatePayment` bilan bir xil qoida): avval tanlangan oy,
 * so'ng eng eski qarz, oxirida avans. Bu faqat ko'rsatish uchun — haqiqiy
 * taqsimotni backend qaytaradi.
 */
function previewAllocation(
  amount: number,
  selectedMonth: string,
  selectedRemaining: number,
  openDebts: Array<{ month: string; debt: number }>,
): Allocation[] {
  let left = amount
  const out: Allocation[] = []
  const add = (month: string, value: number) => {
    if (value <= 0) return
    const found = out.find(a => a.month === month)
    if (found) found.amount += value
    else out.push({ month, amount: value })
  }

  const toSelected = Math.min(left, Math.max(0, selectedRemaining))
  add(selectedMonth, toSelected)
  left -= toSelected

  for (const d of [...openDebts].sort((a, b) => a.month.localeCompare(b.month))) {
    if (left <= 0) break
    const take = Math.min(left, d.debt)
    add(d.month, take)
    left -= take
  }
  if (left > 0) add(selectedMonth, left)
  return out
}

export default function PaymentModal({ entity, onClose, onSuccess }: PaymentModalProps) {
  const confirm = useConfirm()
  const unpaidMonths = entity.unpaidMonths ?? [currentMonth()]
  const [selectedMonth, setSelectedMonth] = useState<string>(unpaidMonths[0] ?? currentMonth())
  const [amount, setAmount] = useState<string>(String(entity.monthlyFee))
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)

  /**
   * Kvitansiyani yangi oynada ochadi (A5, chop etishga tayyor).
   * `window.open` to'g'ridan ishlamaydi — sahifa autentifikatsiya talab qiladi,
   * shuning uchun HTML token bilan olinadi va blob sifatida ochiladi.
   */
  async function openReceiptPrint(id: string) {
    setPrinting(true)
    try {
      const res = await ekoApi.get(`/receipts/${id}/print`, { responseType: 'text' })
      const blob = new Blob([res.data], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const w = window.open(url, '_blank')
      if (!w) toast.error('Brauzer yangi oynani bloklab qo\'ydi — ruxsat bering')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      toast.error('Kvitansiyani ochishda xato')
    } finally { setPrinting(false) }
  }
  const [charge, setCharge] = useState<ChargeStatus | null>(null)
  const [chargeLoading, setChargeLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // Backend qaytargan haqiqiy taqsimot — kvitansiya ekranida ko'rsatiladi
  const [allocations, setAllocations] = useState<Allocation[]>([])

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
  // Ortiqcha summa qaysi eski oylarga o'tishi — to'lovdan OLDIN ko'rsatiladi
  const openDebts = charge?.openDebts ?? []
  const plannedAllocations = previewAllocation(
    parsedNow, selectedMonth, charge?.remaining ?? 0, openDebts,
  )
  const olderCovered = plannedAllocations.filter(a => a.month !== selectedMonth)
  const advance = Math.max(
    0,
    parsedNow - (charge?.remaining ?? 0) - olderCovered.reduce((s, a) => s + a.amount, 0),
  )

  /** To'lovni yuborish. `force` — takroriy to'lov ogohlantirishidan keyin. */
  async function submitPayment(parsedAmount: number, force: boolean): Promise<void> {
    setLoading(true)
    setSubmitted(true)
    try {
      const res = await ekoApi.post('/payments', {
        entityId: entity.id,
        month: selectedMonth,
        amount: parsedAmount,
        note: note.trim() || undefined,
        ...(force ? { force: true } : {}),
      })
      const d = res.data.data ?? res.data
      setAllocations(Array.isArray(d?.allocations) ? d.allocations : [])
      if (d?.receiptNumber) {
        setReceiptNumber(d.receiptNumber)
        setReceiptId(d.receiptId ?? null)
      } else {
        toast.success('To\'lov muvaffaqiyatli qayd etildi!')
        onSuccess()
        onClose()
      }
    } catch (err: unknown) {
      const response = (err as {
        response?: {
          status?: number
          data?: { error?: string; code?: string; data?: { paidAt?: string; receiptNumber?: string | null } }
        }
      })?.response

      // Takroriy to'lov — backend yaratmadi, foydalanuvchi qaror qiladi
      if (response?.status === 409 && response.data?.code === 'DUPLICATE_PAYMENT') {
        const prev = response.data.data
        setSubmitted(false)
        setLoading(false)
        const again = await confirm({
          title: 'Bu to\'lov allaqachon qayd etilganga o\'xshaydi',
          message: (
            <>
              <b>{entity.name}</b> uchun <b>{formatMonth(selectedMonth)}</b> oyiga
              aynan <b>{formatAmount(parsedAmount)}</b> summa
              {prev?.paidAt ? ` ${fmtDate(prev.paidAt)} kuni` : ''} bir necha daqiqa oldin yozilgan
              {prev?.receiptNumber ? ` (kvitansiya ${prev.receiptNumber})` : ''}.
            </>
          ),
          consequences: [
            'Agar tugma ikki marta bosilgan bo\'lsa — "Bekor qilish"ni tanlang.',
            'Haqiqatan ikkinchi to\'lov bo\'lsa, yangi kvitansiya bilan qayd etiladi.',
          ],
          confirmLabel: 'Ha, bu boshqa to\'lov',
        })
        if (again) await submitPayment(parsedAmount, true)
        return
      }

      toast.error(response?.data?.error || 'To\'lov qayd etishda xato')
      setSubmitted(false)   // xato bo'lsa qayta urinish imkonini berish
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitted || loading) return   // ikki marta bosilishni oldini olish
    const parsedAmount = parseInt(amount.replace(/\D/g, ''), 10)
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error('To\'lov summasini to\'g\'ri kiriting')
      return
    }

    // Tasdiqlash qadami. Nega kerak: ro'yxatdagi tugma bir bosishda shu oynani
    // ochadi, oynadagi tugma esa darhol REAL to'lovni va kvitansiyani yozardi —
    // tasodifan bosilgan ikki bosish naqd pulni qayd etib yuborardi. Bekor
    // qilishni faqat admin qila oladi.
    const ok = await confirm({
      title: 'To\'lovni qayd etish',
      message: (
        <>
          <b>{entity.name}</b> — <b>{formatMonth(selectedMonth)}</b> uchun
          {' '}<b>{formatAmount(parsedAmount)}</b> qabul qilindi.
        </>
      ),
      consequences: [
        ...(plannedAllocations.length > 1
          ? plannedAllocations.map(a => `${formatMonth(a.month)}: ${formatAmount(a.amount)}`)
          : []),
        ...(willRemain > 0 && parsedNow < (charge?.remaining ?? 0)
          ? [`Qisman to'lov — ${formatAmount(willRemain)} qarz qoladi`]
          : []),
        'Kvitansiya raqami beriladi; bekor qilishni faqat admin bajara oladi.',
      ],
      confirmLabel: 'Ha, qayd etilsin',
    })
    if (!ok) return

    await submitPayment(parsedAmount, false)
  }

  // Kvitansiya ko'rsatilmoqda
  if (receiptNumber) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { onSuccess(); onClose() }}>
        <div className="bg-eko-surface rounded-eko-lg shadow-eko-lg w-full max-w-sm" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-8 text-center space-y-4">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">To'lov qayd etildi!</p>
              <p className="text-sm text-gray-500 mt-1">{entity.name} · {formatMonth(selectedMonth)}</p>
              <p className="text-base font-semibold text-green-700 mt-1">{formatAmount(parseInt(amount.replace(/\D/g, ''), 10) || 0)}</p>
            </div>
            <div className="bg-gray-50 border border-eko-line rounded-xl p-4">
              <div className="flex items-center justify-center gap-2 text-gray-500 text-xs mb-2">
                <Receipt className="w-3.5 h-3.5" />
                Kvitansiya raqami
              </div>
              <p className="font-mono font-bold text-xl text-indigo-700 tracking-widest">{receiptNumber}</p>
            </div>

            {/* Bir necha oyga taqsimlangan bo'lsa — pul qayerga ketgani ko'rsatiladi */}
            {allocations.length > 1 && (
              <div className="text-left border border-eko-line rounded-xl p-3">
                <p className="text-xs font-medium text-gray-600 mb-1.5">Oylar bo'yicha taqsimot</p>
                <div className="space-y-0.5">
                  {allocations.map(a => (
                    <div key={a.month} className="flex justify-between text-xs text-gray-600">
                      <span>{formatMonth(a.month)}</span>
                      <span className="font-semibold text-gray-800">{formatAmount(a.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              {receiptId && (
                <button
                  onClick={() => openReceiptPrint(receiptId)}
                  disabled={printing}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-eko-line hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  Chop etish
                </button>
              )}
              <button
                onClick={() => { onSuccess(); onClose() }}
                className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-eko-surface rounded-eko-lg shadow-eko-lg w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-eko-line">
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
        <div className="px-6 py-4 bg-gray-50 border-b border-eko-line">
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
                        : 'bg-white text-gray-600 border-eko-line hover:border-green-400 hover:text-green-700'
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
            <MonthInput
              value={selectedMonth}
              onChange={(v) => { setSelectedMonth(v); setSubmitted(false) }}
            />
          </div>

          {/* Qarz holati — qisman to'lov */}
          {chargeLoading ? (
            <div className="flex items-center justify-center py-3 text-gray-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Holat yuklanmoqda...
            </div>
          ) : charge && charge.expectedAmount > 0 && (
            <div className={`rounded-xl p-3 border ${isFullyPaid ? 'bg-green-50 border-green-200' : isPartiallyPaid ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-eko-line'}`}>
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
                <div className="mt-2 pt-2 border-t border-eko-line space-y-1">
                  {charge.payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-[11px] text-gray-500">
                      <span>{fmtDate(p.paidAt)} · {p.receiver || ''}</span>
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
              {/* Ortiqcha summa — qayerga ketishi ANIQ ko'rsatiladi.
                  Ilgari "keyingi oyga o'tkaziladi" deb yozilardi, aslida esa
                  ortiqcha shu oyning hisobida qolib ketardi. */}
              {olderCovered.length > 0 && (
                <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5">
                  <p className="text-xs font-medium text-blue-800 flex items-center gap-1.5">
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    Ortiqcha summa eski qarzni yopadi
                  </p>
                  <div className="mt-1.5 space-y-0.5">
                    {olderCovered.map(a => (
                      <div key={a.month} className="flex justify-between text-[11px] text-blue-700">
                        <span>{formatMonth(a.month)}</span>
                        <span className="font-semibold">{formatAmount(a.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {advance > 0 && (
                <p className="text-xs text-blue-600 mt-1">
                  Barcha qarz yopiladi, {formatAmount(advance)} avans sifatida {formatMonth(selectedMonth)} hisobida qoladi
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
                    {charge && parsedNow < charge.remaining ? 'Qisman to\'lash' : 'Qayd etish'}
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
