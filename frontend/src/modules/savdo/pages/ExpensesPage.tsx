import { useState, useEffect, useCallback } from 'react'
import { Plus, Wallet, Loader2, Download, Ban, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import { EntityDialog } from '../ui/EntityDialog'
import RowMenu from '../ui/RowMenu'
import DateRangeFilter from '../ui/DateRangeFilter'
import { useSavdoAdmin, useSavdoPerms } from '../lib/useSavdoAdmin'
import { formatDate } from '../../../lib/utils'

// Kalitlar backend lib/expenseMath.ts'dagi EXPENSE_CATEGORIES bilan bir xil
// bo'lishi SHART (backend noto'g'ri kategoriyani 400 bilan rad etadi).
const CATEGORY_LABELS: Record<string, string> = {
  ijara: 'Ijara',
  transport: 'Transport',
  ish_haqi: 'Ish haqi',
  kommunal: 'Kommunal',
  soliq: 'Soliq',
  boshqa: 'Boshqa',
}
const CATEGORIES = Object.keys(CATEGORY_LABELS)

interface Option { id: string; name: string }
interface Expense {
  id: string
  category: string
  amount: string
  spentAt: string
  note: string | null
  cancelled: boolean
  warehouse: { id: string; name: string } | null
}
interface CategoryGroup { category: string; label: string; total: number; share: number }

const EMPTY = { category: 'boshqa', amount: '', spentAt: '', warehouseId: '', note: '' }

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [summary, setSummary] = useState<{ totalAmount: number; byCategory: CategoryGroup[] }>({ totalAmount: 0, byCategory: [] })
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [category, setCategory] = useState('')
  const [exporting, setExporting] = useState(false)
  const [cancellingId, setCancellingId] = useState('')
  const isAdmin = useSavdoAdmin()
  const canManage = useSavdoPerms()('expenses.manage')
  const [editExp, setEditExp] = useState<any>(null)

  const fetchExpenses = useCallback(() => {
    setLoading(true)
    savdoApi.get('/expenses', { params: { page, ...(from && { from }), ...(to && { to }), ...(category && { category }) } })
      .then(res => {
        setExpenses(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
        setSummary(res.data.summary ?? { totalAmount: 0, byCategory: [] })
      })
      .catch(() => toast.error('Xarajatlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [page, from, to, category])

  useEffect(() => { setPage(1) }, [from, to, category])

  useEffect(() => {
    fetchExpenses()
  }, [fetchExpenses])

  useEffect(() => {
    savdoApi.get('/warehouses/options').then(res => setWarehouses(res.data.data ?? [])).catch(() => {})
  }, [])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await savdoApi.get('/expenses/export.xlsx', {
        params: { ...(from && { from }), ...(to && { to }), ...(category && { category }) },
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'xarajatlar.xlsx'
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
    if (!form.category) { toast.error('Kategoriyani tanlang'); return }
    if (!form.amount || Number(form.amount) <= 0) { toast.error('Summani kiriting'); return }
    setSaving(true)
    try {
      await savdoApi.post('/expenses', {
        category: form.category,
        amount: Number(form.amount),
        spentAt: form.spentAt || null,
        warehouseId: form.warehouseId || null,
        note: form.note.trim() || null,
      })
      toast.success('Xarajat qayd etildi')
      setForm(EMPTY); setShowForm(false)
      fetchExpenses()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm('Bu xarajatni bekor qilasizmi? Yozuv o\'chmaydi, hisobdan chiqariladi.')) return
    setCancellingId(id)
    try {
      await savdoApi.post(`/expenses/${id}/cancel`)
      toast.success('Xarajat bekor qilindi')
      fetchExpenses()
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
          <h1 className="text-lg font-semibold text-gray-800">Xarajatlar</h1>
          <p className="text-sm text-gray-500">Ijara, transport, ish haqi — sof foyda hisobi uchun</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
          >
            <option value="">Barcha kategoriyalar</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
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
            <Plus className="w-4 h-4" /> Xarajat qo'shish
          </button>
        </div>
      </div>

      <div className="mb-5 p-4 bg-white border border-gray-200 rounded-xl">
        <div className="text-xs font-medium text-gray-500 uppercase mb-1">Davr xarajati (jami)</div>
        <div className="text-2xl font-semibold text-gray-800 savdo-num mb-4">
          {summary.totalAmount.toLocaleString()} so'm
        </div>
        {summary.byCategory.length === 0 ? (
          <div className="text-sm text-gray-400">Tanlangan davrda xarajat yo'q</div>
        ) : (
          <div className="space-y-2">
            {summary.byCategory.map(g => (
              <div key={g.category}>
                <div className="flex items-center justify-between text-sm mb-0.5">
                  <span className="text-gray-700">{CATEGORY_LABELS[g.category] || g.label}</span>
                  <span className="text-gray-500 savdo-num">
                    {g.total.toLocaleString()} so'm · {g.share}%
                  </span>
                </div>
                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-700 rounded-full" style={{ width: `${g.share}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kategoriya</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Summa (so'm)</label>
            <input type="number" min="1" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sana (bo'sh — bugun)</label>
            <input type="date" value={form.spentAt} onChange={e => setForm(f => ({ ...f, spentAt: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ombor (ixtiyoriy)</label>
            <select value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="">—</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Izoh (ixtiyoriy)</label>
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
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
      ) : expenses.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <Wallet className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali xarajat qayd etilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Kategoriya</th>
                <th className="text-right px-4 py-2.5 font-medium">Summa</th>
                <th className="text-left px-4 py-2.5 font-medium">Ombor</th>
                <th className="text-left px-4 py-2.5 font-medium">Izoh</th>
                <th className="text-left px-4 py-2.5 font-medium">Holat</th>
                <th className="text-right px-4 py-2.5 font-medium">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expenses.map(e => (
                <tr key={e.id} className={e.cancelled ? 'opacity-50' : ''}>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{formatDate(e.spentAt)}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{CATEGORY_LABELS[e.category] || e.category}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{Number(e.amount).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-gray-500">{e.warehouse?.name || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{e.note || '—'}</td>
                  <td className="px-4 py-2.5">
                    {e.cancelled ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">Bekor qilingan</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">Faol</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!e.cancelled && (
                      <RowMenu items={[
                        { label: 'Tahrirlash', icon: <Pencil className="w-4 h-4" />, hidden: !canManage, onClick: () => setEditExp(e) },
                        { label: 'Bekor qilish', icon: <Ban className="w-4 h-4" />, danger: true, hidden: !isAdmin, disabled: cancellingId === e.id, onClick: () => handleCancel(e.id) },
                      ]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editExp && <EntityDialog entity="expense" row={editExp} onClose={() => setEditExp(null)} onSaved={fetchExpenses} />}
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
    </div>
  )
}
