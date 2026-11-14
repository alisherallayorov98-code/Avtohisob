// Dvigatel ta'mirlari — sodda: "shu mashina, shu kuni motor remont bo'ldi".
// Yog' bilan bog'liq hamma narsa "Motor yog'i" bo'limida. Bu sahifa faqat dvigatel tarixi.
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Cpu, Plus, Pencil, Trash2, Search, AlertTriangle, X, Check } from 'lucide-react'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import { useAuthStore } from '../stores/authStore'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import SearchableSelect from '../components/ui/SearchableSelect'

interface EngineRec {
  id: string
  vehicleId: string
  recordType: string
  mileage: number | string
  date: string
  description: string
  cost: number | string
  performedBy: string | null
  notes: string | null
  vehicle: { id: string; registrationNumber: string; brand: string; model: string }
}

interface Candidate {
  maintenanceId: string
  vehicleId: string
  plate: string
  vehicleName: string
  date: string
  mileage: number | null
  cost: number
  parts: string[]
  allParts: string[]
  workerName: string | null
}

interface VehicleOpt { id: string; registrationNumber: string; brand: string; model: string; mileage: number | string }

const TYPES: Array<[string, string]> = [
  ['overhaul', 'Kapital remont'],
  ['major_repair', "Yirik ta'mir"],
  ['minor_repair', "Kichik ta'mir"],
]
const TYPE_LABEL: Record<string, string> = { ...Object.fromEntries(TYPES), inspection: "Ko'rik" }
const TYPE_STYLE: Record<string, string> = {
  overhaul: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  major_repair: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  minor_repair: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  inspection: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
}

const num = (n: number | string | null | undefined) => (n == null || n === '' ? 0 : Number(n))
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')
const today = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
const toInputDate = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10)
const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm'
const errText = (e: any) => e?.response?.data?.error || e?.response?.data?.message || 'Xatolik'

interface FormState { vehicleId: string; date: string; recordType: string; mileage: string; cost: string; performedBy: string; description: string }
const emptyForm = (): FormState => ({ vehicleId: '', date: today(), recordType: 'overhaul', mileage: '', cost: '', performedBy: '', description: '' })

function RecordModal({ open, initial, editId, vehicles, onClose }: {
  open: boolean; initial: FormState; editId: string | null; vehicles: VehicleOpt[]; onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(initial)
  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))
  const selected = vehicles.find(v => v.id === form.vehicleId)

  const save = useMutation({
    mutationFn: () => {
      const body = {
        recordType: form.recordType, date: form.date,
        mileage: form.mileage.trim() || undefined, cost: form.cost.trim() || '0',
        performedBy: form.performedBy.trim() || null, description: form.description.trim() || undefined,
      }
      return editId ? api.put(`/engine-records/${editId}`, body) : api.post('/engine-records', { vehicleId: form.vehicleId, ...body })
    },
    onSuccess: () => {
      toast.success(editId ? 'Yangilandi' : 'Saqlandi')
      qc.invalidateQueries({ queryKey: ['engine-records'] })
      qc.invalidateQueries({ queryKey: ['engine-candidates'] })
      onClose()
    },
    onError: (e) => toast.error(errText(e)),
  })

  const canSave = !!form.vehicleId && !!form.date && !!form.recordType

  return (
    <Modal open={open} onClose={onClose} title={editId ? 'Yozuvni tahrirlash' : 'Motor remont qo\'shish'} size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave} icon={<Check className="w-4 h-4" />}>Saqlash</Button>
        </div>
      }>
      <div className="space-y-3">
        {editId ? (
          <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">{selected?.registrationNumber}</p>
        ) : (
          <SearchableSelect
            label="Mashina *"
            options={vehicles.map(v => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` }))}
            value={form.vehicleId}
            onChange={v => set('vehicleId', v)}
            placeholder="Raqam bo'yicha qidiring..."
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sana *</span>
            <input type="date" max={today()} value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nima bo'ldi *</span>
            <select value={form.recordType} onChange={e => set('recordType', e.target.value)} className={inputCls}>
              {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              {form.recordType === 'inspection' && <option value="inspection">Ko'rik</option>}
            </select>
          </label>
        </div>

        <p className="text-xs text-gray-400 pt-1">Quyidagilar ixtiyoriy</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Probeg, km</span>
            <input type="number" min={0} value={form.mileage} onChange={e => set('mileage', e.target.value)} className={inputCls}
              placeholder={selected ? `joriy: ${fmt(num(selected.mileage))}` : ''} />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Narx, so'm</span>
            <input type="number" min={0} value={form.cost} onChange={e => set('cost', e.target.value)} className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Kim bajardi</span>
          <input value={form.performedBy} onChange={e => set('performedBy', e.target.value)} maxLength={120} className={inputCls} placeholder="Usta yoki servis" />
        </label>
        <label className="block">
          <span className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Izoh</span>
          <input value={form.description} onChange={e => set('description', e.target.value)} maxLength={300} className={inputCls} placeholder="Masalan: porshen, kolsa, vkladish almashtirildi" />
        </label>
      </div>
    </Modal>
  )
}

export default function EngineMonitor() {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role ?? '')
  const canEdit = ['super_admin', 'admin', 'manager', 'branch_manager'].includes(role)
  const canDelete = ['super_admin', 'admin', 'manager'].includes(role)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [modal, setModal] = useState<{ open: boolean; initial: FormState; editId: string | null }>({ open: false, initial: emptyForm(), editId: null })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showAllCandidates, setShowAllCandidates] = useState(false)

  const { data: records = [], isLoading } = useQuery<EngineRec[]>({
    queryKey: ['engine-records'],
    // Barcha yozuvlar (sahifalab yig'amiz) — dvigatel ta'miri kam bo'ladi, qidiruv/filtr brauzerda
    queryFn: async () => {
      const all: EngineRec[] = []
      for (let page = 1; page <= 20; page++) {
        const r = await api.get('/engine-records', { params: { page, limit: 100 } })
        all.push(...r.data.data)
        if (page >= (r.data.meta?.totalPages || 1)) break
      }
      return all
    },
  })

  const { data: candidates = [] } = useQuery<Candidate[]>({
    queryKey: ['engine-candidates'],
    queryFn: () => api.get('/engine-records/candidates').then(r => r.data.data),
    enabled: canEdit,
  })

  const { data: vehicles = [] } = useQuery<VehicleOpt[]>({
    queryKey: ['vehicles-select'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true' } }).then(r => r.data.data),
    enabled: canEdit,
    staleTime: 5 * 60_000,
  })

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/engine-records/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi")
      setConfirmDelete(null)
      qc.invalidateQueries({ queryKey: ['engine-records'] })
      qc.invalidateQueries({ queryKey: ['engine-candidates'] })
    },
    onError: (e) => toast.error(errText(e)),
  })

  const notEngine = useMutation({
    mutationFn: (maintenanceId: string) => api.post(`/engine-records/candidates/${maintenanceId}/dismiss`),
    onSuccess: () => { toast.success('Belgilandi — boshqa so\'ralmaydi'); qc.invalidateQueries({ queryKey: ['engine-candidates'] }) },
    onError: (e) => toast.error(errText(e)),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s/g, '')
    return records.filter(r =>
      (!typeFilter || r.recordType === typeFilter)
      && (!q || `${r.vehicle.registrationNumber}${r.vehicle.brand}${r.vehicle.model}${r.description}`.toLowerCase().replace(/\s/g, '').includes(q)))
  }, [records, search, typeFilter])

  const openNew = () => setModal({ open: true, initial: emptyForm(), editId: null })
  const openEdit = (r: EngineRec) => setModal({
    open: true, editId: r.id,
    initial: {
      vehicleId: r.vehicleId, date: toInputDate(r.date), recordType: r.recordType, mileage: String(num(r.mileage) || ''),
      cost: num(r.cost) ? String(num(r.cost)) : '', performedBy: r.performedBy || '', description: r.description || '',
    },
  })
  const openFromCandidate = (c: Candidate) => setModal({
    open: true, editId: null,
    initial: {
      vehicleId: c.vehicleId, date: toInputDate(c.date), recordType: c.cost >= 2_000_000 ? 'overhaul' : 'major_repair',
      mileage: c.mileage ? String(c.mileage) : '', cost: c.cost ? String(c.cost) : '', performedBy: c.workerName || '',
      description: c.allParts.join(', ').slice(0, 300),
    },
  })

  const shownCandidates = showAllCandidates ? candidates : candidates.slice(0, 3)

  return (
    <div className="p-5 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-600" /> Dvigatel ta'mirlari
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Qaysi mashina qachon motor remont bo'lgani</p>
        </div>
        {canEdit && <Button onClick={openNew} icon={<Plus className="w-4 h-4" />}>Motor remont qo'shish</Button>}
      </div>

      {/* Yozilmagan motor remontlar */}
      {canEdit && candidates.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {candidates.length} ta ta'mirda dvigatel detali ishlatilgan, lekin bu yerga yozilmagan
              </p>
              <div className="mt-2 space-y-1.5">
                {shownCandidates.map(c => (
                  <div key={c.maintenanceId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm bg-white/70 dark:bg-gray-900/30 rounded-lg px-3 py-2">
                    <span className="font-mono font-semibold text-gray-900 dark:text-white">{c.plate}</span>
                    <span className="text-gray-500">{formatDate(c.date)}</span>
                    <span className="text-gray-700 dark:text-gray-300 flex-1 min-w-[10rem] truncate">{c.parts.join(', ')}</span>
                    {c.cost > 0 && <span className="text-gray-500 whitespace-nowrap">{fmt(c.cost)} so'm</span>}
                    <span className="flex gap-1.5">
                      <button onClick={() => openFromCandidate(c)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700">
                        <Plus className="w-3 h-3" /> Qo'shish
                      </button>
                      <button onClick={() => notEngine.mutate(c.maintenanceId)} disabled={notEngine.isPending}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                        <X className="w-3 h-3" /> Motor remont emas
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              {candidates.length > 3 && (
                <button onClick={() => setShowAllCandidates(s => !s)} className="mt-2 text-xs text-amber-800 dark:text-amber-300 hover:underline">
                  {showAllCandidates ? "Yig'ish" : `Yana ${candidates.length - 3} tasini ko'rsatish`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Qidiruv */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Mashina raqami..." className={`${inputCls} pl-9`} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">Barcha turlar</option>
          {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {/* Ro'yxat */}
      <div className="glass-card rounded-xl overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-gray-500">Yuklanmoqda...</p>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-gray-500">{records.length ? 'Qidiruv bo\'yicha yozuv topilmadi' : "Hali motor remont yozilmagan"}</p>
            {canEdit && !records.length && <button onClick={openNew} className="mt-2 text-sm text-blue-600 hover:underline">+ Birinchi yozuvni qo'shish</button>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Sana</th>
                  <th className="px-4 py-2.5 font-medium">Mashina</th>
                  <th className="px-4 py-2.5 font-medium">Nima bo'ldi</th>
                  <th className="px-4 py-2.5 font-medium text-right">Km</th>
                  <th className="px-4 py-2.5 font-medium text-right">Narx</th>
                  {(canEdit || canDelete) && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/70 dark:hover:bg-gray-800/40 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">{formatDate(r.date)}</td>
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">{r.vehicle.registrationNumber}</div>
                      <div className="text-xs text-gray-500">{r.vehicle.brand} {r.vehicle.model}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_STYLE[r.recordType] || TYPE_STYLE.minor_repair}`}>
                        {TYPE_LABEL[r.recordType] || r.recordType}
                      </span>
                      {r.description && r.description !== TYPE_LABEL[r.recordType] && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs">{r.description}</div>
                      )}
                      {r.performedBy && <div className="text-xs text-gray-400 mt-0.5">{r.performedBy}</div>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">{num(r.mileage) ? fmt(num(r.mileage)) : '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">{num(r.cost) ? fmt(num(r.cost)) : '—'}</td>
                    {(canEdit || canDelete) && (
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        {confirmDelete === r.id ? (
                          <span className="inline-flex gap-1">
                            <button onClick={() => del.mutate(r.id)} disabled={del.isPending} className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">O'chirish</button>
                            <button onClick={() => setConfirmDelete(null)} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">Yo'q</button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-1">
                            {canEdit && <button onClick={() => openEdit(r)} title="Tahrirlash" className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"><Pencil className="w-4 h-4" /></button>}
                            {canDelete && <button onClick={() => setConfirmDelete(r.id)} title="O'chirish" className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"><Trash2 className="w-4 h-4" /></button>}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {filtered.length > 0 && <p className="text-xs text-gray-400 text-center">{filtered.length} ta yozuv</p>}

      {modal.open && (
        <RecordModal
          key={modal.editId || JSON.stringify(modal.initial)}
          open={modal.open} initial={modal.initial} editId={modal.editId} vehicles={vehicles}
          onClose={() => setModal(m => ({ ...m, open: false }))}
        />
      )}
    </div>
  )
}
