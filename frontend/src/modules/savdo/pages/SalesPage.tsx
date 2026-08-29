import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Receipt, Loader2, Trash2, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import DateRangeFilter from '../ui/DateRangeFilter'
import SearchSelect from '../ui/SearchSelect'
import QuickAddCustomer from '../ui/QuickAddCustomer'

interface Option { id: string; name: string }
interface ProductOption extends Option { sku: string }
interface CustomerOption extends Option { phone: string | null; priceTier: 'retail' | 'wholesale' }
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
  const [products, setProducts] = useState<ProductOption[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exporting, setExporting] = useState(false)

  const fetchSales = useCallback(() => {
    setLoading(true)
    savdoApi.get('/sales', { params: { page, ...(from && { from }), ...(to && { to }) } })
      .then(res => {
        setSales(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Sotuvlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [page, from, to])

  useEffect(() => { setPage(1) }, [from, to])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await savdoApi.get('/sales/export.xlsx', { params: { ...(from && { from }), ...(to && { to }) }, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'savdo.xlsx'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('Excel yuklab bo\'lmadi')
    } finally {
      setExporting(false)
    }
  }

  const fetchProducts = useCallback(() => {
    savdoApi.get('/products/options').then(res => setProducts(res.data.data ?? [])).catch(() => {})
  }, [])
  const fetchCustomers = useCallback(() => {
    savdoApi.get('/customers/options').then(res => setCustomers(res.data.data ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    fetchSales()
    fetchProducts()
    savdoApi.get('/warehouses/options').then(res => setWarehouses(res.data.data ?? [])).catch(() => {})
    fetchCustomers()
  }, [fetchSales, fetchProducts, fetchCustomers])

  // Ombor bitta bo'lsa tanlashni so'ramaydi — avtomatik tanlanadi
  useEffect(() => {
    if (warehouses.length === 1 && !warehouseId) setWarehouseId(warehouses[0].id)
  }, [warehouses, warehouseId])

  function updateLine(i: number, patch: Partial<LineForm>) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function addLine() { setLines(ls => [...ls, { ...EMPTY_LINE }]) }
  function removeLine(i: number) { setLines(ls => ls.filter((_, idx) => idx !== i)) }

  function handleCustomerCreated(customer: { id: string; name: string; phone: string | null; priceTier: 'retail' | 'wholesale' }) {
    setCustomers(cs => [...cs, customer])
    setCustomerId(customer.id)
    setShowQuickAddCustomer(false)
  }

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
      setCustomerId(''); setLines([{ ...EMPTY_LINE }]); setShowForm(false)
      fetchSales()
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
          <h1 className="text-lg font-semibold text-gray-800">Savdo / Faktura</h1>
          <p className="text-sm text-gray-500">Mijozga sotish — narx va tannarx avtomatik hisoblanadi</p>
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
            <Plus className="w-4 h-4" /> Yangi sotuv
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {warehouses.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ombor</label>
                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  <option value="">Tanlang...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            )}
            <div className={warehouses.length > 1 ? '' : 'col-span-full'}>
              <label className="block text-xs font-medium text-gray-600 mb-1">Mijoz (ixtiyoriy — bo'sh qoldirilsa ko'chadan mijoz)</label>
              <SearchSelect
                options={customers.map(c => ({ id: c.id, label: c.name, sublabel: c.phone || undefined }))}
                value={customerId}
                onChange={setCustomerId}
                placeholder="Mijoz tanlang yoki qidiring..."
                extraAction={{ label: 'Yangi mijoz qo\'shish', onClick: () => setShowQuickAddCustomer(true) }}
              />
              {showQuickAddCustomer && (
                <QuickAddCustomer onCreated={handleCustomerCreated} onCancel={() => setShowQuickAddCustomer(false)} />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Qatorlar</label>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2 items-center">
                <SearchSelect
                  className="flex-1"
                  options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))}
                  value={line.productId}
                  onChange={id => updateLine(i, { productId: id })}
                  placeholder="Mahsulot tanlang yoki qidiring..."
                />
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
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
    </div>
  )
}
