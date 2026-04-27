import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ChevronRight, X, Check, Upload, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../lib/api'

type Tab = 'regions' | 'districts' | 'mfys' | 'landfills' | 'containers'

const tabs: { key: Tab; label: string }[] = [
  { key: 'regions', label: 'Viloyatlar' },
  { key: 'districts', label: 'Tumanlar' },
  { key: 'mfys', label: 'MFYlar' },
  { key: 'landfills', label: 'Chiqindi poligonlari' },
  { key: 'containers', label: 'Konteynerlar' },
]

export default function DataEntry() {
  const [activeTab, setActiveTab] = useState<Tab>('regions')

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Ma'lumotlar kiritish</h1>
        <p className="text-sm text-gray-500 mt-0.5">Joylashuv ierarxiyasi: Viloyat → Tuman → MFY</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'regions' && <RegionsTab />}
      {activeTab === 'districts' && <DistrictsTab />}
      {activeTab === 'mfys' && <MfysTab />}
      {activeTab === 'landfills' && <LandfillsTab />}
      {activeTab === 'containers' && <ContainersTab />}
    </div>
  )
}

// ─── Konteynerlar ────────────────────────────────────────────────────────────
function ContainersTab() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [mfyFilter, setMfyFilter] = useState('')

  const { data: mfys } = useQuery({
    queryKey: ['th-mfys-cont'],
    queryFn: () => api.get('/th/mfys', { params: { limit: 2000 } }).then(r => r.data.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['th-containers', mfyFilter, page],
    queryFn: () => api.get('/th/containers', {
      params: { mfyId: mfyFilter || undefined, page, limit: 50 },
    }).then(r => r.data),
  })

  const syncMut = useMutation({
    mutationFn: () => api.post('/th/gps/sync-containers'),
    onSuccess: (res) => {
      toast.success(res.data.message)
      qc.invalidateQueries({ queryKey: ['th-containers'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const updateMfyMut = useMutation({
    mutationFn: ({ id, mfyId }: { id: string; mfyId: string | null }) =>
      api.put(`/th/containers/${id}`, { mfyId }),
    onSuccess: () => {
      toast.success('MFY ga biriktirildi')
      qc.invalidateQueries({ queryKey: ['th-containers'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/th/containers/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi")
      qc.invalidateQueries({ queryKey: ['th-containers'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="space-y-4">
      {/* SmartGPS sinx */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-medium text-indigo-800">SmartGPS dan konteynerlarni sinxronlash</p>
            <p className="text-xs text-indigo-600 mt-0.5">SmartGPS dagi circle (doira) zonalardan konteynerlarni avto-yuklaydi</p>
          </div>
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {syncMut.isPending ? 'Sinxronlanmoqda...' : 'SmartGPS dan yuklash'}
          </button>
        </div>
      </div>

      {/* Filtr */}
      <div className="flex gap-2 flex-wrap items-center">
        <select value={mfyFilter} onChange={e => { setMfyFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-52">
          <option value="">Barcha MFYlar</option>
          {(mfys || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <span className="text-sm text-gray-400">{data?.meta?.total || 0} ta konteyner</span>
      </div>

      {/* Ro'yxat */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Nomi</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">MFY</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Radius</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Koordinata</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Yuklanmoqda...</td></tr>}
              {!isLoading && (data?.data || []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  Konteyner yo'q. SmartGPS dan yuklang yoki qo'lda qo'shing.
                </td></tr>
              )}
              {(data?.data || []).map((c: any) => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-800 font-medium">
                    {c.name}
                    {c.gpsZoneName && c.gpsZoneName !== c.name && (
                      <span className="ml-1 text-xs text-gray-400">(GPS: {c.gpsZoneName})</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={c.mfyId || ''}
                      onChange={e => updateMfyMut.mutate({ id: c.id, mfyId: e.target.value || null })}
                      className="px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-44"
                    >
                      <option value="">— biriktirilmagan —</option>
                      {(mfys || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">{Math.round(c.radiusM)} m</td>
                  <td className="px-4 py-3 text-center text-xs text-gray-400 font-mono">
                    {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => { if (confirm("O'chirilsinmi?")) deleteMut.mutate(c.id) }}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data?.meta?.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Sahifa {page} / {data.meta.totalPages}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Oldingi
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= data.meta.totalPages}
                className="px-3 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Keyingi
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Viloyatlar ──────────────────────────────────────────────────────────────

function RegionsTab() {
  const qc = useQueryClient()
  const [form, setForm] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['th-regions'],
    queryFn: () => api.get('/th/regions').then(r => r.data.data),
  })

  const createMut = useMutation({
    mutationFn: (name: string) => api.post('/th/regions', { name }),
    onSuccess: () => { toast.success("Qo'shildi"); qc.invalidateQueries({ queryKey: ['th-regions'] }); setForm('') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.put(`/th/regions/${id}`, { name }),
    onSuccess: () => { toast.success('Yangilandi'); qc.invalidateQueries({ queryKey: ['th-regions'] }); setEditId(null) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/th/regions/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['th-regions'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <EntityTable
      title="Viloyatlar"
      isLoading={isLoading}
      items={data || []}
      form={form}
      setForm={setForm}
      onAdd={() => { if (form.trim()) createMut.mutate(form) }}
      addLoading={createMut.isPending}
      placeholder="Viloyat nomi..."
      editId={editId}
      editName={editName}
      setEditName={setEditName}
      onEditStart={(item) => { setEditId(item.id); setEditName(item.name) }}
      onEditSave={() => { if (editName.trim()) updateMut.mutate({ id: editId!, name: editName }) }}
      onEditCancel={() => setEditId(null)}
      editLoading={updateMut.isPending}
      onDelete={(id) => { if (confirm("O'chirilsinmi?")) deleteMut.mutate(id) }}
      deleteLoading={deleteMut.isPending}
      renderMeta={(item) => <span className="text-xs text-gray-400">{item._count?.districts ?? 0} ta tuman</span>}
    />
  )
}

// ─── Tumanlar ────────────────────────────────────────────────────────────────

function DistrictsTab() {
  const qc = useQueryClient()
  const [regionFilter, setRegionFilter] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState({ name: '', regionId: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const { data: regions } = useQuery({ queryKey: ['th-regions'], queryFn: () => api.get('/th/regions').then(r => r.data.data) })
  const { data, isLoading } = useQuery({
    queryKey: ['th-districts', regionFilter, page],
    queryFn: () => api.get('/th/districts', { params: { regionId: regionFilter || undefined, page, limit: 20 } }).then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (d: typeof form) => api.post('/th/districts', d),
    onSuccess: () => { toast.success("Qo'shildi"); qc.invalidateQueries({ queryKey: ['th-districts'] }); setForm({ name: '', regionId: '' }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.put(`/th/districts/${id}`, { name }),
    onSuccess: () => { toast.success('Yangilandi'); qc.invalidateQueries({ queryKey: ['th-districts'] }); setEditId(null) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/th/districts/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['th-districts'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Yangi tuman qo'shish</p>
        <div className="flex gap-2 flex-wrap">
          <select value={form.regionId} onChange={e => setForm(f => ({ ...f, regionId: e.target.value }))}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-40">
            <option value="">Viloyat tanlang</option>
            {(regions || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Tuman nomi..." onKeyDown={e => e.key === 'Enter' && form.name.trim() && form.regionId && createMut.mutate(form)}
            className="flex-1 min-w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button onClick={() => form.name.trim() && form.regionId && createMut.mutate(form)}
            disabled={createMut.isPending || !form.name.trim() || !form.regionId}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            <Plus className="w-4 h-4" /> Qo'shish
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 items-center">
        <select value={regionFilter} onChange={e => { setRegionFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="">Barcha viloyatlar</option>
          {(regions || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <span className="text-sm text-gray-400">{data?.meta?.total || 0} ta tuman</span>
      </div>

      <EntityList
        isLoading={isLoading}
        items={data?.data || []}
        editId={editId}
        editName={editName}
        setEditName={setEditName}
        onEditStart={(item) => { setEditId(item.id); setEditName(item.name) }}
        onEditSave={() => { if (editName.trim()) updateMut.mutate({ id: editId!, name: editName }) }}
        onEditCancel={() => setEditId(null)}
        editLoading={updateMut.isPending}
        onDelete={(id) => { if (confirm("O'chirilsinmi?")) deleteMut.mutate(id) }}
        deleteLoading={deleteMut.isPending}
        renderMeta={(item) => (
          <span className="text-xs text-gray-400">
            {item.region?.name} <ChevronRight className="w-3 h-3 inline" /> {item._count?.mfys ?? 0} ta MFY
          </span>
        )}
      />
      <SimplePagination page={page} totalPages={data?.meta?.totalPages || 1} onPageChange={setPage} />
    </div>
  )
}

// ─── MFYlar ──────────────────────────────────────────────────────────────────

function MfysTab() {
  const qc = useQueryClient()
  const [regionFilter, setRegionFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState({ name: '', districtId: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [importDistrictId, setImportDistrictId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: regions } = useQuery({ queryKey: ['th-regions'], queryFn: () => api.get('/th/regions').then(r => r.data.data) })
  const { data: districts } = useQuery({
    queryKey: ['th-districts-all', regionFilter],
    queryFn: () => api.get('/th/districts', { params: { regionId: regionFilter || undefined, limit: 200 } }).then(r => r.data.data),
  })
  const { data, isLoading } = useQuery({
    queryKey: ['th-mfys', districtFilter, regionFilter, page],
    queryFn: () => api.get('/th/mfys', { params: { districtId: districtFilter || undefined, regionId: (!districtFilter && regionFilter) ? regionFilter : undefined, page, limit: 20 } }).then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (d: typeof form) => api.post('/th/mfys', d),
    onSuccess: () => { toast.success("Qo'shildi"); qc.invalidateQueries({ queryKey: ['th-mfys'] }); setForm({ name: '', districtId: '' }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.put(`/th/mfys/${id}`, { name }),
    onSuccess: () => { toast.success('Yangilandi'); qc.invalidateQueries({ queryKey: ['th-mfys'] }); setEditId(null) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/th/mfys/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['th-mfys'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const importMut = useMutation({
    mutationFn: ({ file, districtId }: { file: File; districtId: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('districtId', districtId)
      return api.post('/th/mfys/import', fd)
    },
    onSuccess: (res) => {
      toast.success(res.data.message)
      qc.invalidateQueries({ queryKey: ['th-mfys'] })
      if (fileRef.current) fileRef.current.value = ''
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!importDistrictId) { toast.error('Avval tuman tanlang'); return }
    importMut.mutate({ file, districtId: importDistrictId })
  }

  return (
    <div className="space-y-4">
      {/* Ommaviy import */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-emerald-800">Exceldan ommaviy yuklash</p>
          <a href="/api/th/mfys/template" download className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors">
            <Download className="w-3.5 h-3.5" /> Shablon yuklab olish
          </a>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select value={importDistrictId} onChange={e => setImportDistrictId(e.target.value)}
            className="px-3 py-2 text-sm border border-emerald-300 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-52">
            <option value="">Tuman tanlang (majburiy)</option>
            {(districts || []).map((d: any) => <option key={d.id} value={d.id}>{d.region?.name} — {d.name}</option>)}
          </select>
          <label className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg cursor-pointer transition-colors ${importDistrictId ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
            <Upload className="w-4 h-4" />
            {importMut.isPending ? 'Yuklanmoqda...' : 'Excel yuklash'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} disabled={!importDistrictId || importMut.isPending} />
          </label>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Yangi MFY qo'shish</p>
        <div className="flex gap-2 flex-wrap">
          <select value={form.districtId} onChange={e => setForm(f => ({ ...f, districtId: e.target.value }))}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-48">
            <option value="">Tuman tanlang</option>
            {(districts || []).map((d: any) => <option key={d.id} value={d.id}>{d.region?.name} — {d.name}</option>)}
          </select>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="MFY nomi..." onKeyDown={e => e.key === 'Enter' && form.name.trim() && form.districtId && createMut.mutate(form)}
            className="flex-1 min-w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button onClick={() => form.name.trim() && form.districtId && createMut.mutate(form)}
            disabled={createMut.isPending || !form.name.trim() || !form.districtId}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            <Plus className="w-4 h-4" /> Qo'shish
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select value={regionFilter} onChange={e => { setRegionFilter(e.target.value); setDistrictFilter(''); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="">Barcha viloyatlar</option>
          {(regions || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={districtFilter} onChange={e => { setDistrictFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="">Barcha tumanlar</option>
          {(districts || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span className="text-sm text-gray-400">{data?.meta?.total || 0} ta MFY</span>
      </div>

      <EntityList
        isLoading={isLoading}
        items={data?.data || []}
        editId={editId} editName={editName} setEditName={setEditName}
        onEditStart={(item) => { setEditId(item.id); setEditName(item.name) }}
        onEditSave={() => { if (editName.trim()) updateMut.mutate({ id: editId!, name: editName }) }}
        onEditCancel={() => setEditId(null)}
        editLoading={updateMut.isPending}
        onDelete={(id) => { if (confirm("O'chirilsinmi?")) deleteMut.mutate(id) }}
        deleteLoading={deleteMut.isPending}
        renderMeta={(item) => (
          <span className="text-xs text-gray-400">
            {item.district?.region?.name} <ChevronRight className="w-3 h-3 inline" /> {item.district?.name}
            {item.gpsZoneName && (
              <span className="ml-2 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px]">
                GPS: {item.gpsZoneName}
              </span>
            )}
          </span>
        )}
      />
      <SimplePagination page={page} totalPages={data?.meta?.totalPages || 1} onPageChange={setPage} />
    </div>
  )
}

// ─── Chiqindi poligonlari ─────────────────────────────────────────────────────

function LandfillsTab() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', location: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [editData, setEditData] = useState({ name: '', location: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['th-landfills'],
    queryFn: () => api.get('/th/landfills').then(r => r.data.data),
  })
  const createMut = useMutation({
    mutationFn: (d: typeof form) => api.post('/th/landfills', d),
    onSuccess: () => { toast.success("Qo'shildi"); qc.invalidateQueries({ queryKey: ['th-landfills'] }); setForm({ name: '', location: '' }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...d }: { id: string; name: string; location: string }) => api.put(`/th/landfills/${id}`, d),
    onSuccess: () => { toast.success('Yangilandi'); qc.invalidateQueries({ queryKey: ['th-landfills'] }); setEditId(null) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/th/landfills/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['th-landfills'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Yangi chiqindi poligoni qo'shish</p>
        <div className="flex gap-2 flex-wrap">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Poligon nomi..."
            className="flex-1 min-w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            placeholder="Manzil (ixtiyoriy)..."
            className="flex-1 min-w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button onClick={() => form.name.trim() && createMut.mutate(form)}
            disabled={createMut.isPending || !form.name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            <Plus className="w-4 h-4" /> Qo'shish
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {isLoading && <p className="px-4 py-8 text-center text-sm text-gray-400">Yuklanmoqda...</p>}
        {!isLoading && (data || []).length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">Hali hech narsa qo'shilmagan</p>}
        {(data || []).map((item: any) => (
          <div key={item.id} className="flex items-center gap-3 px-4 py-3">
            {editId === item.id ? (
              <>
                <input value={editData.name} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))}
                  className="flex-1 px-2 py-1 text-sm border border-emerald-400 rounded focus:outline-none" />
                <input value={editData.location} onChange={e => setEditData(d => ({ ...d, location: e.target.value }))}
                  placeholder="Manzil..." className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none" />
                <button onClick={() => updateMut.mutate({ id: editId!, ...editData })} disabled={updateMut.isPending}
                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-4 h-4" /></button>
                <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
              </>
            ) : (
              <>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">{item.name}</p>
                  {item.location && <p className="text-xs text-gray-400">{item.location}</p>}
                </div>
                <button onClick={() => { setEditId(item.id); setEditData({ name: item.name, location: item.location || '' }) }}
                  className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { if (confirm("O'chirilsinmi?")) deleteMut.mutate(item.id) }}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Shared components ────────────────────────────────────────────────────────

interface EntityTableProps {
  title: string
  isLoading: boolean
  items: any[]
  form: string
  setForm: (v: string) => void
  onAdd: () => void
  addLoading: boolean
  placeholder: string
  editId: string | null
  editName: string
  setEditName: (v: string) => void
  onEditStart: (item: any) => void
  onEditSave: () => void
  onEditCancel: () => void
  editLoading: boolean
  onDelete: (id: string) => void
  deleteLoading: boolean
  renderMeta?: (item: any) => React.ReactNode
}

function EntityTable({ title, isLoading, items, form, setForm, onAdd, addLoading, placeholder, ...listProps }: EntityTableProps) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Yangi {title.toLowerCase().slice(0, -2)} qo'shish</p>
        <div className="flex gap-2">
          <input value={form} onChange={e => setForm(e.target.value)} placeholder={placeholder}
            onKeyDown={e => e.key === 'Enter' && onAdd()}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button onClick={onAdd} disabled={addLoading || !form.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            <Plus className="w-4 h-4" /> Qo'shish
          </button>
        </div>
      </div>
      <span className="text-sm text-gray-400 block">{items.length} ta {title.toLowerCase()}</span>
      <EntityList items={items} isLoading={isLoading} {...listProps} />
    </div>
  )
}

interface EntityListProps {
  isLoading: boolean
  items: any[]
  editId: string | null
  editName: string
  setEditName: (v: string) => void
  onEditStart: (item: any) => void
  onEditSave: () => void
  onEditCancel: () => void
  editLoading: boolean
  onDelete: (id: string) => void
  deleteLoading: boolean
  renderMeta?: (item: any) => React.ReactNode
}

function EntityList({ isLoading, items, editId, editName, setEditName, onEditStart, onEditSave, onEditCancel, editLoading, onDelete, renderMeta }: EntityListProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      {isLoading && <p className="px-4 py-8 text-center text-sm text-gray-400">Yuklanmoqda...</p>}
      {!isLoading && items.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">Hali hech narsa qo'shilmagan</p>}
      {items.map((item: any) => (
        <div key={item.id} className="flex items-center gap-3 px-4 py-3">
          {editId === item.id ? (
            <>
              <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                onKeyDown={e => { if (e.key === 'Enter') onEditSave(); if (e.key === 'Escape') onEditCancel() }}
                className="flex-1 px-2 py-1 text-sm border border-emerald-400 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              <button onClick={onEditSave} disabled={editLoading} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-4 h-4" /></button>
              <button onClick={onEditCancel} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
            </>
          ) : (
            <>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">{item.name}</p>
                {renderMeta && renderMeta(item)}
              </div>
              <button onClick={() => onEditStart(item)} className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function SimplePagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-2">
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">
        ← Oldingi
      </button>
      <span className="text-sm text-gray-500">{page} / {totalPages}</span>
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">
        Keyingi →
      </button>
    </div>
  )
}
