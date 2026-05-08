import { useState, useRef, useMemo, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { X, Download, Upload, LayoutGrid, List, Check, Trash2 } from 'lucide-react'
import api from '../../../lib/api'

const DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']
const DAYS_FULL = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba']

type ViewMode = 'vehicle' | 'mfy'

export default function SchedulePage() {
  const qc = useQueryClient()
  const [viewMode, setViewMode] = useState<ViewMode>('vehicle')
  const [branchFilter, setBranchFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [modal, setModal] = useState<{
    vehicleId: string; vehicleName: string
    mfyId: string; mfyName: string; days: number[]
  } | null>(null)
  const [importResult, setImportResult] = useState<{
    imported: number; updated: number; deleted: number
    errors: Array<{ row: number; reason: string }>; totalRows: number
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: districts } = useQuery({
    queryKey: ['th-districts-sched'],
    queryFn: () => api.get('/th/districts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: vehicles } = useQuery({
    queryKey: ['th-vehicles', branchFilter],
    queryFn: () => api.get('/vehicles', {
      params: { branchId: branchFilter || undefined, limit: 500, status: 'active' }
    }).then(r => r.data.data),
  })

  // Barcha MFYlar — districtFilter bo'yicha serverda filtrlash
  const { data: mfys } = useQuery({
    queryKey: ['th-mfys-sched', districtFilter],
    queryFn: () => api.get('/th/mfys', {
      params: { limit: 2000, districtId: districtFilter || undefined },
    }).then(r => r.data.data),
  })

  const { data: schedules } = useQuery({
    queryKey: ['th-schedules', branchFilter],
    queryFn: () => api.get('/th/schedules', {
      params: { branchId: branchFilter || undefined }
    }).then(r => r.data.data),
  })

  const upsertMut = useMutation({
    mutationFn: (body: { vehicleId: string; mfyId: string; dayOfWeek: number[] }) =>
      api.post('/th/schedules', body),
    onSuccess: () => {
      toast.success('Jadval saqlandi')
      qc.invalidateQueries({ queryKey: ['th-schedules'] })
      setModal(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const importMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post('/th/schedules/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: (res) => {
      toast.success(res.data.message)
      setImportResult(res.data.data)
      qc.invalidateQueries({ queryKey: ['th-schedules'] })
      if (fileRef.current) fileRef.current.value = ''
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Schedule lookup helpers
  const getSchedule = (vehicleId: string, mfyId: string) =>
    (schedules || []).find((s: any) => s.vehicleId === vehicleId && s.mfyId === mfyId)

  const getVehicleMfys = (vehicleId: string) =>
    (schedules || []).filter((s: any) => s.vehicleId === vehicleId)

  const openModal = (vehicleId: string, vehicleName: string, mfyId: string, mfyName: string) => {
    const existing = getSchedule(vehicleId, mfyId)
    setModal({ vehicleId, vehicleName, mfyId, mfyName, days: existing?.dayOfWeek || [] })
  }

  const toggleDay = (day: number) => {
    if (!modal) return
    setModal(m => m ? ({
      ...m,
      days: m.days.includes(day) ? m.days.filter(d => d !== day) : [...m.days, day].sort()
    }) : m)
  }

  const saveModal = () => {
    if (!modal) return
    upsertMut.mutate({ vehicleId: modal.vehicleId, mfyId: modal.mfyId, dayOfWeek: modal.days })
  }

  // Tuman filtriga ko'ra schedule'larni filtrlaymiz
  const filteredSchedules = useMemo(() => {
    if (!districtFilter) return schedules || []
    return (schedules || []).filter((s: any) => s.mfy?.district?.id === districtFilter)
  }, [schedules, districtFilter])

  // Tanlangan tuman bo'yicha MFY hisob
  const districtMfyCount = districtFilter
    ? (mfys || []).length
    : (mfys || []).length

  // Mashina ko'rinishi: vehicle → tuman filtri bo'yicha filtrlangan jadvallar
  const vehicleRows = useMemo(() => {
    const vList = vehicles || []
    if (!districtFilter) return vList
    // Faqat shu tumanda topshirig'i bor mashinalarni ko'rsatamiz
    const vehiclesWithAssignments = new Set(filteredSchedules.map((s: any) => s.vehicleId))
    return vList.filter((v: any) => vehiclesWithAssignments.has(v.id))
  }, [vehicles, filteredSchedules, districtFilter])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) importMut.mutate(file)
  }

  const activeDistrictName = districts
    ? (districts as any[]).find((d: any) => d.id === districtFilter)?.name
    : null

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Haftalik grafik</h1>
          <p className="text-sm text-gray-500 mt-0.5">Mashina × MFY × Kun biriktiruvi</p>
        </div>
        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('vehicle')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              viewMode === 'vehicle' ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <List className="w-3.5 h-3.5" /> Mashina ko'rinishi
          </button>
          <button
            onClick={() => setViewMode('mfy')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              viewMode === 'mfy' ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> MFY ko'rinishi
          </button>
        </div>
      </div>

      {/* Filtrlar */}
      <div className="flex gap-3 items-center flex-wrap">
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="">Barcha filiallar</option>
          {(branches || []).map((b: any) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        <select value={districtFilter} onChange={e => setDistrictFilter(e.target.value)}
          className={`px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
            districtFilter ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-medium' : 'border-gray-300'
          }`}>
          <option value="">Barcha tumanlar</option>
          {(districts || []).map((d: any) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        {districtFilter && (
          <button
            onClick={() => setDistrictFilter('')}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-emerald-700 bg-emerald-100 rounded-lg hover:bg-emerald-200"
          >
            <X className="w-3 h-3" /> Filterni tozalash
          </button>
        )}

        <span className="text-sm text-gray-400">
          {viewMode === 'vehicle'
            ? `${vehicleRows.length} mashina · ${districtMfyCount} MFY`
            : `${(mfys || []).length} MFY · ${(vehicles || []).length} mashina`}
          {districtFilter && activeDistrictName && (
            <span className="ml-1 text-emerald-600">({activeDistrictName})</span>
          )}
        </span>

        <div className="flex-1" />

        <a
          href="/api/th/schedules/template"
          download
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50"
        >
          <Download className="w-3.5 h-3.5" /> Shablon yuklab olish
        </a>
        <label className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
          importMut.isPending ? 'bg-gray-200 text-gray-400 cursor-wait' : 'bg-emerald-600 text-white hover:bg-emerald-700'
        }`}>
          <Upload className="w-3.5 h-3.5" />
          {importMut.isPending ? 'Yuklanmoqda...' : 'Excel yuklash'}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={handleFileChange} disabled={importMut.isPending} />
        </label>
      </div>

      {/* Import natijasi */}
      {importResult && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Excel import natijasi</p>
            <button onClick={() => setImportResult(null)} className="p-1 hover:bg-gray-100 rounded">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="bg-emerald-50 rounded-lg p-2 text-center">
              <p className="text-emerald-700 font-bold text-lg">{importResult.imported}</p>
              <p className="text-emerald-600">Qo'shildi</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-2 text-center">
              <p className="text-blue-700 font-bold text-lg">{importResult.updated}</p>
              <p className="text-blue-600">Yangilandi</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2 text-center">
              <p className="text-gray-700 font-bold text-lg">{importResult.deleted}</p>
              <p className="text-gray-600">O'chirildi</p>
            </div>
            <div className="bg-red-50 rounded-lg p-2 text-center">
              <p className="text-red-700 font-bold text-lg">{importResult.errors.length}</p>
              <p className="text-red-600">Xato</p>
            </div>
          </div>
          {importResult.errors.length > 0 && (
            <div className="border border-red-200 rounded-lg p-2 bg-red-50/30 max-h-40 overflow-y-auto">
              <p className="text-xs font-semibold text-red-700 mb-1">Xatolar:</p>
              {importResult.errors.slice(0, 50).map((e, i) => (
                <p key={i} className="text-xs text-red-600">Qator {e.row}: {e.reason}</p>
              ))}
              {importResult.errors.length > 50 && (
                <p className="text-xs text-red-500 mt-1">va yana {importResult.errors.length - 50} ta...</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Jadval */}
      {viewMode === 'vehicle' ? (
        <VehicleView
          vehicles={vehicleRows}
          mfys={mfys || []}
          filteredSchedules={filteredSchedules}
          allSchedules={schedules || []}
          districtFilter={districtFilter}
          onOpenModal={openModal}
        />
      ) : (
        <MfyView
          mfys={mfys || []}
          vehicles={vehicles || []}
          schedules={schedules || []}
          onOpenModal={openModal}
        />
      )}

      {/* ── Bayram kunlari ── */}
      <HolidaysPanel />

      {/* ── AI Jadval taklifi ── */}
      <SuggestPanel onApply={(s) => {
        upsertMut.mutate({ vehicleId: s.vehicleId, mfyId: s.mfyId, dayOfWeek: s.dayOfWeek })
      }} />

      {/* Modal — kun tanlash */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <p className="font-semibold text-gray-800">{modal.mfyName}</p>
                <p className="text-xs text-gray-400">{modal.vehicleName}</p>
              </div>
              <button onClick={() => setModal(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 mb-3">Xizmat ko'rsatish kunlarini tanlang:</p>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((d, i) => (
                  <button key={i} onClick={() => toggleDay(i)}
                    className={`py-2 rounded-lg text-xs font-medium transition-colors ${
                      modal.days.includes(i)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    {d}
                  </button>
                ))}
              </div>
              {modal.days.length > 0 && (
                <p className="text-xs text-emerald-600 mt-2">
                  Tanlangan: {modal.days.map(d => DAYS_FULL[d]).join(', ')}
                </p>
              )}
              {modal.days.length === 0 && (
                <p className="text-xs text-red-500 mt-2">Kun tanlanmasa — jadvaldan o'chiriladi</p>
              )}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
              <button onClick={() => setModal(null)}
                className="flex-1 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Bekor
              </button>
              <button onClick={saveModal} disabled={upsertMut.isPending}
                className="flex-1 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {upsertMut.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Mashina ko'rinishi: Rows=Vehicles, Columns=Days, Cells=MFYlar ─────────────

function VehicleView({ vehicles, mfys, filteredSchedules, allSchedules, districtFilter, onOpenModal }: {
  vehicles: any[]
  mfys: any[]
  filteredSchedules: any[]
  allSchedules: any[]
  districtFilter: string
  onOpenModal: (vehicleId: string, vehicleName: string, mfyId: string, mfyName: string) => void
}) {
  const qc = useQueryClient()

  const deleteMut = useMutation({
    mutationFn: ({ vehicleId, mfyId }: { vehicleId: string; mfyId: string }) =>
      api.post('/th/schedules', { vehicleId, mfyId, dayOfWeek: [] }),
    onSuccess: () => {
      toast.success("Jadvaldan o'chirildi")
      qc.invalidateQueries({ queryKey: ['th-schedules'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // vehicleId → uning barcha schedularalari
  const scheduleByVehicle = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const s of filteredSchedules) {
      if (!map.has(s.vehicleId)) map.set(s.vehicleId, [])
      map.get(s.vehicleId)!.push(s)
    }
    return map
  }, [filteredSchedules])

  // vehicleId → barcha assigned mfyId'lar (ALL schedules, filter yo'q)
  const allMfysByVehicle = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const s of allSchedules) {
      if (!map.has(s.vehicleId)) map.set(s.vehicleId, new Set())
      map.get(s.vehicleId)!.add(s.mfyId)
    }
    return map
  }, [allSchedules])

  if (vehicles.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
        <p className="text-sm">
          {districtFilter ? 'Bu tumanda birorta mashina topilmadi' : 'Mashinalar topilmadi'}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-600 min-w-48 sticky left-0 bg-gray-50 z-10">
                Mashina
              </th>
              {DAYS.map((d, i) => (
                <th key={i} className="px-3 py-3 text-center font-medium text-gray-600 min-w-28">
                  <div>{d}</div>
                  <div className="text-xs text-gray-400 font-normal">{DAYS_FULL[i]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v: any) => {
              const vehicleScheds = scheduleByVehicle.get(v.id) || []
              const allAssigned = allMfysByVehicle.get(v.id) || new Set<string>()
              // Qo'shimcha qilish uchun mavjud bo'lgan MFYlar
              // districtFilter bo'lsa — faqat shu tumandan, aks holda hammasi
              const availableMfys = mfys.filter((m: any) => !allAssigned.has(m.id))
              const totalAssigned = allAssigned.size

              return (
                <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-3 sticky left-0 bg-white z-10 border-r border-gray-100">
                    <p className="font-medium text-gray-800 font-mono text-xs">{v.registrationNumber}</p>
                    <p className="text-xs text-gray-400">{v.brand} {v.model}</p>
                    <p className="text-[10px] text-emerald-600 mt-0.5">{totalAssigned} MFY biriktirilgan</p>
                  </td>
                  {DAYS.map((_, dayIdx) => {
                    const dayScheds = vehicleScheds.filter((s: any) => s.dayOfWeek?.includes(dayIdx))
                    return (
                      <td key={dayIdx} className="px-2 py-2 text-center align-top">
                        <div className="space-y-1 min-h-[32px]">
                          {dayScheds.map((s: any) => (
                            <div key={s.mfyId} className="relative group">
                              <button
                                onClick={() => onOpenModal(v.id, v.registrationNumber, s.mfyId, s.mfy?.name || '')}
                                className="w-full text-left px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs hover:bg-emerald-200 transition-colors truncate block pr-5"
                                title={`${s.mfy?.name}${s.mfy?.district ? ' — ' + s.mfy.district.name : ''}`}
                              >
                                {s.mfy?.name}
                              </button>
                              <button
                                onClick={() => deleteMut.mutate({ vehicleId: v.id, mfyId: s.mfyId })}
                                className="absolute right-0.5 top-0.5 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                title="O'chirish"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ))}
                          {availableMfys.length > 0 && (
                            <MfyPicker
                              mfys={availableMfys}
                              districtFilter={districtFilter}
                              onPick={(mfyId, mfyName) => onOpenModal(v.id, v.registrationNumber, mfyId, mfyName)}
                            />
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── MFY ko'rinishi: Rows=MFYlar, Columns=Mashinalar ──────────────────────────

function MfyView({ mfys, vehicles, schedules, onOpenModal }: {
  mfys: any[]
  vehicles: any[]
  schedules: any[]
  onOpenModal: (vehicleId: string, vehicleName: string, mfyId: string, mfyName: string) => void
}) {
  const qc = useQueryClient()
  const deleteMut = useMutation({
    mutationFn: ({ vehicleId, mfyId }: { vehicleId: string; mfyId: string }) =>
      api.post('/th/schedules', { vehicleId, mfyId, dayOfWeek: [] }),
    onSuccess: () => {
      toast.success("Jadvaldan o'chirildi")
      qc.invalidateQueries({ queryKey: ['th-schedules'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // mfyId + vehicleId → schedule
  const scheduleMap = useMemo(() => {
    const map = new Map<string, any>()
    for (const s of schedules) {
      map.set(`${s.vehicleId}:${s.mfyId}`, s)
    }
    return map
  }, [schedules])

  // MFYlarni tuman bo'yicha guruhlash
  const mfysByDistrict = useMemo(() => {
    const groups = new Map<string, { name: string; mfys: any[] }>()
    for (const m of mfys) {
      const distId = m.district?.id || 'unknown'
      const distName = m.district?.name || 'Noma\'lum'
      if (!groups.has(distId)) groups.set(distId, { name: distName, mfys: [] })
      groups.get(distId)!.mfys.push(m)
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [mfys])

  if (mfys.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
        <p className="text-sm">MFYlar topilmadi</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-600 min-w-52 sticky left-0 bg-gray-50 z-10">
                MFY / Tuman
              </th>
              {vehicles.map((v: any) => (
                <th key={v.id} className="px-2 py-3 text-center font-medium text-gray-600 min-w-24">
                  <div className="font-mono text-xs">{v.registrationNumber}</div>
                  <div className="text-[10px] text-gray-400 font-normal">{v.brand}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mfysByDistrict.map(({ name: distName, mfys: distMfys }) => (
              <Fragment key={distName}>
                {/* District sarlavhasi */}
                <tr className="bg-emerald-50 border-b border-emerald-100">
                  <td colSpan={vehicles.length + 1}
                    className="px-4 py-1.5 text-xs font-semibold text-emerald-800 sticky left-0">
                    📍 {distName} — {distMfys.length} ta MFY
                  </td>
                </tr>
                {distMfys.map((m: any) => (
                  <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-2 sticky left-0 bg-white z-10 border-r border-gray-100">
                      <p className="text-xs font-medium text-gray-800">{m.name}</p>
                    </td>
                    {vehicles.map((v: any) => {
                      const sched = scheduleMap.get(`${v.id}:${m.id}`)
                      return (
                        <td key={v.id} className="px-1 py-1 text-center">
                          {sched ? (
                            <div className="relative group flex flex-wrap gap-0.5 justify-center">
                              {sched.dayOfWeek.map((d: number) => (
                                <span key={d}
                                  onClick={() => onOpenModal(v.id, v.registrationNumber, m.id, m.name)}
                                  className="w-5 h-5 flex items-center justify-center bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold cursor-pointer hover:bg-emerald-200"
                                  title={DAYS_FULL[d]}
                                >
                                  {DAYS[d]}
                                </span>
                              ))}
                              <button
                                onClick={() => deleteMut.mutate({ vehicleId: v.id, mfyId: m.id })}
                                className="w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 rounded transition-all"
                                title="O'chirish"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => onOpenModal(v.id, v.registrationNumber, m.id, m.name)}
                              className="w-full h-6 text-gray-200 hover:text-emerald-500 hover:bg-emerald-50 rounded text-xs transition-colors"
                              title="Qo'shish"
                            >
                              +
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── MFY Picker: tuman bo'yicha guruhlangan ────────────────────────────────────

function MfyPicker({ mfys, districtFilter, onPick }: {
  mfys: any[]
  districtFilter: string
  onPick: (mfyId: string, mfyName: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  if (mfys.length === 0) return null

  // Qidiruv
  const filtered = search.trim()
    ? mfys.filter((m: any) =>
        m.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        m.district?.name?.toLowerCase().includes(search.trim().toLowerCase())
      )
    : mfys

  // Tuman bo'yicha guruhlash
  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; mfys: any[] }>()
    for (const m of filtered) {
      const key = m.district?.id || 'x'
      const label = m.district?.name || 'Noma\'lum'
      if (!groups.has(key)) groups.set(key, { name: label, mfys: [] })
      groups.get(key)!.mfys.push(m)
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const totalVisible = filtered.length

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(o => !o); setSearch('') }}
        className="w-full py-0.5 text-gray-400 hover:text-emerald-600 text-xs hover:bg-emerald-50 rounded transition-colors"
      >
        + qo'shish
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg w-64 max-h-72 overflow-hidden mt-0.5 flex flex-col">
            <div className="p-2 border-b border-gray-100">
              <input
                autoFocus
                type="text"
                placeholder="MFY yoki tuman qidirish..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[10px] text-gray-400 mt-1">{totalVisible} ta mavjud</p>
            </div>
            <div className="overflow-y-auto flex-1">
              {totalVisible === 0 && (
                <p className="px-3 py-3 text-xs text-gray-400 text-center">Topilmadi</p>
              )}
              {grouped.map(({ name: distName, mfys: distMfys }) => (
                <div key={distName}>
                  <div className="px-3 py-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border-b border-emerald-100 sticky top-0">
                    {distName} ({distMfys.length})
                  </div>
                  {distMfys.slice(0, 200).map((m: any) => (
                    <button key={m.id}
                      onClick={() => { onPick(m.id, m.name); setOpen(false) }}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors">
                      {m.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Bayram kunlari panel ──────────────────────────────────────────────────────
function HolidaysPanel() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ date: '', name: '' })
  const year = new Date().getFullYear()

  const { data: holidays, isLoading } = useQuery({
    queryKey: ['th-holidays', year],
    queryFn: () => api.get('/th/holidays', { params: { year } }).then(r => r.data.data),
  })

  const createMut = useMutation({
    mutationFn: () => api.post('/th/holidays', form),
    onSuccess: () => {
      toast.success("Bayram qo'shildi")
      setForm({ date: '', name: '' })
      qc.invalidateQueries({ queryKey: ['th-holidays'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/th/holidays/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi")
      qc.invalidateQueries({ queryKey: ['th-holidays'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Bayram kunlari</p>
        <p className="text-xs text-gray-400">Bayram kunlarida monitoring o'tkazib yuboriladi</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Bayram nomi..."
          className="flex-1 min-w-40 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        <button
          onClick={() => createMut.mutate()}
          disabled={!form.date || !form.name.trim() || createMut.isPending}
          className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40"
        >
          Qo'shish
        </button>
      </div>
      {isLoading ? (
        <p className="text-xs text-gray-400">Yuklanmoqda...</p>
      ) : (holidays || []).length === 0 ? (
        <p className="text-xs text-gray-400">{year} yil uchun bayram kunlari qo'shilmagan</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(holidays || []).map((h: any) => (
            <div key={h.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg text-xs">
              <span className="text-amber-800 font-medium">{new Date(h.date).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' })}</span>
              <span className="text-amber-600">{h.name}</span>
              <button onClick={() => deleteMut.mutate(h.id)} className="text-amber-400 hover:text-red-500 ml-0.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AI Jadval taklifi panel ───────────────────────────────────────────────────
function SuggestPanel({ onApply }: { onApply: (s: { vehicleId: string; mfyId: string; dayOfWeek: number[] }) => void }) {
  const [open, setOpen] = useState(false)

  const { data: suggestions, isLoading, refetch } = useQuery({
    queryKey: ['th-schedule-suggest'],
    queryFn: () => api.get('/th/schedules/suggest').then(r => r.data.data),
    enabled: open,
    staleTime: 0,
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-700">AI jadval taklifi</p>
          <p className="text-xs text-gray-400 mt-0.5">O'tgan 30 kun statistikasi asosida optimal taqsimlash</p>
        </div>
        <button
          onClick={() => { setOpen(true); refetch() }}
          className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          {isLoading ? 'Tahlil...' : 'Taklif olish'}
        </button>
      </div>
      {open && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {isLoading && <p className="text-xs text-gray-400 py-4 text-center">Tahlil qilinmoqda...</p>}
          {!isLoading && (suggestions || []).length === 0 && (
            <p className="text-xs text-gray-400 py-4 text-center">Yetarli ma'lumot topilmadi</p>
          )}
          {(suggestions || []).map((s: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 p-2 bg-indigo-50 rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 truncate">{s.mfyId}</p>
                <p className="text-[11px] text-indigo-600">{s.reason}</p>
                <p className="text-[11px] text-gray-500">Kunlar: {s.dayOfWeek.map((d: number) => DAYS[d]).join(', ')}</p>
              </div>
              <button
                onClick={() => onApply(s)}
                className="px-2.5 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shrink-0"
              >
                Qo'llash
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
