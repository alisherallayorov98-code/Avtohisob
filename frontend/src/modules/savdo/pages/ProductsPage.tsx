import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Package, Loader2, Search, Download, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'

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

interface ImportRow {
  rowNumber: number
  sku: string
  name: string
  category: string | null
  unit: string
  wholesalePrice: number
  retailPrice: number
  errors: string[]
  action: 'create' | 'update' | 'invalid'
}

interface ImportSummary { toCreate: number; toUpdate: number; invalid: number; total: number }

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [exporting, setExporting] = useState(false)

  // Excel'dan yuklash (import)
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [checking, setChecking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchProducts = useCallback(() => {
    setLoading(true)
    savdoApi.get('/products', { params: { page, ...(search ? { search } : {}) } })
      .then(res => {
        setProducts(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Mahsulotlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [search, page])

  useEffect(() => { fetchProducts() }, [fetchProducts])
  useEffect(() => { setPage(1) }, [search])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await savdoApi.get('/products/export.xlsx', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'mahsulotlar.xlsx'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('Excel yuklab bo\'lmadi')
    } finally {
      setExporting(false)
    }
  }

  function closeImport() {
    setShowImport(false)
    setImportFile(null)
    setImportRows(null)
    setImportSummary(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleTemplate() {
    try {
      const res = await savdoApi.get('/products/import/template.xlsx', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'mahsulot-shablon.xlsx'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('Shablonni yuklab bo\'lmadi')
    }
  }

  async function handlePreview() {
    if (!importFile) { toast.error('Avval Excel fayl tanlang'); return }
    setChecking(true)
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      const res = await savdoApi.post('/products/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImportRows(res.data.data?.rows ?? [])
      setImportSummary(res.data.data?.summary ?? null)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Faylni tekshirib bo\'lmadi')
    } finally {
      setChecking(false)
    }
  }

  async function handleConfirmImport() {
    if (!importRows) return
    setUploading(true)
    try {
      const res = await savdoApi.post('/products/import/confirm', { rows: importRows })
      const d = res.data.data ?? {}
      toast.success(`${d.created ?? 0} ta qo'shildi, ${d.updated ?? 0} ta yangilandi`)
      closeImport()
      fetchProducts()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Yuklashda xato yuz berdi')
    } finally {
      setUploading(false)
    }
  }

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
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Excel
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4" /> Excel'dan yuklash
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Mahsulot qo'shish
          </button>
        </div>
      </div>

      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto">
          <div className="bg-white border border-gray-200 rounded-xl w-full max-w-4xl my-4">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Excel'dan mahsulot yuklash</h2>
                <p className="text-xs text-gray-500">Ustunlar: SKU | Nomi | Kategoriya | Birlik | Optom narx | Chakana narx</p>
              </div>
              <button onClick={closeImport} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportRows(null); setImportSummary(null) }}
                  className="text-sm text-gray-600 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-sm file:font-medium file:text-gray-600 hover:file:bg-gray-50"
                />
                <button
                  onClick={handleTemplate}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
                >
                  <Download className="w-4 h-4" /> Namuna shablon
                </button>
                <button
                  onClick={handlePreview}
                  disabled={!importFile || checking}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium transition-colors"
                >
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Tekshirish
                </button>
              </div>

              {importSummary && (
                <p className="mt-4 text-sm text-gray-600">
                  <span className="font-medium text-gray-800">{importSummary.toCreate}</span> yangi,{' '}
                  <span className="font-medium text-gray-800">{importSummary.toUpdate}</span> yangilanadi,{' '}
                  <span className="font-medium text-gray-800">{importSummary.invalid}</span> xato
                  {' '}(jami {importSummary.total} qator)
                </p>
              )}

              {importRows && importRows.length > 0 && (
                <div className="mt-3 bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium">Qator</th>
                        <th className="text-left px-4 py-2.5 font-medium">SKU</th>
                        <th className="text-left px-4 py-2.5 font-medium">Nomi</th>
                        <th className="text-left px-4 py-2.5 font-medium">Holat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {importRows.map(r => (
                        <tr key={r.rowNumber}>
                          <td className="px-4 py-2.5 text-gray-500 savdo-num">{r.rowNumber}</td>
                          <td className="px-4 py-2.5 text-gray-500 savdo-num">{r.sku || '—'}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{r.name || '—'}</td>
                          <td className="px-4 py-2.5">
                            {r.action === 'invalid' ? (
                              <span className="text-red-600">Xato — {r.errors.join(', ')}</span>
                            ) : r.action === 'update' ? (
                              <span className="text-amber-700">Yangilanadi</span>
                            ) : (
                              <span className="text-green-700">Yangi</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200">
              <button
                onClick={closeImport}
                className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
              >
                Bekor qilish
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={!importRows || uploading || (importSummary ? importSummary.toCreate + importSummary.toUpdate === 0 : true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Tasdiqlash va yuklash
              </button>
            </div>
          </div>
        </div>
      )}

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
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
    </div>
  )
}
