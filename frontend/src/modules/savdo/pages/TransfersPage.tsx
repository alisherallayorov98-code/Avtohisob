import { useState, useEffect, useCallback } from 'react'
import { Plus, ArrowLeftRight, Loader2, Download, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import DateRangeFilter from '../ui/DateRangeFilter'
import SearchSelect from '../ui/SearchSelect'
import { useSavdoAdmin } from '../lib/useSavdoAdmin'
import { formatDate } from '../../../lib/utils'

interface Option { id: string; name: string }
interface ProductOption extends Option { sku: string }
interface Transfer {
  id: string
  quantity: number
  totalCost: string
  status: string
  notes: string | null
  createdAt: string
  product: { id: string; name: string; sku: string; unit: string }
  fromWarehouse: { id: string; name: string }
  toWarehouse: { id: string; name: string }
}

const EMPTY = {
  productId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '', notes: '',
}

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const [cancellingId, setCancellingId] = useState('')
  const isAdmin = useSavdoAdmin()

  const fetchTransfers = useCallback(() => {
    setLoading(true)
    savdoApi.get('/transfers', { params: { page, ...(from && { from }), ...(to && { to }) } })
      .then(res => {
        setTransfers(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Ko\'chirishlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [page, from, to])

  useEffect(() => { setPage(1) }, [from, to])

  useEffect(() => {
    fetchTransfers()
    savdoApi.get('/products/options').then(res => setProducts(res.data.data ?? [])).catch(() => {})
    savdoApi.get('/warehouses/options').then(res => setWarehouses(res.data.data ?? [])).catch(() => {})
  }, [fetchTransfers])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await savdoApi.get('/transfers/export.xlsx', { params: { ...(from && { from }), ...(to && { to }) }, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'kochirish.xlsx'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('Excel yuklab bo\'lmadi')
    } finally {
      setExporting(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.productId) { toast.error('Mahsulotni tanlang'); return }
    if (!form.fromWarehouseId || !form.toWarehouseId) { toast.error('Ikkala omborni tanlang'); return }
    if (form.fromWarehouseId === form.toWarehouseId) { toast.error('Omborlar bir xil bo\'lmasligi kerak'); return }
    if (!form.quantity || Number(form.quantity) <= 0) { toast.error('Miqdorni kiriting'); return }
    setSaving(true)
    try {
      await savdoApi.post('/transfers', {
        productId: form.productId,
        fromWarehouseId: form.fromWarehouseId,
        toWarehouseId: form.toWarehouseId,
        quantity: Number(form.quantity),
        notes: form.notes.trim() || null,
      })
      toast.success('Tovar ko\'chirildi')
      setForm(EMPTY); setShowForm(false)
      fetchTransfers()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm('Bu ko\'chirishni bekor qilasizmi? Faqat ko\'chirilgan tovardan hali hech narsa sotilmagan bo\'lsa bekor qilinadi.')) return
    setCancellingId(id)
    try {
      await savdoApi.post(`/transfers/${id}/cancel`)
      toast.success('Ko\'chirish bekor qilindi')
      fetchTransfers()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setCancellingId('')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Omborlararo ko'chirish</h1>
          <p className="text-sm text-gray-500">Tovarni bir ombordan boshqasiga o'tkazish (tannarx bilan)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Excel
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Ko'chirish
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Mahsulot</label>
            <SearchSelect
              options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))}
              value={form.productId}
              onChange={id => setForm(f => ({ ...f, productId: id }))}
              placeholder="Mahsulot tanlang yoki qidiring..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Qayerdan (manba ombor)</label>
            <select value={form.fromWarehouseId} onChange={e => setForm(f => ({ ...f, fromWarehouseId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="">Tanlang...</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Qayerga (qabul qiluvchi)</label>
            <select value={form.toWarehouseId} onChange={e => setForm(f => ({ ...f, toWarehouseId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="">Tanlang...</option>
              {warehouses.filter(w => w.id !== form.fromWarehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Miqdor</label>
            <input type="number" min="0.001" step="any" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Izoh (ixtiyoriy)</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div className="col-span-full">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ko\'chirish'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : transfers.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <ArrowLeftRight className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali ko'chirish qayd etilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Mahsulot</th>
                <th className="text-left px-4 py-2.5 font-medium">Qayerdan</th>
                <th className="text-left px-4 py-2.5 font-medium">Qayerga</th>
                <th className="text-right px-4 py-2.5 font-medium">Miqdor</th>
                <th className="text-right px-4 py-2.5 font-medium">Tannarx summasi</th>
                <th className="text-left px-4 py-2.5 font-medium">Holat</th>
                {isAdmin && <th className="text-right px-4 py-2.5 font-medium">Amal</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transfers.map(t => (
                <tr key={t.id} className={t.status === 'cancelled' ? 'opacity-50' : ''}>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{formatDate(t.createdAt)}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{t.product.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{t.fromWarehouse.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{t.toWarehouse.name}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{t.quantity} {t.product.unit}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{Number(t.totalCost).toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    {t.status === 'cancelled' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">Bekor qilingan</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">Bajarilgan</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2.5 text-right">
                      {t.status !== 'cancelled' && (
                        <button
                          onClick={() => handleCancel(t.id)}
                          disabled={cancellingId === t.id}
                          className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 disabled:opacity-60 text-xs font-medium"
                        >
                          {cancellingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />} Bekor qilish
                        </button>
                      )}
                    </td>
                  )}
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
