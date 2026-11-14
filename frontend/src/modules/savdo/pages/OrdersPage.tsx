import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, ClipboardList, Loader2, Printer, Pencil, Ban, Trash2, X, PackageCheck, Play, ShoppingCart, RotateCcw, AlertTriangle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import RowMenu from '../ui/RowMenu'
import SearchSelect from '../ui/SearchSelect'
import { openPrint, fmtMoney } from '../lib/docs'
import { formatDate } from '../../../lib/utils'

interface Option { id: string; name: string }
interface ProductOption extends Option { sku: string; wholesalePrice: string; retailPrice: string }
interface CustomerOption extends Option { phone: string | null; priceTier: 'retail' | 'wholesale'; isLegal?: boolean }
interface OrderLine {
  id: string; productId: string; quantity: number; unitPrice: string | null; pickedQty: number | null
  product: { name: string; sku: string; unit: string } | null
  price: number; stock: number; lineTotal: number
}
interface OrderRow {
  id: string; number: string; status: string; createdAt: string; deliverAt: string | null; saleId: string | null
  customerId: string | null; warehouseId: string; paymentType: string; dueDate: string | null; vatRate: string | null; notes: string | null
  customer: { id: string; name: string; phone: string | null } | null
  warehouse: { name: string } | null
  lines: OrderLine[]
  estimatedTotal: number; shortLines: number
}
interface FormLine { productId: string; quantity: string; unitPrice: string }

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'Yangi', cls: 'bg-blue-50 text-blue-700' },
  picking: { label: "Yig'ilmoqda", cls: 'bg-amber-50 text-amber-800' },
  picked: { label: "Yig'ildi", cls: 'bg-teal-50 text-teal-700' },
  selling: { label: 'Sotilmoqda…', cls: 'bg-gray-100 text-gray-600' },
  sold: { label: 'Sotildi', cls: 'bg-green-50 text-green-700' },
  cancelled: { label: 'Bekor qilingan', cls: 'bg-red-50 text-red-700' },
}
const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'active', label: 'Faol', statuses: ['new', 'picking', 'picked'] },
  { key: 'new', label: 'Yangi', statuses: ['new'] },
  { key: 'picking', label: "Yig'ilmoqda", statuses: ['picking'] },
  { key: 'picked', label: "Yig'ildi", statuses: ['picked'] },
  { key: 'sold', label: 'Sotilgan', statuses: ['sold'] },
  { key: 'cancelled', label: 'Bekor', statuses: ['cancelled'] },
]
const PAY: Record<string, string> = { cash: 'Naqd', transfer: 'Perechisleniya', credit: 'Qarzga' }
const inp = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'
const EMPTY_LINE: FormLine = { productId: '', quantity: '', unitPrice: '' }

export default function OrdersPage() {
  const [tab, setTab] = useState('active')
  const [rows, setRows] = useState<OrderRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [products, setProducts] = useState<ProductOption[]>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [busyId, setBusyId] = useState('')

  // Forma
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [paymentType, setPaymentType] = useState('credit')
  const [dueDate, setDueDate] = useState('')
  const [deliverAt, setDeliverAt] = useState('')
  const [notes, setNotes] = useState('')
  const [vatOn, setVatOn] = useState(false)
  const [vatRate, setVatRate] = useState('12')
  const [lines, setLines] = useState<FormLine[]>([EMPTY_LINE])
  const [saving, setSaving] = useState(false)

  // Yig'ish paneli
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({})

  const fetchRows = useCallback(() => {
    setLoading(true)
    savdoApi.get('/orders', { params: { page, status: tab } })
      .then(res => {
        setRows(res.data.data ?? [])
        setCounts(res.data.statusCounts ?? {})
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error("Zakazlarni yuklab bo'lmadi"))
      .finally(() => setLoading(false))
  }, [page, tab])

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
    setEditingId(null); setCustomerId(''); setPaymentType('credit'); setDueDate(''); setDeliverAt(''); setNotes('')
    setVatOn(false); setVatRate('12'); setLines([EMPTY_LINE])
    setWarehouseId(warehouses.length === 1 ? warehouses[0].id : '')
  }

  function defaultPrice(productId: string, cId = customerId): string {
    const p = products.find(x => x.id === productId)
    if (!p) return ''
    const tier = customers.find(c => c.id === cId)?.priceTier
    return String(Number(tier === 'wholesale' ? p.wholesalePrice : p.retailPrice))
  }

  function onCustomerChange(id: string) {
    setCustomerId(id)
    if (!id && paymentType === 'credit') setPaymentType('cash')
    setLines(ls => ls.map(l => l.productId ? { ...l, unitPrice: defaultPrice(l.productId, id) } : l))
  }

  function startEdit(o: OrderRow) {
    setEditingId(o.id); setCustomerId(o.customerId ?? ''); setWarehouseId(o.warehouseId)
    setPaymentType(o.paymentType); setDueDate(o.dueDate ? String(o.dueDate).slice(0, 10) : '')
    setDeliverAt(o.deliverAt ? String(o.deliverAt).slice(0, 10) : ''); setNotes(o.notes ?? '')
    setVatOn(o.vatRate != null && Number(o.vatRate) > 0); setVatRate(o.vatRate != null ? String(Number(o.vatRate)) : '12')
    setLines(o.lines.map(l => ({ productId: l.productId, quantity: String(l.quantity), unitPrice: String(l.price) })))
    setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)
  const vatAmount = vatOn ? Math.round(subtotal * (Number(vatRate) || 0)) / 100 : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!warehouseId) { toast.error('Omborni tanlang'); return }
    const valid = lines.filter(l => l.productId && Number(l.quantity) > 0)
    if (valid.length === 0) { toast.error("Kamida bitta qator to'ldiring"); return }
    setSaving(true)
    try {
      const body = {
        customerId: customerId || null, warehouseId, paymentType,
        dueDate: paymentType === 'cash' ? null : dueDate || null, deliverAt: deliverAt || null,
        notes: notes.trim() || null, vatRate: vatOn ? Number(vatRate) : null,
        lines: valid.map(l => ({ productId: l.productId, quantity: Number(l.quantity), unitPrice: l.unitPrice === '' ? null : Number(l.unitPrice) })),
      }
      const res = editingId ? await savdoApi.put(`/orders/${editingId}`, body) : await savdoApi.post('/orders', body)
      toast.success(res.data.message || 'Saqlandi')
      reset(); setShowForm(false); fetchRows()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally { setSaving(false) }
  }

  async function act(id: string, action: string, ask?: string, body?: any) {
    if (ask && !window.confirm(ask)) return
    setBusyId(id)
    try {
      const res = await savdoApi.post(`/orders/${id}/${action}`, body ?? {})
      toast.success(res.data.message || 'Bajarildi')
      if (action === 'picked') setPickingId(null)
      fetchRows()
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
    finally { setBusyId('') }
  }

  function openPicking(o: OrderRow) {
    if (pickingId === o.id) { setPickingId(null); return }
    // Standart: zakaz miqdori, lekin ombordagi qoldiqdan oshmasin
    setPicked(Object.fromEntries(o.lines.map(l => [l.id, String(l.pickedQty ?? Math.max(0, Math.min(l.quantity, l.stock)))])))
    setPickingId(o.id)
  }

  function submitPicked(o: OrderRow) {
    const payload = o.lines.map(l => ({ id: l.id, pickedQty: Number(picked[l.id]) || 0 }))
    const shortCount = o.lines.filter(l => (Number(picked[l.id]) || 0) < l.quantity).length
    act(o.id, 'picked', shortCount ? `${shortCount} ta qator to'liq yig'ilmadi. Shu miqdorlar bilan "Yig'ildi" deb belgilaysizmi?` : undefined, { lines: payload })
  }

  const tabCount = (t: typeof TABS[number]) => t.statuses.reduce((s, st) => s + (counts[st] ?? 0), 0)

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Zakazlar</h1>
          <p className="text-sm text-gray-500">Zakaz qabul qilish → ombordan yig'ish → bir tugma bilan faktura (yuridik mijozga spetsifikatsiya ham)</p>
        </div>
        <button onClick={() => { if (showForm) { setShowForm(false); reset() } else setShowForm(true) }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showForm ? 'Yopish' : 'Yangi zakaz'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mb-6 p-4 bg-white border border-gray-200 rounded-xl space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Mijoz</label>
              <SearchSelect options={[{ id: '', label: '— Mijozsiz —' }, ...customers.map(c => ({ id: c.id, label: c.name, sublabel: c.isLegal ? 'yuridik' : c.phone || undefined }))]}
                value={customerId} onChange={onCustomerChange} placeholder="Mijoz tanlang..." /></div>
            {warehouses.length !== 1 && (
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Ombor</label>
                <select className={`${inp} w-full`} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                  <option value="">Tanlang...</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select></div>
            )}
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Yetkazish sanasi</label>
              <input type="date" className={`${inp} w-full`} value={deliverAt} onChange={e => setDeliverAt(e.target.value)} /></div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Mahsulotlar (narx QQSsiz; bo'sh qoldirilsa mijoz toifasidan)</label>
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
            <button type="button" onClick={() => setLines(ls => [...ls, EMPTY_LINE])} className="text-sm text-amber-700 font-medium">+ Qator qo'shish</button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">To'lov turi / muddati</label>
              <div className="flex gap-2">
                <select className={`${inp} flex-1`} value={paymentType} onChange={e => setPaymentType(e.target.value)}>
                  <option value="cash">Naqd</option><option value="transfer">Perechisleniya</option>
                  {customerId && <option value="credit">Qarzga</option>}
                </select>
                {paymentType !== 'cash' && <input type="date" className={inp} value={dueDate} onChange={e => setDueDate(e.target.value)} title="To'lov muddati" />}
              </div></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Izoh</label>
              <input className={`${inp} w-full`} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Masalan: manzil, aloqa, qadoqlash" /></div>
            <div className="flex items-center gap-3 flex-wrap sm:col-span-2">
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
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? 'Yangilash' : 'Zakazni qabul qilish'}
          </button>
        </form>
      )}

      <div className="flex gap-1 mb-4 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1); setPickingId(null) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-amber-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}{tabCount(t) > 0 && <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-amber-100' : 'text-gray-400'}`}>{tabCount(t)}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400"><ClipboardList className="w-8 h-8 mx-auto mb-2 text-gray-300" />Zakaz yo'q</div>
      ) : (
        <div className="space-y-3">
          {rows.map(o => {
            const st = STATUS[o.status] ?? { label: o.status, cls: 'bg-gray-100 text-gray-600' }
            const busy = busyId === o.id
            const editable = o.status === 'new' || o.status === 'picking'
            return (
              <div key={o.id} className={`bg-white border border-gray-200 rounded-xl ${o.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <div className="p-4 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{o.number}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      {o.saleId && <Link to={`/savdo/sales/${o.saleId}`} className="text-xs text-amber-700 hover:underline">faktura →</Link>}
                      {editable && o.shortLines > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="w-3.5 h-3.5" /> {o.shortLines} ta mahsulot omborda yetarli emas</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatDate(o.createdAt)} · {o.customer?.name || 'Mijozsiz'}{o.warehouse && ` · ${o.warehouse.name}`} · {PAY[o.paymentType] ?? o.paymentType}
                      {o.deliverAt && <> · <b className="text-gray-700">yetkazish {formatDate(o.deliverAt)}</b></>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {o.lines.map(l => `${l.product?.name ?? '?'} × ${l.pickedQty ?? l.quantity}`).join(', ')}
                    </p>
                    {o.notes && <p className="text-xs text-gray-500 mt-0.5">Izoh: {o.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-right mr-2">
                      <p className="text-xs text-gray-400">Taxminiy summa</p>
                      <p className="font-semibold text-gray-800 savdo-num">{fmtMoney(o.estimatedTotal)}</p>
                    </div>
                    <button title="Yig'ish varaqasini chop etish" onClick={() => openPrint(`/orders/${o.id}/print`)} className="p-2 text-gray-500 hover:text-gray-700"><Printer className="w-4 h-4" /></button>
                    {o.status === 'new' && (
                      <button disabled={busy} onClick={() => act(o.id, 'start')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 text-sm font-medium">
                        <Play className="w-4 h-4" /> Yig'ishni boshlash
                      </button>
                    )}
                    {o.status === 'picking' && (
                      <button disabled={busy} onClick={() => openPicking(o)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium">
                        <PackageCheck className="w-4 h-4" /> {pickingId === o.id ? 'Yopish' : "Yig'ildi deb belgilash"}
                      </button>
                    )}
                    {o.status === 'picked' && (
                      <button disabled={busy} onClick={() => act(o.id, 'sell', `Faktura yaratilsinmi? Tovar ombordan chiqariladi (${fmtMoney(o.estimatedTotal)} so'm).`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />} Sotuvga aylantirish
                      </button>
                    )}
                    {['new', 'picking', 'picked'].includes(o.status) && (
                      <RowMenu items={[
                        { label: 'Tahrirlash', icon: <Pencil className="w-4 h-4" />, hidden: !editable, onClick: () => startEdit(o) },
                        { label: "Qayta yig'ishga qaytarish", icon: <RotateCcw className="w-4 h-4" />, hidden: o.status !== 'picked', disabled: busy, onClick: () => act(o.id, 'repick') },
                        { label: 'Bekor qilish', icon: <Ban className="w-4 h-4" />, danger: true, disabled: busy, onClick: () => act(o.id, 'cancel', `${o.number} zakazini bekor qilasizmi?`) },
                      ]} />
                    )}
                  </div>
                </div>

                {pickingId === o.id && (
                  <div className="border-t border-gray-100 p-4 bg-teal-50/40">
                    <p className="text-sm font-medium text-gray-700 mb-2">Haqiqatda yig'ilgan miqdorni kiriting (topilmagan bo'lsa 0)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500 uppercase">
                          <tr>
                            <th className="text-left py-1.5 font-medium">Mahsulot</th>
                            <th className="text-right py-1.5 font-medium">Kerak</th>
                            <th className="text-right py-1.5 font-medium">Omborda</th>
                            <th className="text-right py-1.5 font-medium w-36">Yig'ildi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {o.lines.map(l => {
                            const v = Number(picked[l.id]) || 0
                            return (
                              <tr key={l.id}>
                                <td className="py-1.5 text-gray-800">{l.product?.name} <span className="text-xs text-gray-400">({l.product?.sku})</span></td>
                                <td className="py-1.5 text-right savdo-num">{l.quantity} {l.product?.unit}</td>
                                <td className={`py-1.5 text-right savdo-num ${l.stock < l.quantity ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{l.stock}</td>
                                <td className="py-1.5 text-right">
                                  <input type="number" min="0" step="any" value={picked[l.id] ?? ''}
                                    onChange={e => setPicked(p => ({ ...p, [l.id]: e.target.value }))}
                                    className={`${inp} w-32 text-right ${v < l.quantity ? 'border-amber-400' : ''}`} />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      <button onClick={() => setPickingId(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">Bekor</button>
                      <button disabled={busy} onClick={() => submitPicked(o)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-medium">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />} Yig'ildi
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
    </div>
  )
}
