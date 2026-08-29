import { useState, useEffect, useCallback } from 'react'
import { Plus, Wallet, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface Option { id: string; name: string }
interface Payment {
  id: string
  amount: string
  method: string
  paidAt: string
  customer: { id: string; name: string }
  sale: { id: string; documentNumber: string } | null
}
interface OpenSale {
  id: string
  documentNumber: string
  balance: number
}
interface DebtInfo {
  totalDebt: number
  advanceCredit: number
  sales: OpenSale[]
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [customers, setCustomers] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [debtInfo, setDebtInfo] = useState<DebtInfo | null>(null)
  const [saleId, setSaleId] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchPayments = useCallback(() => {
    setLoading(true)
    savdoApi.get('/payments')
      .then(res => setPayments(res.data.data ?? []))
      .catch(() => toast.error('To\'lovlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchPayments()
    savdoApi.get('/customers').then(res => setCustomers(res.data.data ?? [])).catch(() => {})
  }, [fetchPayments])

  useEffect(() => {
    if (!customerId) { setDebtInfo(null); setSaleId(''); return }
    savdoApi.get(`/payments/customer/${customerId}/debt`)
      .then(res => setDebtInfo(res.data.data))
      .catch(() => toast.error('Qarzni yuklab bo\'lmadi'))
  }, [customerId])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!customerId) { toast.error('Mijozni tanlang'); return }
    if (!amount || Number(amount) <= 0) { toast.error('Summani kiriting'); return }
    setSaving(true)
    try {
      await submitPayment(false)
      toast.success('To\'lov qayd etildi')
      setCustomerId(''); setSaleId(''); setAmount(''); setShowForm(false)
      fetchPayments()
    } catch (err: any) {
      const status = err?.response?.status
      const message = err?.response?.data?.error || 'Xato yuz berdi'
      // Takroriy to'lov qorovuli (409) — foydalanuvchi tasdiqlasa force bilan qayta yuboriladi
      if (status === 409 && message.includes('bir necha daqiqa oldin')) {
        if (window.confirm(`${message}\n\nBaribir qayd etaymi?`)) {
          try {
            await submitPayment(true)
            toast.success('To\'lov qayd etildi')
            setCustomerId(''); setSaleId(''); setAmount(''); setShowForm(false)
            fetchPayments()
          } catch (err2: any) {
            toast.error(err2?.response?.data?.error || 'Xato yuz berdi')
          }
        }
      } else {
        toast.error(message)
      }
    } finally {
      setSaving(false)
    }
  }

  function submitPayment(force: boolean) {
    return savdoApi.post('/payments', {
      customerId,
      amount: Number(amount),
      saleId: saleId || null,
      force,
    })
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">To'lov / Qarz</h1>
          <p className="text-sm text-gray-500">Mijozdan to'lov qabul qilish — eng eski fakturadan boshlab yopiladi</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> To'lov qabul qilish
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Mijoz</label>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                <option value="">Tanlang...</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Summa</label>
              <input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
            </div>
          </div>

          {debtInfo && (
            <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-amber-800">Joriy qarz: <b>{debtInfo.totalDebt.toLocaleString()}</b> so'm</p>
              {debtInfo.sales.filter(s => s.balance > 0).length > 0 && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Qaysi fakturaga yo'naltirilsin (ixtiyoriy — bo'sh qoldirilsa eng eskidan boshlanadi)</label>
                  <select value={saleId} onChange={e => setSaleId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                    <option value="">Avtomatik (eng eski)</option>
                    {debtInfo.sales.filter(s => s.balance > 0).map(s => (
                      <option key={s.id} value={s.id}>{s.documentNumber} — {s.balance.toLocaleString()} so'm</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Saqlash'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : payments.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <Wallet className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali to'lov qayd etilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Mijoz</th>
                <th className="text-left px-4 py-2.5 font-medium">Faktura</th>
                <th className="text-right px-4 py-2.5 font-medium">Summa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payments.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{new Date(p.paidAt).toLocaleDateString('uz-UZ')}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{p.customer.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{p.sale?.documentNumber || <span className="text-amber-600">Avans</span>}</td>
                  <td className="px-4 py-2.5 text-right savdo-num font-medium">{Number(p.amount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
