import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, FileText, Loader2, Printer, Check, Pencil, Ban, RotateCcw, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import RowMenu from '../ui/RowMenu'
import SearchSelect from '../ui/SearchSelect'
import { useSavdoAdmin } from '../lib/useSavdoAdmin'
import { openPrint, fmtMoney } from '../lib/docs'
import { formatDate } from '../../../lib/utils'

interface Option { id: string; name: string }
interface ProductOption extends Option { sku: string; wholesalePrice: string; retailPrice: string }
interface CustomerOption extends Option { phone: string | null; priceTier: 'retail' | 'wholesale'; isLegal?: boolean }
interface SpecRow {
  id: string; number: string; status: string; createdAt: string; saleId: string | null
  customer: { id: string; name: string }
  totals: { subtotal: number; vatAmount: number; total: number }
}
interface FormLine { productId: string; quantity: string; unitPrice: string }

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Qoralama', cls: 'bg-gray-100 text-gray-600' },
  confirmed: { label: 'Tasdiqlangan', cls: 'bg-green-50 text-green-700' },
  cancelled: { label: 'Bekor qilingan', cls: 'bg-red-50 text-red-700' },
}
const inp = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'

export default function SpecsPage() {
  const isAdmin = useSavdoAdmin()
  const [rows, setRows] = useState<SpecRow[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [products, setProducts] = useState<ProductOption[]>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [busyId, setBusyId] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [contractNumber, setContractNumber] = useState('')
  const [contractDate, setContractDate] = useState('')
  const [vatOn, setVatOn] = useState(false)
  const [vatRate, setVatRate] = useState('12')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentType, setPaymentType] = useState('transfer')
  const [dueDate, setDueDate] = useState('')
  const [lines, setLines] = useState<FormLine[]>([{ productId: '', quantity: '', unitPrice: '' }])
  const [saving, setSaving] = useState(false)

  const fetchRows = useCallback(() => {
    setLoading(true)
    savdoApi.get('/specs', { params: { page } })
      .then(res => {
        setRows(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Spetsifikatsiyalarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => { fetchRows() }, [fetchRows])
  useEffect(() => {
    savdoApi.get('/products/options').then(r => setProducts(r.data.data ?? [])).catch(() => {})
    savdoApi.get('/customers/options').then(r => setCustomers(r.data.data ?? [])).catch(() => {})
    savdoApi.get('/warehouses/options').then(r => {
      const list = r.data.data ?? []
      setWarehouses(list)
      if (list.length === 1) setWarehouseId(list[0].id)
    }).catch(() => {})
  }, [])

  function reset() {
    setEditingId(null); setCustomerId(''); setContractNumber(''); setContractDate(''); setVatOn(false); setVatRate('12')
    setPaymentTerms(''); setDeliveryTerms(''); setValidUntil(''); setNotes(''); setPaymentType('transfer'); setDueDate('')
    setLines([{ productId: '', quantity: '', unitPrice: '' }])
    setWarehouseId(warehouses.length === 1 ? warehouses[0].id : '')
  }

  // Mijozning narx toifasiga qarab mahsulot narxi avtomatik qo'yiladi (keyin o'zgartirish mumkin)
  function defaultPrice(productId: string, cId = customerId): string {
    const p = products.find(x => x.id === productId)
    if (!p) return ''
    const tier = customers.find(c => c.id === cId)?.priceTier
    return String(Number(tier === 'wholesale' ? p.wholesalePrice : p.retailPrice))
  }

  async function startEdit(id: string) {
    try {
      const s = (await savdoApi.get(`/specs/${id}`)).data.data
      setEditingId(id); setCustomerId(s.customerId); setWarehouseId(s.warehouseId)
      setContractNumber(s.contractNumber ?? ''); setContractDate(s.contractDate ? String(s.contractDate).slice(0, 10) : '')
      setVatOn(s.vatRate != null && Number(s.vatRate) > 0); setVatRate(s.vatRate != null ? String(Number(s.vatRate)) : '12')
      setPaymentTerms(s.paymentTerms ?? ''); setDeliveryTerms(s.deliveryTerms ?? '')
      setValidUntil(s.validUntil ? String(s.validUntil).slice(0, 10) : ''); setNotes(s.notes ?? '')
      setPaymentType(s.paymentType ?? 'transfer'); setDueDate(s.dueDate ? String(s.dueDate).slice(0, 10) : '')
      setLines(s.lines.map((l: any) => ({ productId: l.productId, quantity: String(l.quantity), unitPrice: String(Number(l.unitPrice)) })))
      setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch { toast.error('Yuklab bo\'lmadi') }
  }

  function onCustomerChange(id: string) {
    setCustomerId(id)
    const c = customers.find(x => x.id === id) as any
    if (c && !editingId) {
      // Shartnoma ma'lumoti mijoz kartochkasidan olinadi (bo'lsa)
      savdoApi.get('/customers', { params: { search: c.name } }).then(r => {
        const full = (r.data.data ?? []).find((x: any) => x.id === id)
        if (full?.contractNumber) setContractNumber(full.contractNumber)
        if (full?.contractDate) setContractDate(String(full.contractDate).slice(0, 10))
      }).catch(() => {})
    }
    setLines(ls => ls.map(l => l.productId ? { ...l, unitPrice: defaultPrice(l.productId, id) } : l))
  }

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)
  const vatAmount = vatOn ? Math.round(subtotal * (Number(vatRate) || 0)) / 100 : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!customerId) { toast.error('Mijozni tanlang'); return }
    if (!warehouseId) { toast.error('Omborni tanlang'); return }
    const valid = lines.filter(l => l.productId && Number(l.quantity) > 0)
    if (valid.length === 0) { toast.error('Kamida bitta qator to\'ldiring'); return }
    setSaving(true)
    try {
      const body = {
        customerId, warehouseId, contractNumber: contractNumber.trim() || null, contractDate: contractDate || null,
        vatRate: vatOn ? Number(vatRate) : null, paymentTerms: paymentTerms.trim() || null,
        deliveryTerms: deliveryTerms.trim() || null, paymentType, dueDate: paymentType === 'cash' ? null : dueDate || null, validUntil: validUntil || null, notes: notes.trim() || null,
        lines: valid.map(l => ({ productId: l.productId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) || 0 })),
      }
      if (editingId) await savdoApi.put(`/specs/${editingId}`, body)
      else await savdoApi.post('/specs', body)
      toast.success('Spetsifikatsiya saqlandi')
      reset(); setShowForm(false); fetchRows()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally { setSaving(false) }
  }

  async function act(id: string, action: 'confirm' | 'cancel' | 'reopen', ask: string) {
    if (!window.confirm(ask)) return
    setBusyId(id)
    try {
      const res = await savdoApi.post(`/specs/${id}/${action}`)
      toast.success(res.data.message || 'Bajarildi'); fetchRows()
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
    finally { setBusyId('') }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Spetsifikatsiya</h1>
          <p className="text-sm text-gray-500">Yuridik shaxslarga sotish: shartnoma ilovasi → tasdiqlanganda faktura va ombor sarfi</p>
        </div>
        <button onClick={() => { if (showForm) { setShowForm(false); reset() } else setShowForm(true) }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showForm ? 'Yopish' : 'Yangi spetsifikatsiya'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mb-6 p-4 bg-white border border-gray-200 rounded-xl space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Mijoz (yuridik shaxs)</label>
              <SearchSelect options={customers.map(c => ({ id: c.id, label: c.name, sublabel: c.isLegal ? 'yuridik' : c.phone || undefined }))}
                value={customerId} onChange={onCustomerChange} placeholder="Mijoz tanlang..." /></div>
            {warehouses.length !== 1 && (
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Ombor</label>
                <select className={`${inp} w-full`} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                  <option value="">Tanlang...</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select></div>
            )}
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Shartnoma №</label>
              <input className={`${inp} w-full`} value={contractNumber} onChange={e => setContractNumber(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Shartnoma sanasi</label>
              <input type="date" className={`${inp} w-full`} value={contractDate} onChange={e => setContractDate(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Amal qilish muddati</label>
              <input type="date" className={`${inp} w-full`} value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Qatorlar (narx QQSsiz)</label>
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2 items-center">
                <SearchSelect className="flex-1" options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))} value={l.productId}
                  onChange={id => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, productId: id, unitPrice: x.unitPrice || defaultPrice(id) } : x))} placeholder="Mahsulot..." />
                <input type="number" min="0.001" step="any" placeholder="Miqdor" className={`${inp} w-28`} value={l.quantity}
                  onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} />
                <input type="number" min="0" step="any" placeholder="Narx" className={`${inp} w-32`} value={l.unitPrice}
                  onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, unitPrice: e.target.value } : x))} />
                <div className="w-28 text-right text-sm savdo-num text-gray-600">{fmtMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</div>
                {lines.length > 1 && <button type="button" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
            <button type="button" onClick={() => setLines(ls => [...ls, { productId: '', quantity: '', unitPrice: '' }])} className="text-sm text-amber-700 font-medium">+ Qator qo'shish</button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">To'lov turi / muddati</label>
              <div className="flex gap-2">
                <select className={`${inp} flex-1`} value={paymentType} onChange={e => setPaymentType(e.target.value)}>
                  <option value="transfer">Perechisleniya</option><option value="credit">Qarzga</option><option value="cash">Naqd</option>
                </select>
                {paymentType !== 'cash' && <input type="date" className={inp} value={dueDate} onChange={e => setDueDate(e.target.value)} />}
              </div></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">To'lov shartlari</label>
              <input className={`${inp} w-full`} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} placeholder="Masalan: 50% oldindan, qolgani yetkazilgandan keyin 10 kunda" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Yetkazib berish shartlari</label>
              <input className={`${inp} w-full`} value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Izoh</label>
              <input className={`${inp} w-full`} value={notes} onChange={e => setNotes(e.target.value)} /></div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={vatOn} onChange={e => setVatOn(e.target.checked)} className="w-4 h-4 accent-amber-700" /> QQS bilan
              </label>
              {vatOn && <><input type="number" min="0" max="100" step="any" className={`${inp} w-20`} value={vatRate} onChange={e => setVatRate(e.target.value)} /><span className="text-sm text-gray-500">%</span></>}
              <div className="ml-auto text-sm text-right savdo-num">
                {vatOn && <div className="text-gray-500">QQSsiz {fmtMoney(subtotal)} + QQS {fmtMoney(vatAmount)}</div>}
                <b className="text-amber-800">Jami: {fmtMoney(subtotal + vatAmount)} so'm</b>
              </div>
            </div>
          </div>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? 'Yangilash' : 'Qoralama sifatida saqlash'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400"><FileText className="w-8 h-8 mx-auto mb-2 text-gray-300" />Hali spetsifikatsiya yo'q</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Raqam</th>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Mijoz</th>
                <th className="text-right px-4 py-2.5 font-medium">QQS</th>
                <th className="text-right px-4 py-2.5 font-medium">Jami</th>
                <th className="text-left px-4 py-2.5 font-medium">Holat</th>
                <th className="text-right px-4 py-2.5 font-medium">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(s => (
                <tr key={s.id} className={s.status === 'cancelled' ? 'opacity-50' : ''}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{s.number}</td>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{formatDate(s.createdAt)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{s.customer.name}</td>
                  <td className="px-4 py-2.5 text-right savdo-num text-gray-500">{s.totals.vatAmount ? fmtMoney(s.totals.vatAmount) : '—'}</td>
                  <td className="px-4 py-2.5 text-right savdo-num font-medium">{fmtMoney(s.totals.total)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[s.status]?.cls}`}>{STATUS[s.status]?.label}</span>
                    {s.saleId && <Link to={`/savdo/sales/${s.saleId}`} className="ml-2 text-xs text-amber-700 hover:underline">faktura</Link>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-3">
                      <button title="Chop etish" onClick={() => openPrint(`/specs/${s.id}/print`)} className="text-gray-500 hover:text-gray-700"><Printer className="w-4 h-4" /></button>
                      {s.status === 'draft' && (
                        <>
                          <button title="Tahrirlash" onClick={() => startEdit(s.id)} className="text-amber-700"><Pencil className="w-4 h-4" /></button>
                          <button title="Tasdiqlash" disabled={busyId === s.id} onClick={() => act(s.id, 'confirm', 'Tasdiqlaysizmi? Faktura yaratilib, tovar ombordan chiqariladi.')} className="text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
                          <RowMenu items={[{ label: 'Bekor qilish', icon: <Ban className="w-4 h-4" />, danger: true, disabled: busyId === s.id, onClick: () => act(s.id, 'cancel', 'Qoralamani bekor qilasizmi?') }]} />
                        </>
                      )}
                      {s.status === 'confirmed' && isAdmin && (
                        <RowMenu items={[{
                          label: "Qayta ochish (faktura bekor qilinadi)", icon: <RotateCcw className="w-4 h-4" />, danger: true, disabled: busyId === s.id,
                          onClick: () => act(s.id, 'reopen', "Qayta ochasizmi? Bog'langan faktura bekor qilinadi, tovar omborga qaytadi, spetsifikatsiya qoralamaga o'tadi."),
                        }]} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
    </div>
  )
}
