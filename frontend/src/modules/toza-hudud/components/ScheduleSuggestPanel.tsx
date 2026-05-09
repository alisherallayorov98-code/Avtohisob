import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { X, Sparkles, Plus, Trash2, Save, Loader2, ChevronDown } from 'lucide-react'
import api from '../../../lib/api'

const DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']

interface Vehicle { id: string; registrationNumber: string; brand: string; model: string }
interface Mfy { id: string; name: string; district?: { name: string } }

interface EditRow {
  _id: string   // local key
  vehicleId: string
  mfyId: string
  days: number[]
  reason?: string
}

interface Props {
  vehicles: Vehicle[]
  mfys: Mfy[]
  onClose: () => void
}

let _rowId = 0
function newRow(vehicleId = '', mfyId = '', days: number[] = [0, 2], reason?: string): EditRow {
  return { _id: String(++_rowId), vehicleId, mfyId, days, reason }
}

// MFY dropdown — tuman guruhlash bilan
function MfySelect({ value, onChange, mfys }: {
  value: string; onChange: (id: string) => void; mfys: Mfy[]
}) {
  const grouped = mfys.reduce<Record<string, Mfy[]>>((acc, m) => {
    const d = m.district?.name || 'Boshqa'
    ;(acc[d] = acc[d] || []).push(m)
    return acc
  }, {})

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
    >
      <option value="">MFY tanlang...</option>
      {Object.entries(grouped).map(([district, list]) => (
        <optgroup key={district} label={district}>
          {list.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export default function ScheduleSuggestPanel({ vehicles, mfys, onClose }: Props) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<EditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [mfySearch, setMfySearch] = useState('')

  const filteredVehicles = vehicleSearch
    ? vehicles.filter(v => v.registrationNumber.toLowerCase().includes(vehicleSearch.toLowerCase()))
    : vehicles

  const filteredMfys = mfySearch
    ? mfys.filter(m => m.name.toLowerCase().includes(mfySearch.toLowerCase()))
    : mfys

  // GPS tarixidan taklif yuklash
  const loadSuggestions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/th/schedules/suggest')
      const suggestions: Array<{ vehicleId: string; mfyId: string; dayOfWeek: number[]; reason: string }> = res.data.data
      if (!suggestions || suggestions.length === 0) {
        toast('Taklif topilmadi — avval MFY va mashinalar kiritilsin', { icon: '⚠️' })
        return
      }
      setRows(suggestions.map(s => newRow(s.vehicleId, s.mfyId, s.dayOfWeek, s.reason)))
      toast.success(`${suggestions.length} ta taklif yuklandi`)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Yuklab bo\'lmadi')
    } finally {
      setLoading(false)
    }
  }, [])

  // Saqlash
  const saveMut = useMutation({
    mutationFn: () => api.post('/th/schedules/bulk', {
      schedules: rows
        .filter(r => r.vehicleId && r.mfyId && r.days.length > 0)
        .map(r => ({ vehicleId: r.vehicleId, mfyId: r.mfyId, dayOfWeek: r.days }))
    }),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Saqlandi')
      qc.invalidateQueries({ queryKey: ['th-schedules'] })
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const updateRow = (id: string, patch: Partial<EditRow>) =>
    setRows(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r))

  const toggleDay = (rowId: string, day: number) =>
    setRows(prev => prev.map(r => r._id === rowId
      ? { ...r, days: r.days.includes(day) ? r.days.filter(d => d !== day) : [...r.days, day].sort() }
      : r
    ))

  const removeRow = (id: string) => setRows(prev => prev.filter(r => r._id !== id))
  const addRow = () => setRows(prev => [...prev, newRow()])

  const validRows = rows.filter(r => r.vehicleId && r.mfyId && r.days.length > 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-end">
      <div className="w-full max-w-4xl bg-white flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0 bg-emerald-900 text-white">
          <div>
            <h2 className="font-bold text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-300" />
              Jadval taklifi va tahriri
            </h2>
            <p className="text-xs text-emerald-300 mt-0.5">
              Taklifni yuklang, tahrirlang, keyin saqlang
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-emerald-800 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 shrink-0 flex-wrap">
          <button
            onClick={loadSuggestions}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-xl hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? 'Yuklanmoqda...' : 'GPS tarixidan taklif olish'}
          </button>

          <button
            onClick={addRow}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
          >
            <Plus className="w-4 h-4" />
            Yangi qator
          </button>

          <div className="flex-1" />

          {rows.length > 0 && (
            <span className="text-xs text-gray-500">
              {validRows.length} / {rows.length} ta tayyor
            </span>
          )}

          <button
            onClick={() => saveMut.mutate()}
            disabled={validRows.length === 0 || saveMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-40"
          >
            {saveMut.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Save className="w-4 h-4" />}
            {saveMut.isPending ? 'Saqlanmoqda...' : `${validRows.length} ta saqlash`}
          </button>
        </div>

        {/* Filter bar */}
        {rows.length > 0 && (
          <div className="flex gap-2 px-5 py-2 border-b border-gray-100 shrink-0">
            <input
              placeholder="Mashina raqami..."
              value={vehicleSearch}
              onChange={e => setVehicleSearch(e.target.value)}
              className="w-44 px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <input
              placeholder="MFY nomi..."
              value={mfySearch}
              onChange={e => setMfySearch(e.target.value)}
              className="w-44 px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {(vehicleSearch || mfySearch) && (
              <button
                onClick={() => { setVehicleSearch(''); setMfySearch('') }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Tozalash
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4 py-20">
              <Sparkles className="w-12 h-12 text-emerald-200" />
              <p className="text-sm text-center max-w-xs">
                "GPS tarixidan taklif olish" tugmasini bosing — tizim avtomatik jadval taklif qiladi.
                Keyin tahrirlashingiz mumkin.
              </p>
              <button
                onClick={loadSuggestions}
                disabled={loading}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 text-white text-sm rounded-xl hover:bg-emerald-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Taklif olish
              </button>
            </div>
          ) : (
            <div>
              {/* Table header */}
              <div className="grid grid-cols-[2fr_2fr_auto_auto] gap-2 px-5 py-2 bg-gray-50 border-b border-gray-200 sticky top-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mashina</p>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">MFY</p>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Kunlar</p>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-8" />
              </div>

              {/* Rows */}
              {rows
                .filter(r => {
                  if (vehicleSearch) {
                    const v = vehicles.find(v => v.id === r.vehicleId)
                    if (!v || !v.registrationNumber.toLowerCase().includes(vehicleSearch.toLowerCase())) return false
                  }
                  if (mfySearch) {
                    const m = mfys.find(m => m.id === r.mfyId)
                    if (!m || !m.name.toLowerCase().includes(mfySearch.toLowerCase())) return false
                  }
                  return true
                })
                .map(row => (
                  <div
                    key={row._id}
                    className={`grid grid-cols-[2fr_2fr_auto_auto] gap-2 px-5 py-2.5 border-b border-gray-50 hover:bg-gray-50/80 items-center ${
                      !row.vehicleId || !row.mfyId || row.days.length === 0 ? 'bg-red-50/30' : ''
                    }`}
                  >
                    {/* Vehicle */}
                    <div className="relative">
                      <select
                        value={row.vehicleId}
                        onChange={e => updateRow(row._id, { vehicleId: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white appearance-none pr-6"
                      >
                        <option value="">Mashina tanlang...</option>
                        {filteredVehicles.map(v => (
                          <option key={v.id} value={v.id}>
                            {v.registrationNumber} — {v.brand} {v.model}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                    </div>

                    {/* MFY */}
                    <MfySelect value={row.mfyId} onChange={id => updateRow(row._id, { mfyId: id })} mfys={filteredMfys} />

                    {/* Days */}
                    <div className="flex gap-0.5">
                      {DAYS.map((d, i) => (
                        <button
                          key={i}
                          onClick={() => toggleDay(row._id, i)}
                          className={`w-7 h-7 text-[10px] font-semibold rounded transition-colors ${
                            row.days.includes(i)
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                          title={d}
                        >
                          {d}
                        </button>
                      ))}
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => removeRow(row._id)}
                      className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors w-8"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

              {/* Add row footer */}
              <div className="px-5 py-3">
                <button
                  onClick={addRow}
                  className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Yangi qator qo'shish
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 shrink-0 flex items-center justify-between bg-gray-50">
          <p className="text-xs text-gray-400">
            To'liq bo'lmagan qatorlar (mashina yoki MFY tanlanmagan) saqlanmaydi
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-xl hover:bg-gray-100">
              Yopish
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={validRows.length === 0 || saveMut.isPending}
              className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-40"
            >
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {validRows.length} ta jadval saqlash
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
