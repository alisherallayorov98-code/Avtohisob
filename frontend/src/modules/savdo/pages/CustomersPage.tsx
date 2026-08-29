import { useState, useEffect, useCallback } from 'react'
import { Plus, Users, Loader2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface Customer {
  id: string
  name: string
  phone: string | null
  address: string | null
  priceTier: 'retail' | 'wholesale'
  isActive: boolean
}

const EMPTY = { name: '', phone: '', address: '', priceTier: 'retail' as 'retail' | 'wholesale' }

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const fetchCustomers = useCallback(() => {
    setLoading(true)
    savdoApi.get('/customers', { params: search ? { search } : {} })
      .then(res => setCustomers(res.data.data ?? []))
      .catch(() => toast.error('Mijozlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [search])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Nom talab qilinadi'); return }
    setSaving(true)
    try {
      await savdoApi.post('/customers', {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        priceTier: form.priceTier,
      })
      toast.success('Mijoz qo\'shildi')
      setForm(EMPTY); setShowForm(false)
      fetchCustomers()
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
          <h1 className="text-lg font-semibold text-gray-800">Mijozlar</h1>
          <p className="text-sm text-gray-500">Optom/chakana narx toifasi bo'yicha</p>
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
            <Plus className="w-4 h-4" /> Mijoz qo'shish
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nomi</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Telefon</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Manzil</label>
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Narx toifasi</label>
            <select value={form.priceTier} onChange={e => setForm(f => ({ ...f, priceTier: e.target.value as any }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="retail">Chakana</option>
              <option value="wholesale">Optom</option>
            </select>
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
      ) : customers.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali mijoz qo'shilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Nomi</th>
                <th className="text-left px-4 py-2.5 font-medium">Telefon</th>
                <th className="text-left px-4 py-2.5 font-medium">Toifa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customers.map(c => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{c.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.phone || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${c.priceTier === 'wholesale' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {c.priceTier === 'wholesale' ? 'Optom' : 'Chakana'}
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
