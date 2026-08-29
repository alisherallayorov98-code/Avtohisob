import { useState, useEffect, useCallback } from 'react'
import { Plus, Warehouse as WarehouseIcon, Loader2, ToggleLeft, ToggleRight } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface Warehouse {
  id: string
  name: string
  location: string | null
  isActive: boolean
}

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchWarehouses = useCallback(() => {
    setLoading(true)
    savdoApi.get('/warehouses')
      .then(res => setWarehouses(res.data.data ?? []))
      .catch(() => toast.error('Omborlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchWarehouses() }, [fetchWarehouses])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Nom talab qilinadi'); return }
    setSaving(true)
    try {
      await savdoApi.post('/warehouses', { name: name.trim(), location: location.trim() || null })
      toast.success('Ombor qo\'shildi')
      setName(''); setLocation(''); setShowForm(false)
      fetchWarehouses()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(w: Warehouse) {
    try {
      await savdoApi.put(`/warehouses/${w.id}`, { isActive: !w.isActive })
      fetchWarehouses()
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Omborlar</h1>
          <p className="text-sm text-gray-500">Savdo modulining ombor ro'yxati</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Ombor qo'shish
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Nomi</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Manzil (ixtiyoriy)</label>
            <input value={location} onChange={e => setLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Saqlash'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : warehouses.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <WarehouseIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali ombor qo'shilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Nomi</th>
                <th className="text-left px-4 py-2.5 font-medium">Manzil</th>
                <th className="text-left px-4 py-2.5 font-medium">Holat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {warehouses.map(w => (
                <tr key={w.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{w.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{w.location || '—'}</td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => toggleActive(w)} className="flex items-center gap-1.5 text-xs">
                      {w.isActive ? (
                        <><ToggleRight className="w-4 h-4 text-green-600" /> <span className="text-green-700">Faol</span></>
                      ) : (
                        <><ToggleLeft className="w-4 h-4 text-gray-400" /> <span className="text-gray-400">Nofaol</span></>
                      )}
                    </button>
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
