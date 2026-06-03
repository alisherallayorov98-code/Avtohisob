import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Plus, Pencil, Eye, AlertCircle, MapPin, Loader2, X, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'

type Status = 'active' | 'blacklisted' | 'inactive'

interface Entity {
  id: string
  code: string
  name: string
  address: string
  monthlyFee: number
  status: Status
  districtId: string
  mahallId: string
  mahallName?: string
  stir?: string
  lat?: number
  lng?: number
}

interface District {
  id: string
  name: string
}

interface Mahalla {
  id: string
  name: string
  districtId: string
}

const STATUS_LABELS: Record<Status, string> = {
  active: 'Faol',
  blacklisted: "Qora ro'yxat",
  inactive: 'Nofaol',
}

const STATUS_COLORS: Record<Status, string> = {
  active: 'bg-green-100 text-green-700',
  blacklisted: 'bg-red-100 text-red-700',
  inactive: 'bg-gray-100 text-gray-600',
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('uz-UZ') + " so'm"
}

interface NewEntityForm {
  code: string
  name: string
  address: string
  monthlyFee: string
  districtId: string
  mahallId: string
  stir: string
}

const EMPTY_FORM: NewEntityForm = {
  code: '',
  name: '',
  address: '',
  monthlyFee: '',
  districtId: '',
  mahallId: '',
  stir: '',
}

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterDistrict, setFilterDistrict] = useState('')
  const [filterMahalla, setFilterMahalla] = useState('')
  const [filterStatus, setFilterStatus] = useState<Status | ''>('')
  const [districts, setDistricts] = useState<District[]>([])
  const [mahallas, setMahallas] = useState<Mahalla[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [paymentEntity, setPaymentEntity] = useState<EntityBasic | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewEntityForm>(EMPTY_FORM)
  const [formMahallas, setFormMahallas] = useState<Mahalla[]>([])
  const [formLoading, setFormLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const PAGE_SIZE = 20

  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!filterDistrict) {
      setMahallas([])
      setFilterMahalla('')
      return
    }
    ekoApi.get(`/mahallas?districtId=${filterDistrict}`).then(res => {
      const data = res.data.data ?? res.data
      setMahallas(Array.isArray(data) ? data : [])
      setFilterMahalla('')
    }).catch(() => {})
  }, [filterDistrict])

  useEffect(() => {
    if (!form.districtId) {
      setFormMahallas([])
      return
    }
    ekoApi.get(`/mahallas?districtId=${form.districtId}`).then(res => {
      const data = res.data.data ?? res.data
      setFormMahallas(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [form.districtId])

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const fetchEntities = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (filterDistrict) params.set('districtId', filterDistrict)
    if (filterMahalla) params.set('mahallId', filterMahalla)
    if (filterStatus) params.set('status', filterStatus)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    ekoApi.get(`/entities?${params.toString()}`)
      .then(res => {
        const data = res.data.data ?? res.data
        setEntities(Array.isArray(data.items ?? data) ? (data.items ?? data) : [])
        setTotal(data.total ?? (data.items ?? data).length ?? 0)
      })
      .catch(() => { setEntities([]) })
      .finally(() => setLoading(false))
  }, [debouncedSearch, filterDistrict, filterMahalla, filterStatus, page])

  useEffect(() => { fetchEntities() }, [fetchEntities])

  async function handleAddToBlacklist(entity: Entity) {
    const reason = window.prompt(`"${entity.name}"ni qora ro'yxatga qo'shish uchun sabab kiriting:`)
    if (reason === null) return
    if (!reason.trim()) {
      toast.error('Sabab kiritilishi shart')
      return
    }
    try {
      await ekoApi.post('/blacklist', { entityId: entity.id, reason: reason.trim() })
      toast.success("Qora ro'yxatga qo'shildi")
      fetchEntities()
    } catch {
      toast.error("Xato yuz berdi")
    }
  }

  async function handleCreateEntity(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.address.trim() || !form.monthlyFee) {
      toast.error("Majburiy maydonlarni to'ldiring")
      return
    }
    setFormLoading(true)
    try {
      await ekoApi.post('/entities', {
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        address: form.address.trim(),
        monthlyFee: parseInt(form.monthlyFee, 10),
        districtId: form.districtId || undefined,
        mahallId: form.mahallId || undefined,
        stir: form.stir.trim() || undefined,
      })
      toast.success('Tashkilot qo\'shildi')
      setShowModal(false)
      setForm(EMPTY_FORM)
      fetchEntities()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Xato yuz berdi'
      toast.error(msg)
    } finally {
      setFormLoading(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Tashkilotlar</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yangi tashkilot
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Nom, STIR, kod bo'yicha qidirish..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <select
            value={filterDistrict}
            onChange={e => { setFilterDistrict(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[130px]"
          >
            <option value="">Barcha tumanlar</option>
            {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          {filterDistrict && mahallas.length > 0 && (
            <select
              value={filterMahalla}
              onChange={e => { setFilterMahalla(e.target.value); setPage(1) }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[130px]"
            >
              <option value="">Barcha mahallalar</option>
              {mahallas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}

          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value as Status | ''); setPage(1) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[120px]"
          >
            <option value="">Barcha holat</option>
            <option value="active">Faol</option>
            <option value="blacklisted">Qora ro'yxat</option>
            <option value="inactive">Nofaol</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
          </div>
        ) : entities.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Tashkilotlar topilmadi</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Kod</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Manzil</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Oylik to'lov</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Holat</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entities.map(entity => (
                  <tr key={entity.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{entity.code || '—'}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{entity.name}</p>
                      {entity.mahallName && (
                        <p className="text-xs text-gray-400 mt-0.5">{entity.mahallName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell max-w-[180px] truncate">{entity.address}</td>
                    <td className="px-4 py-3 text-gray-700 font-medium hidden lg:table-cell">{formatAmount(entity.monthlyFee)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[entity.status]}`}>
                        {STATUS_LABELS[entity.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          title="To'lovlarni ko'rish"
                          onClick={() => setPaymentEntity({
                            id: entity.id,
                            name: entity.name,
                            address: entity.address,
                            monthlyFee: entity.monthlyFee,
                          })}
                          className="p-1.5 hover:bg-green-50 hover:text-green-600 rounded-lg transition-colors text-gray-400"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          title="Tahrirlash"
                          className="p-1.5 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors text-gray-400"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {entity.status === 'active' && (
                          <button
                            title="Qora ro'yxatga qo'shish"
                            onClick={() => handleAddToBlacklist(entity)}
                            className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-gray-400"
                          >
                            <AlertCircle className="w-4 h-4" />
                          </button>
                        )}
                        {entity.lat && entity.lng && (
                          <button
                            title="Xaritada ko'rsatish"
                            className="p-1.5 hover:bg-purple-50 hover:text-purple-600 rounded-lg transition-colors text-gray-400"
                          >
                            <MapPin className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">{total} ta tashkilot</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50 transition-colors"
              >
                Oldingi
              </button>
              <span className="text-xs text-gray-600">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50 transition-colors"
              >
                Keyingi
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Entity Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Yangi tashkilot qo'shish</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateEntity} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Kod</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    placeholder="E001"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">STIR</label>
                  <input
                    type="text"
                    value={form.stir}
                    onChange={e => setForm(f => ({ ...f, stir: e.target.value }))}
                    placeholder="123456789"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Tashkilot nomi"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Manzil <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="Toshkent sh., Chilonzor t., ..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Oylik to'lov (so'm) <span className="text-red-500">*</span></label>
                <input
                  required
                  type="number"
                  value={form.monthlyFee}
                  onChange={e => setForm(f => ({ ...f, monthlyFee: e.target.value }))}
                  placeholder="50000"
                  min={1}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tuman</label>
                  <select
                    value={form.districtId}
                    onChange={e => setForm(f => ({ ...f, districtId: e.target.value, mahallId: '' }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">Tanlang</option>
                    {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Mahalla</label>
                  <select
                    value={form.mahallId}
                    onChange={e => setForm(f => ({ ...f, mahallId: e.target.value }))}
                    disabled={formMahallas.length === 0}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                  >
                    <option value="">Tanlang</option>
                    {formMahallas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {paymentEntity && (
        <PaymentModal
          entity={paymentEntity}
          onClose={() => setPaymentEntity(null)}
          onSuccess={fetchEntities}
        />
      )}
    </div>
  )
}
