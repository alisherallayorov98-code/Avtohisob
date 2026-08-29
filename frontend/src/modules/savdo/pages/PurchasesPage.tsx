import { useState, useEffect, useCallback } from 'react'
import { Plus, PackagePlus, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface Option { id: string; name: string }
interface Purchase {
  id: string
  quantity: number
  unitCost: string
  isOfficial: boolean
  invoiceNumber: string | null
  createdAt: string
  product: { name: string; sku: string; unit: string }
  warehouse: { name: string }
  supplier: { name: string } | null
}

const EMPTY = {
  productId: '', warehouseId: '', supplierId: '',
  quantity: '', unitCost: '', invoiceNumber: '', isOfficial: true, notes: '',
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [products, setProducts] = useState<Option[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [suppliers, setSuppliers] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const fetchPurchases = useCallback(() => {
    setLoading(true)
    savdoApi.get('/purchases')
      .then(res => setPurchases(res.data.data ?? []))
      .catch(() => toast.error('Kirimlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchPurchases()
    savdoApi.get('/products').then(res => setProducts(res.data.data ?? [])).catch(() => {})
    savdoApi.get('/warehouses').then(res => setWarehouses(res.data.data ?? [])).catch(() => {})
    savdoApi.get('/suppliers').then(res => setSuppliers(res.data.data ?? [])).catch(() => {})
  }, [fetchPurchases])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.productId || !form.warehouseId) { toast.error('Mahsulot va omborni tanlang'); return }
    if (!form.quantity || Number(form.quantity) <= 0) { toast.error('Miqdorni kiriting'); return }
    setSaving(true)
    try {
      await savdoApi.post('/purchases', {
        productId: form.productId,
        warehouseId: form.warehouseId,
        supplierId: form.supplierId || null,
        quantity: Number(form.quantity),
        unitCost: Number(form.unitCost) || 0,
        invoiceNumber: form.invoiceNumber.trim() || null,
        isOfficial: form.isOfficial,
        notes: form.notes.trim() || null,
      })
      toast.success('Kirim qayd etildi')
      setForm(EMPTY); setShowForm(false)
      fetchPurchases()
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
          <h1 className="text-lg font-semibold text-gray-800">Kirim (xarid)</h1>
          <p className="text-sm text-gray-500">Omborga mahsulot kirimi</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Kirim qo'shish
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Mahsulot</label>
            <select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="">Tanlang...</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ombor</label>
            <select value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="">Tanlang...</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Yetkazib beruvchi (ixtiyoriy)</label>
            <select value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="">—</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Miqdor</label>
            <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Birlik narxi (tannarx)</label>
            <input type="number" min="0" value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Faktura raqami (ixtiyoriy)</label>
            <input value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isOfficial" checked={form.isOfficial} onChange={e => setForm(f => ({ ...f, isOfficial: e.target.checked }))} className="w-4 h-4 accent-amber-700" />
            <label htmlFor="isOfficial" className="text-sm text-gray-700">Rasmiy (fakturali)</label>
          </div>
          <div className="col-span-full">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Saqlash'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : purchases.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <PackagePlus className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali kirim qayd etilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Mahsulot</th>
                <th className="text-left px-4 py-2.5 font-medium">Ombor</th>
                <th className="text-left px-4 py-2.5 font-medium">Yetkazib beruvchi</th>
                <th className="text-right px-4 py-2.5 font-medium">Miqdor</th>
                <th className="text-right px-4 py-2.5 font-medium">Narx</th>
                <th className="text-left px-4 py-2.5 font-medium">Turi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchases.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{new Date(p.createdAt).toLocaleDateString('uz-UZ')}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{p.product.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{p.warehouse.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{p.supplier?.name || '—'}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{p.quantity} {p.product.unit}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{Number(p.unitCost).toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.isOfficial ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                      {p.isOfficial ? 'Rasmiy' : 'Norasmiy'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
