import { useState, useEffect, useCallback } from 'react'
import { Plus, Package, Loader2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface Product {
  id: string
  sku: string
  name: string
  category: string | null
  unit: string
  wholesalePrice: string
  retailPrice: string
  isActive: boolean
}

const EMPTY = { sku: '', name: '', category: '', unit: 'dona', wholesalePrice: '', retailPrice: '' }

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const fetchProducts = useCallback(() => {
    setLoading(true)
    savdoApi.get('/products', { params: search ? { search } : {} })
      .then(res => setProducts(res.data.data ?? []))
      .catch(() => toast.error('Mahsulotlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [search])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.sku.trim() || !form.name.trim()) { toast.error('SKU va nom talab qilinadi'); return }
    setSaving(true)
    try {
      await savdoApi.post('/products', {
        sku: form.sku.trim(),
        name: form.name.trim(),
        category: form.category.trim() || null,
        unit: form.unit,
        wholesalePrice: form.wholesalePrice ? Number(form.wholesalePrice) : 0,
        retailPrice: form.retailPrice ? Number(form.retailPrice) : 0,
      })
      toast.success('Mahsulot qo\'shildi')
      setForm(EMPTY); setShowForm(false)
      fetchProducts()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Mahsulotlar</h1>
          <p className="text-sm text-gray-500">Katalog — optom va chakana narx bilan</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Qidirish..."
              className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600 w-48"
            />
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Mahsulot qo'shish
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
            <input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nomi</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kategoriya (ixtiyoriy)</label>
            <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">O'lchov birligi</label>
            <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Optom narx</label>
            <input type="number" min="0" value={form.wholesalePrice} onChange={e => setForm(f => ({ ...f, wholesalePrice: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Chakana narx</label>
            <input type="number" min="0" value={form.retailPrice} onChange={e => setForm(f => ({ ...f, retailPrice: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
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
      ) : products.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali mahsulot qo'shilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">SKU</th>
                <th className="text-left px-4 py-2.5 font-medium">Nomi</th>
                <th className="text-left px-4 py-2.5 font-medium">Kategoriya</th>
                <th className="text-left px-4 py-2.5 font-medium">Birlik</th>
                <th className="text-right px-4 py-2.5 font-medium">Optom</th>
                <th className="text-right px-4 py-2.5 font-medium">Chakana</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{p.sku}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{p.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{p.category || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{p.unit}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{Number(p.wholesalePrice).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{Number(p.retailPrice).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
