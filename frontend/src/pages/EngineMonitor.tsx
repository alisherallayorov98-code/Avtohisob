import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Cpu, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, XCircle,
  RefreshCw, ChevronDown, ChevronUp, Plus, Pencil, Trash2, Download, X,
  History, Droplets, ArrowRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

interface MonthlyTrend { month: string; cost: number; liters: number; count: number }

interface EngineRec {
  id: string; recordType: string; mileage: number; date: string
  description: string; cost: number; nextServiceMileage: number | null; performedBy: string | null
}

interface VehicleStat {
  vehicle: { id: string; registrationNumber: string; brand: string; model: string; mileage: number }
  oilRecordsCount: number
  totalOilCost12m: number
  totalOilLiters12m: number
  monthlyTrend: MonthlyTrend[]
  trendPct: number
  consecutiveTrendMonths: number
  lastOverhaul: { date: string; mileage: number } | null
  repairCount12m: number
  nextOilServiceMileage: number | null
  oilOverdueKm: number | null
  costPerKm: number | null
  fatigueLevel: 'ok' | 'warning' | 'critical'
  fatigueScore: number
  recentEngineRecords: EngineRec[]
}

const FATIGUE_CONFIG = {
  ok:       { label: 'Yaxshi',         bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  warning:  { label: 'Kuzatuv kerak',  bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-500'   },
  critical: { label: 'Charchagan!',    bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200',     dot: 'bg-red-500'     },
}

const RECORD_TYPES = [
  { value: 'overhaul',     label: 'Kapital remont' },
  { value: 'major_repair', label: "Yirik ta'mirat" },
  { value: 'minor_repair', label: "Kichik ta'mirat" },
  { value: 'inspection',   label: "Texnik ko'rik" },
]

const TYPE_LABELS: Record<string, string> = {
  overhaul: 'Kapital remont',
  major_repair: "Yirik ta'mirat",
  minor_repair: "Kichik ta'mirat",
  inspection: "Texnik ko'rik",
}

async function exportExcel() {
  try {
    const response = await api.get('/exports/engine-monitor', { responseType: 'blob' })
    const url = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `dvigatel-nazorati-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.error("Excel eksport xatoligi")
  }
}

// ── Engine Record Modal ───────────────────────────────────────────────────────
interface ModalProps {
  vehicleId: string
  vehicleLabel: string
  editRecord?: EngineRec | null
  onClose: () => void
}
function EngineRecordModal({ vehicleId, vehicleLabel, editRecord, onClose }: ModalProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    recordType: editRecord?.recordType ?? 'minor_repair',
    date: editRecord ? editRecord.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    mileage: editRecord?.mileage?.toString() ?? '',
    description: editRecord?.description ?? '',
    cost: editRecord?.cost?.toString() ?? '',
    nextServiceMileage: editRecord?.nextServiceMileage?.toString() ?? '',
    performedBy: editRecord?.performedBy ?? '',
    notes: '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const saveMut = useMutation({
    mutationFn: () => editRecord
      ? api.put(`/engine-records/${editRecord.id}`, { ...form })
      : api.post('/engine-records', { vehicleId, ...form }),
    onSuccess: () => {
      toast.success(editRecord ? 'Yozuv yangilandi' : 'Yozuv saqlandi')
      qc.invalidateQueries({ queryKey: ['engine-dashboard'] })
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-900 text-sm">
              {editRecord ? 'Yozuvni tahrirlash' : 'Yangi dvigatel yozuvi'}
            </h2>
            <p className="text-xs text-gray-500 font-mono">{vehicleLabel}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {/* Record type */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Tur *</label>
            <select value={form.recordType} onChange={e => set('recordType', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400">
              {RECORD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {/* Date + Mileage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Sana *</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Odometr (km) *</label>
              <input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)}
                placeholder="150000"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          {/* Description */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Tavsif *</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder="Nima qilingan..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
          </div>
          {/* Cost + Next service */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Narxi (so'm)</label>
              <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Keyingi xizmat (km)</label>
              <input type="number" value={form.nextServiceMileage} onChange={e => set('nextServiceMileage', e.target.value)}
                placeholder="ixtiyoriy"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          {/* Performed by */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Kim tomonidan</label>
            <input type="text" value={form.performedBy} onChange={e => set('performedBy', e.target.value)}
              placeholder="Mexanik ismi..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50">
            Bekor
          </button>
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.mileage || !form.description}
            className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saveMut.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Oil History Panel ─────────────────────────────────────────────────────────
interface OilHistoryRec {
  id: string
  installationDate: string
  installationMileage: number | null
  cost: number
  oilLiters: number | null
  notes: string | null
  oilType: 'fullChange' | 'topUp' | 'unknown'
  sparePart: { name: string } | null
}

function OilHistoryPanel({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState<string | null>(null)

  const { data, isLoading } = useQuery<OilHistoryRec[]>({
    queryKey: ['oil-history', vehicleId],
    queryFn: () => api.get(`/engine-records/oil-history?vehicleId=${vehicleId}`).then(r => r.data.data),
    staleTime: 2 * 60_000,
  })

  const markMut = useMutation({
    mutationFn: (rec: OilHistoryRec) => api.post('/engine-records/mark-oil-change', {
      vehicleId,
      servicedAtKm: rec.installationMileage,
      servicedAt: rec.installationDate,
    }),
    onSuccess: (r) => {
      toast.success(r.data.message || "Qayd etildi")
      qc.invalidateQueries({ queryKey: ['engine-dashboard'] })
      qc.invalidateQueries({ queryKey: ['oil-history', vehicleId] })
      setConfirming(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  if (isLoading) return (
    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
      <RefreshCw className="w-3 h-3 animate-spin" /> Yuklanmoqda...
    </div>
  )

  if (!data || data.length === 0) return (
    <p className="text-xs text-gray-400 py-2">
      Ta'mirlash modulida yog' yozuvlari topilmadi.
      "Yog'larni aniqlash" tugmasini bosib ko'ring.
    </p>
  )

  return (
    <div className="space-y-1.5">
      {data.map(rec => {
        const isFullChange = rec.oilType === 'fullChange'
        const isTopUp = rec.oilType === 'topUp'
        const km = rec.installationMileage

        return (
          <div key={rec.id}
            className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-50 last:border-0">
            {/* Tur belgisi */}
            <div className="shrink-0">
              {isFullChange
                ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">To'liq</span>
                : isTopUp
                ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Dalivka</span>
                : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Noma'lum</span>
              }
            </div>
            {/* Ma'lumot */}
            <div className="flex-1 min-w-0">
              <span className="text-gray-700 font-medium">
                {new Date(rec.installationDate).toLocaleDateString('uz-UZ')}
              </span>
              {km && <span className="text-gray-400 ml-2">{Number(km).toLocaleString()} km</span>}
              {rec.oilLiters != null && (
                <span className="text-gray-400 ml-2">· {rec.oilLiters} L</span>
              )}
              {rec.sparePart?.name && (
                <span className="text-gray-400 ml-1 truncate">· {rec.sparePart.name}</span>
              )}
            </div>
            <div className="shrink-0 text-right text-gray-400">
              {rec.cost > 0 && <span>{Number(rec.cost).toLocaleString()} so'm</span>}
            </div>
            {/* Import tugmasi — faqat to'liq almashtirish uchun va km bo'lsa */}
            {canEdit && (isFullChange || rec.oilType === 'unknown') && km && (
              confirming === rec.id ? (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => markMut.mutate(rec)}
                    disabled={markMut.isPending}
                    className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    <ArrowRight className="w-2.5 h-2.5" /> Ha, qo'sh
                  </button>
                  <button onClick={() => setConfirming(null)}
                    className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-lg">
                    Yo'q
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(rec.id)}
                  className="shrink-0 text-[10px] px-2 py-0.5 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50"
                >
                  Rasmiy qo'sh
                </button>
              )
            )}
          </div>
        )
      })}
      <p className="text-[10px] text-gray-400 pt-1">
        "Rasmiy qo'sh" — yog' almashtirish jadvalini shu sanadan yangilaydi.
        Faqat "To'liq" va "Noma'lum" turlari uchun ko'rinadi (Dalivka = top-up, jadvalga ta'sir qilmaydi).
      </p>
    </div>
  )
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────
function VehicleCard({ stat, canEdit, canDelete }: {
  stat: VehicleStat; canEdit: boolean; canDelete: boolean
}) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [modal, setModal] = useState<{ open: boolean; rec?: EngineRec | null }>({ open: false })
  const [showOilHistory, setShowOilHistory] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const cfg = FATIGUE_CONFIG[stat.fatigueLevel]
  const trendIcon = stat.trendPct > 10
    ? <TrendingUp className="w-3.5 h-3.5 text-red-500" />
    : stat.trendPct < -10
    ? <TrendingDown className="w-3.5 h-3.5 text-emerald-500" />
    : <Minus className="w-3.5 h-3.5 text-gray-400" />

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/engine-records/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi")
      qc.invalidateQueries({ queryKey: ['engine-dashboard'] })
      setConfirmDelete(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Oil service progress
  const oilPct = stat.nextOilServiceMileage && stat.lastOverhaul
    ? null // only show when we have the data from maintenance
    : null

  const renderOilProgress = () => {
    if (stat.oilOverdueKm === null) return null
    const overdue = stat.oilOverdueKm > 0
    const kmAbs = Math.abs(stat.oilOverdueKm)

    if (!stat.nextOilServiceMileage) return null

    // Progress: 0 = just changed, 1 = at due point, >1 = overdue
    const interval = stat.nextOilServiceMileage - (stat.nextOilServiceMileage - 7000) // approx
    const rawPct = stat.oilOverdueKm < 0
      ? Math.max(0, Math.min(100, 100 - Math.round((kmAbs / 7000) * 100)))
      : 100

    return (
      <div className="px-4 py-2 border-t border-gray-50">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-gray-500">Yog' almashtirish</span>
          <span className={`text-[11px] font-semibold ${overdue ? 'text-red-600' : 'text-emerald-600'}`}>
            {overdue ? `${kmAbs.toLocaleString()} km o'tib ketdi!` : `${kmAbs.toLocaleString()} km qoldi`}
          </span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${overdue ? 'bg-red-500' : rawPct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
            style={{ width: `${overdue ? 100 : rawPct}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-0.5">
          Keyingi almashtirish: {stat.nextOilServiceMileage.toLocaleString()} km
        </p>
      </div>
    )
  }

  return (
    <>
      {modal.open && (
        <EngineRecordModal
          vehicleId={stat.vehicle.id}
          vehicleLabel={`${stat.vehicle.registrationNumber} — ${stat.vehicle.brand} ${stat.vehicle.model}`}
          editRecord={modal.rec}
          onClose={() => setModal({ open: false })}
        />
      )}

      <div className={`bg-white rounded-xl border ${cfg.border} overflow-hidden`}>
        {/* Header */}
        <div
          className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:opacity-90 ${cfg.bg}`}
          onClick={() => setExpanded(v => !v)}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
            <div className="min-w-0">
              <p className="font-mono font-bold text-gray-900">{stat.vehicle.registrationNumber}</p>
              <p className="text-xs text-gray-500 truncate">{stat.vehicle.brand} {stat.vehicle.model}</p>
            </div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border} shrink-0`}>
              {cfg.label}
            </span>
            {stat.consecutiveTrendMonths >= 3 && (
              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full shrink-0">
                {stat.consecutiveTrendMonths} oy ↑
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-1 text-xs text-gray-600">
              {trendIcon}
              <span className={stat.trendPct > 10 ? 'text-red-600 font-semibold' : stat.trendPct < -10 ? 'text-emerald-600' : 'text-gray-500'}>
                {stat.trendPct > 0 ? '+' : ''}{stat.trendPct}%
              </span>
            </div>
            {canEdit && (
              <button
                onClick={e => { e.stopPropagation(); setModal({ open: true, rec: null }) }}
                className="p-1 rounded-lg hover:bg-white/60 text-gray-500 hover:text-blue-600 transition-colors"
                title="Yangi yozuv qo'shish"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
          {[
            { label: "Yog' xarajati (12 oy)", value: stat.totalOilCost12m > 0 ? `${stat.totalOilCost12m.toLocaleString()} so'm` : '—' },
            { label: "Yog' hajmi (12 oy)", value: stat.totalOilLiters12m > 0 ? `${stat.totalOilLiters12m} litr` : '—' },
            { label: 'Remont (12 oy)', value: stat.repairCount12m > 0 ? `${stat.repairCount12m} ta` : '0' },
            {
              label: 'Oxirgi kapital remont',
              value: stat.lastOverhaul ? new Date(stat.lastOverhaul.date).toLocaleDateString('uz-UZ') : "Yo'q",
            },
          ].map((item, i) => (
            <div key={i} className="bg-white px-3 py-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">{item.label}</p>
              <p className="text-sm font-semibold text-gray-800 mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Oil service progress */}
        {renderOilProgress()}

        {/* Expanded */}
        {expanded && (
          <div className="px-4 py-3 space-y-4 border-t border-gray-100">

            {/* Cost per km */}
            {stat.costPerKm !== null && (
              <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-gray-400">1 km uchun yog' xarajati:</span>
                <span className="font-semibold text-gray-800">{stat.costPerKm.toLocaleString()} so'm/km</span>
              </div>
            )}

            {/* Monthly trend bars */}
            {stat.monthlyTrend.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Oylik yog' xarajati (so'm)</p>
                <div className="flex items-end gap-1 overflow-x-auto pb-1">
                  {stat.monthlyTrend.map((t, i) => {
                    const max = Math.max(...stat.monthlyTrend.map(m => m.cost), 1)
                    const h = Math.max(4, Math.round(t.cost / max * 64))
                    return (
                      <div key={i} className="flex flex-col items-center gap-0.5 shrink-0">
                        <span className="text-[9px] text-gray-400">{t.cost > 0 ? (t.cost / 1000).toFixed(0) + 'k' : ''}</span>
                        <div
                          className={`w-6 rounded-sm ${t.cost > max * 0.7 ? 'bg-red-400' : t.cost > max * 0.4 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ height: `${h}px` }}
                          title={`${t.liters > 0 ? t.liters + 'L · ' : ''}${t.cost.toLocaleString()} so'm`}
                        />
                        <span className="text-[9px] text-gray-400">{t.month.slice(5)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Engine records */}
            {stat.recentEngineRecords.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Dvigatel ta'mirlash tarixi</p>
                <div className="space-y-1.5">
                  {stat.recentEngineRecords.map(r => (
                    <div key={r.id} className="flex items-start gap-3 text-xs py-1.5 border-b border-gray-50 last:border-0">
                      <div className="shrink-0 mt-0.5">
                        {r.recordType === 'overhaul' ? <XCircle className="w-3.5 h-3.5 text-red-500" />
                          : r.recordType === 'major_repair' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          : <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-800">{TYPE_LABELS[r.recordType] || r.recordType}</span>
                        <span className="text-gray-400 ml-2">{new Date(r.date).toLocaleDateString('uz-UZ')}</span>
                        {r.performedBy && <span className="text-gray-400 ml-2">· {r.performedBy}</span>}
                        <p className="text-gray-500 truncate">{r.description}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-gray-600 font-medium">{Number(r.mileage).toLocaleString()} km</p>
                        {r.cost > 0 && <p className="text-gray-400">{Number(r.cost).toLocaleString()} so'm</p>}
                      </div>
                      {/* Edit / Delete buttons */}
                      {(canEdit || canDelete) && (
                        <div className="shrink-0 flex gap-1 ml-1">
                          {canEdit && (
                            <button
                              onClick={() => setModal({ open: true, rec: r })}
                              className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                          {canDelete && (
                            confirmDelete === r.id ? (
                              <div className="flex gap-1 items-center">
                                <button
                                  onClick={() => deleteMut.mutate(r.id)}
                                  disabled={deleteMut.isPending}
                                  className="text-[10px] px-1.5 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                                >
                                  Ha
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
                                >
                                  Yo'q
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(r.id)}
                                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state for engine records */}
            {stat.recentEngineRecords.length === 0 && canEdit && (
              <div className="text-center py-4 text-gray-400 text-xs">
                <p>Dvigatel yozuvlari yo'q</p>
                <button onClick={() => setModal({ open: true, rec: null })}
                  className="mt-1 text-blue-500 hover:underline">+ Yozuv qo'shish</button>
              </div>
            )}

            {/* Tarixiy yog' yozuvlari (Ta'mirlash modulidan import) */}
            <div className="border-t border-gray-100 pt-3">
              <button
                onClick={() => setShowOilHistory(v => !v)}
                className="flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                <span>Ta'mirlash tarixidan yog' yozuvlari</span>
                <span className="ml-auto text-gray-300">{showOilHistory ? '▲' : '▼'}</span>
              </button>

              {showOilHistory && (
                <div className="mt-2">
                  <div className="flex items-center gap-3 mb-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                    <Droplets className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <p className="text-[10px] text-amber-700 leading-relaxed">
                      <strong>To'liq almashtirish</strong> (≥3L) = yog' jadvalini yangilaydi. &nbsp;
                      <strong>Dalivka</strong> (&lt;3L) = faqat ko'rsatiladi, jadvalga ta'sir qilmaydi.
                    </p>
                  </div>
                  <OilHistoryPanel vehicleId={stat.vehicle.id} canEdit={canEdit} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EngineMonitor() {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role ?? '')
  const canEdit = ['super_admin', 'admin', 'manager', 'branch_manager'].includes(role)
  const canDelete = ['super_admin', 'admin', 'manager'].includes(role)

  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'ok'>('all')
  const [search, setSearch] = useState('')

  const { data: stats, isLoading, refetch } = useQuery<VehicleStat[]>({
    queryKey: ['engine-dashboard'],
    queryFn: () => api.get('/engine-records/dashboard').then(r => r.data.data),
    staleTime: 5 * 60_000,
  })

  const detectMut = useMutation({
    mutationFn: () => api.post('/engine-records/detect-oil'),
    onSuccess: (r) => {
      toast.success(`${r.data.data.updated} ta yog' yozuvi aniqlandi`)
      qc.invalidateQueries({ queryKey: ['engine-dashboard'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const filtered = (stats || []).filter(s => {
    if (filter !== 'all' && s.fatigueLevel !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return s.vehicle.registrationNumber.toLowerCase().includes(q) ||
        `${s.vehicle.brand} ${s.vehicle.model}`.toLowerCase().includes(q)
    }
    return true
  })

  const summary = stats ? {
    critical: stats.filter(s => s.fatigueLevel === 'critical').length,
    warning:  stats.filter(s => s.fatigueLevel === 'warning').length,
    ok:       stats.filter(s => s.fatigueLevel === 'ok').length,
    totalCost: stats.reduce((s, v) => s + v.totalOilCost12m, 0),
    overdueCount: stats.filter(s => s.oilOverdueKm !== null && s.oilOverdueKm > 0).length,
  } : null

  return (
    <div className="p-5 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-600" /> Dvigatel nazorati
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Yog' sarfi trendi va ta'mirlash tarixi asosida dvigatel holati
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {stats && stats.length > 0 && (
            <button onClick={exportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
          )}
          {canEdit && (
            <button onClick={() => detectMut.mutate()} disabled={detectMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
              {detectMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Yog'larni aniqlash
            </button>
          )}
          <button onClick={() => refetch()}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-500">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([
            { key: 'critical', label: 'Charchagan',    count: summary.critical,    bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200'     },
            { key: 'warning',  label: 'Kuzatuv kerak', count: summary.warning,     bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
            { key: 'ok',       label: 'Yaxshi',        count: summary.ok,          bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
          ] as const).map(item => (
            <div key={item.key}
              onClick={() => setFilter(f => f === item.key ? 'all' : item.key)}
              className={`${item.bg} border ${item.border} rounded-xl p-3 text-center cursor-pointer hover:opacity-80 transition-opacity ${filter === item.key ? 'ring-2 ring-blue-400' : ''}`}>
              <p className={`text-2xl font-bold ${item.text}`}>{item.count}</p>
              <p className={`text-xs ${item.text} mt-0.5`}>{item.label}</p>
            </div>
          ))}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center col-span-1">
            <p className="text-lg font-bold text-blue-700 leading-tight">
              {(summary.totalCost / 1_000_000).toFixed(1)}M
            </p>
            <p className="text-xs text-blue-600 mt-0.5">Jami yog' (12oy)</p>
          </div>
          <div
            onClick={() => setFilter(f => f === 'all' ? 'all' : 'all')}
            className={`${summary.overdueCount > 0 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'} border rounded-xl p-3 text-center col-span-1`}>
            <p className={`text-2xl font-bold ${summary.overdueCount > 0 ? 'text-orange-700' : 'text-gray-500'}`}>
              {summary.overdueCount}
            </p>
            <p className={`text-xs mt-0.5 ${summary.overdueCount > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
              Yog' muddati o'tgan
            </p>
          </div>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Mashina raqami yoki nomi..."
          className="flex-1 min-w-40 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
            Filtrni tozalash ✕
          </button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Yuklanmoqda...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          {stats?.length === 0 ? 'Mashina topilmadi' : "Qidiruv natijasi yo'q"}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered
            .sort((a, b) => b.fatigueScore - a.fatigueScore)
            .map(s => (
              <VehicleCard key={s.vehicle.id} stat={s} canEdit={canEdit} canDelete={canDelete} />
            ))}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        Charchaganlik indeksi: yog' sarfi oshishi · remont chastotasi · yog' muddati · 100k+ km
      </p>
    </div>
  )
}
