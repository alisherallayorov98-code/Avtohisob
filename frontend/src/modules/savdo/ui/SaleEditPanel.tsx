import { useState, useEffect } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import SearchSelect from './SearchSelect'

// Admin: tasdiqlangan sotuvni qayta ochib tahrirlash. Server eski sarfni teskari
// qaytarib, yangi qatorlarni shu faktura raqami ostida qo'llaydi (bitta tranzaksiya).

interface Props {
  sale: {
    id: string; notes: string | null; vatRate?: string | null; paymentType?: string; dueDate?: string | null
    customer: { id?: string; name: string } | null
    lines: { quantity: number; unitPrice: string; product: { id?: string; name: string; sku: string } & Record<string, any>; productId?: string }[]
  }
  onSaved: () => void
  onClose: () => void
}

interface Line { productId: string; quantity: string; unitPrice: string }
const input = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'

export default function SaleEditPanel({ sale, onSaved, onClose }: Props) {
  const [products, setProducts] = useState<{ id: string; name: string; sku: string }[]>([])
  const [customers, setCustomers] = useState<{ id: string; name: string; phone: string | null }[]>([])
  const [customerId, setCustomerId] = useState(sale.customer?.id ?? '')
  const [notes, setNotes] = useState(sale.notes ?? '')
  const [vatOn, setVatOn] = useState(Boolean(sale.vatRate && Number(sale.vatRate) > 0))
  const [vatRate, setVatRate] = useState(sale.vatRate && Number(sale.vatRate) > 0 ? String(Number(sale.vatRate)) : '12')
  const [lines, setLines] = useState<Line[]>(
    sale.lines.map(l => ({ productId: l.productId ?? l.product.id ?? '', quantity: String(l.quantity), unitPrice: String(Number(l.unitPrice)) })),
  )
  const [paymentType, setPaymentType] = useState<string>(sale.paymentType ?? 'credit')
  const [dueDate, setDueDate] = useState(sale.dueDate ? String(sale.dueDate).slice(0, 10) : '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    savdoApi.get('/products/options').then(r => setProducts(r.data.data ?? [])).catch(() => {})
    savdoApi.get('/customers/options').then(r => setCustomers(r.data.data ?? [])).catch(() => {})
  }, [])

  const upd = (i: number, p: Partial<Line>) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...p } : l))

  async function save() {
    const valid = lines.filter(l => l.productId && Number(l.quantity) > 0)
    if (valid.length === 0) { toast.error('Kamida bitta qator kerak'); return }
    if (reason.trim().length < 5) { toast.error('Tahrirlash sababini yozing (kamida 5 belgi)'); return }
    setSaving(true)
    try {
      await savdoApi.put(`/sales/${sale.id}`, {
        reason: reason.trim(),
        customerId: customerId || null,
        notes: notes.trim() || null,
        vatRate: vatOn ? Number(vatRate) : null,
        paymentType,
        dueDate: paymentType === 'cash' ? null : dueDate || null,
        lines: valid.map(l => ({ productId: l.productId, quantity: Number(l.quantity), unitPrice: l.unitPrice === '' ? null : Number(l.unitPrice) })),
      })
      toast.success('Sotuv yangilandi')
      onSaved()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-4 mb-5 space-y-3">
      <p className="text-sm font-medium text-amber-800">Sotuvni tahrirlash (faqat admin) — qoldiq va tannarx avtomatik qayta hisoblanadi</p>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Tahrirlash sababi (majburiy — audit jurnaliga yoziladi)</label>
        <input className={`${input} w-full`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Masalan: mijoz miqdorni o'zgartirdi" />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mijoz</label>
          <SearchSelect options={customers.map(c => ({ id: c.id, label: c.name, sublabel: c.phone || undefined }))}
            value={customerId} onChange={setCustomerId} placeholder="Ko'chadan mijoz" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Izoh</label>
          <input className={`${input} w-full`} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-medium text-gray-600">To'lov turi</label>
        <select className={input} value={paymentType} onChange={e => setPaymentType(e.target.value)}>
          <option value="cash">Naqd</option><option value="transfer">Perechisleniya</option><option value="credit">Qarzga</option>
        </select>
        {paymentType !== 'cash' && <input type="date" className={input} value={dueDate} onChange={e => setDueDate(e.target.value)} title="To'lov muddati" />}
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2 items-center">
            <SearchSelect className="flex-1" options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))}
              value={l.productId} onChange={id => upd(i, { productId: id })} placeholder="Mahsulot" />
            <input type="number" min="0.001" step="any" className={`${input} w-24`} placeholder="Miqdor" value={l.quantity} onChange={e => upd(i, { quantity: e.target.value })} />
            <input type="number" min="0" step="any" className={`${input} w-32`} placeholder="Narx (QQSsiz)" value={l.unitPrice} onChange={e => upd(i, { unitPrice: e.target.value })} />
            {lines.length > 1 && (
              <button type="button" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setLines(ls => [...ls, { productId: '', quantity: '', unitPrice: '' }])} className="text-sm text-amber-700 font-medium">+ Qator qo'shish</button>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={vatOn} onChange={e => setVatOn(e.target.checked)} className="w-4 h-4 accent-amber-700" /> QQS bilan
        </label>
        {vatOn && <input type="number" min="0" max="100" step="any" className={`${input} w-24`} value={vatRate} onChange={e => setVatRate(e.target.value)} />}
        {vatOn && <span className="text-sm text-gray-500">%</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Bekor</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white font-medium">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Saqlash'}
          </button>
        </div>
      </div>
    </div>
  )
}
