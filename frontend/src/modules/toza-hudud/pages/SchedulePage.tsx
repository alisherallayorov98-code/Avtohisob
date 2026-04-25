import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import api from '../../../lib/api'

const DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']
const DAYS_FULL = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba']

export default function SchedulePage() {
  const qc = useQueryClient()
  const [branchFilter, setBranchFilter] = useState('')
  const [modal, setModal] = useState<{ vehicleId: string; vehicleName: string; mfyId: string; mfyName: string; days: number[] } | null>(null)

  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: vehicles } = useQuery({
    queryKey: ['th-vehicles', branchFilter],
    queryFn: () => api.get('/vehicles', {
      params: { branchId: branchFilter || undefined, limit: 200, status: 'active' }
    }).then(r => r.data.data),
  })

  const { data: mfys } = useQuery({
    queryKey: ['th-mfys-sched', branchFilter],
    queryFn: () => api.get('/th/mfys', { params: { limit: 500 } }).then(r => r.data.data),
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

  // vehicleId + mfyId bo'yicha schedule topish
  const getSchedule = (vehicleId: string, mfyId: string) =>
    (schedules || []).find((s: any) => s.vehicleId === vehicleId && s.mfyId === mfyId)

  // Mashinaning barcha MFYlari (schedule bo'lganlari)
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

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Haftalik grafik</h1>
        <p className="text-sm text-gray-500 mt-0.5">Mashina × MFY × Kun biriktiruvi</p>
      </div>

      {/* Filtr */}
      <div className="flex gap-3 items-center flex-wrap">
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="">Barcha filiallar</option>
          {(branches || []).map((b: any) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <span className="text-sm text-gray-400">{(vehicles || []).length} ta mashina</span>
      </div>

      {/* Jadval */}
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
              {(vehicles || []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    Mashinalar topilmadi
                  </td>
                </tr>
              )}
              {(vehicles || []).map((v: any) => {
                const vehicleMfys = getVehicleMfys(v.id)
                return (
                  <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3 sticky left-0 bg-white z-10 border-r border-gray-100">
                      <p className="font-medium text-gray-800 font-mono text-xs">{v.registrationNumber}</p>
                      <p className="text-xs text-gray-400">{v.brand} {v.model}</p>
                    </td>
                    {DAYS.map((_, dayIdx) => {
                      const daySchedules = vehicleMfys.filter((s: any) => s.dayOfWeek?.includes(dayIdx))
                      return (
                        <td key={dayIdx} className="px-2 py-2 text-center align-top">
                          <div className="space-y-1 min-h-[32px]">
                            {daySchedules.map((s: any) => (
                              <button
                                key={s.mfyId}
                                onClick={() => openModal(v.id, v.registrationNumber, s.mfyId, s.mfy?.name || '')}
                                className="w-full text-left px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs hover:bg-emerald-200 transition-colors truncate block"
                                title={s.mfy?.name}
                              >
                                {s.mfy?.name}
                              </button>
                            ))}
                            <MfyPicker
                              mfys={mfys || []}
                              existingMfyIds={vehicleMfys.map((s: any) => s.mfyId)}
                              onPick={(mfyId, mfyName) => openModal(v.id, v.registrationNumber, mfyId, mfyName)}
                            />
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

// Yangi MFY qo'shish uchun mini dropdown
function MfyPicker({ mfys, existingMfyIds, onPick }: {
  mfys: any[]; existingMfyIds: string[]
  onPick: (mfyId: string, mfyName: string) => void
}) {
  const [open, setOpen] = useState(false)
  const available = mfys.filter((m: any) => !existingMfyIds.includes(m.id))

  if (available.length === 0) return null

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="w-full py-0.5 text-gray-400 hover:text-emerald-600 text-xs hover:bg-emerald-50 rounded transition-colors">
        + qo'shish
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg w-44 max-h-48 overflow-y-auto mt-0.5">
            {available.map((m: any) => (
              <button key={m.id}
                onClick={() => { onPick(m.id, m.name); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors">
                {m.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
