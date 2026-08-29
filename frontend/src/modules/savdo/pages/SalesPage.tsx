import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Receipt, Loader2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface Option { id: string; name: string }
interface Sale {
  id: string
  documentNumber: string
  totalAmount: string
  createdAt: string
  customer: { id: string; name: string } | null
  warehouse: { id: string; name: string }
  lines: { id: string; quantity: number }[]
}

interface LineForm { productId: string; quantity: string; unitPrice: string }
const EMPTY_LINE: LineForm = { productId: '', quantity: '', unitPrice: '' }

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Option[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [customers, setCustomers] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)

  const fetchSales = useCallback(() => {
    setLoading(true)
    savdoApi.get('/sales')
      .then(res => setSales(res.data.data ?? []))
      .catch(() => toast.error('Sotuvlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchSales()
    savdoApi.get('/products').then(res => setProducts(res.data.data ?? [])).catch(() => {})
    savdoApi.get('/warehouses').then(res => setWarehouses(res.data.data ?? [])).catch(() => {})
    savdoApi.get('/customers').then(res => setCustomers(res.data.data ?? [])).catch(() => {})
  }, [fetchSales])

  function updateLine(i: number, patch: Partial<LineForm>) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function addLine() { setLines(ls => [...ls, { ...EMPTY_LINE }]) }
  function removeLine(i: number) { setLines(ls => ls.filter((_, idx) => idx !== i)) }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!warehouseId) { toast.error('Omborni tanlang'); return }
    const validLines = lines.filter(l => l.productId && Number(l.quantity) > 0)
    if (validLines.length === 0) { toast.error('Kamida bitta qator to\'ldiring'); return }

    setSaving(true)
    try {
      const res = await savdoApi.post('/sales', {
        warehouseId,
        customerId: customerId || null,
        lines: validLines.map(l => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice ? Number(l.unitPrice) : null,
        })),
      })
      toast.success(res.data.message || 'Faktura yaratildi')
      setWarehouseId(''); setCustomerId(''); setLines([{ ...EMPTY_LINE }]); setShowForm(false)
      fetchSales()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Savdo / Faktura</h1>
          <p className="text-sm text-gray-500">Mijozga sotish — narx va tannarx avtomatik hisoblanadi</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Yangi sotuv
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ombor</label>
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                <option value="">Tanlang...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Mijoz (ixtiyoriy)</label>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                <option value="">—</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Qatorlar</label>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={line.productId} onChange={e => updateLine(i, { productId: e.target.value })} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  <option value="">Mahsulot...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" min="1" placeholder="Miqdor" value={line.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
                <input type="number" min="0" placeholder="Narx (avto)" value={line.unitPrice} onChange={e => updateLine(i, { unitPrice: e.target.value })} className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(i)} className="p-2 text-gray-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addLine} className="text-sm text-amber-700 hover:text-amber-800 font-medium">
              + Qator qo'shish
            </button>
          </div>

          <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sotuvni yakunlash'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : sales.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <Receipt className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali sotuv qayd etilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Faktura</th>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Mijoz</th>
                <th className="text-left px-4 py-2.5 font-medium">Ombor</th>
                <th className="text-right px-4 py-2.5 font-medium">Summa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sales.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">
                    <Link to={`/savdo/sales/${s.id}`} className="text-amber-700 hover:underline">{s.documentNumber}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{new Date(s.createdAt).toLocaleDateString('uz-UZ')}</td>
                  <td className="px-4 py-2.5 text-gray-600">{s.customer?.name || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{s.warehouse.name}</td>
                  <td className="px-4 py-2.5 text-right savdo-num font-medium">{Number(s.totalAmount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
