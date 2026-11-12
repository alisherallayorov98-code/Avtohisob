import { useState, useEffect, useCallback } from 'react'
import { Plus, Users, Loader2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import { EntityDialog, EditButton } from '../ui/EntityDialog'

interface Customer {
  id: string
  name: string
  phone: string | null
  address: string | null
  priceTier: 'retail' | 'wholesale'
  isActive: boolean
  isLegal?: boolean
  stir?: string | null
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })

  const fetchCustomers = useCallback(() => {
    setLoading(true)
    savdoApi.get('/customers', { params: { page, ...(search ? { search } : {}) } })
      .then(res => {
        setCustomers(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Mijozlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [search, page])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])
  useEffect(() => { setPage(1) }, [search])

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

      {showForm && <EntityDialog entity="customer" row={null} onClose={() => setShowForm(false)} onSaved={fetchCustomers} />}

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
                <th className="text-left px-4 py-2.5 font-medium">STIR</th>
                <th className="text-right px-4 py-2.5 font-medium">Amal</th>
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
                  <td className="px-4 py-2.5 text-gray-500">{c.isLegal ? (c.stir || 'Yuridik') : '—'}</td>
                  <td className="px-4 py-2.5 text-right"><EditButton entity="customer" row={c as any} onSaved={fetchCustomers} /></td>
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
