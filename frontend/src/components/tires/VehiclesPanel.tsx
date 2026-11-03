import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUp, Car, ChevronRight, CircleDot, History, Plus, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatDate, formatDateTime } from '../../lib/utils'
import {
  LEVEL_STYLE, OverviewRow, OverviewTire, POSITIONS, eventStyle, fmtKm, positionLabel, tireTitle, todayISO,
} from './tireUi'

type Filter = 'all' | 'with' | 'without' | 'attention'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Hammasi' },
  { key: 'with', label: 'Shinasi bor' },
  { key: 'without', label: "Shinasi yo'q" },
  { key: 'attention', label: 'Diqqat' },
]

const inputCls =
  'w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white ' +
  'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition'

function TireDots({ row }: { row: OverviewRow }) {
  if (!row.tires.length) return <span className="text-xs text-slate-400">shina yozilmagan</span>
  return (
    <div className="flex items-center gap-1">
      {row.tires.map(t => (
        <span key={t.id} title={`${t.serialCode} · ${t.usedPct}%`}
          className={`w-2.5 h-2.5 rounded-full ${LEVEL_STYLE[t.usageLevel].dot}`} />
      ))}
      <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">{row.tires.length} ta</span>
    </div>
  )
}

function VehicleListItem({ row, active, onClick }: { row: OverviewRow; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700/60 transition-colors ${
        active ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
      }`}>
      <div className={`w-1 self-stretch rounded-full ${active ? 'bg-blue-500' : 'bg-transparent'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-sm text-slate-900 dark:text-white">{row.vehicle.registrationNumber}</span>
          {row.criticalCount > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              {row.criticalCount} almashtirish
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{row.vehicle.brand} {row.vehicle.model}</p>
        <div className="mt-1.5"><TireDots row={row} /></div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
    </button>
  )
}

function TireCard({ tire, canEdit, onRemove, onOpen }: {
  tire: OverviewTire; canEdit: boolean; onRemove: (t: OverviewTire) => void; onOpen: (id: string) => void
}) {
  const st = LEVEL_STYLE[tire.usageLevel]
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
          <CircleDot className="w-3 h-3" /> {positionLabel(tire.position)}
        </span>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${st.chip}`}>{st.label}</span>
      </div>

      <button onClick={() => onOpen(tire.id)} className="mt-3 block text-left">
        <p className="font-mono text-lg font-bold tracking-wide text-slate-900 dark:text-white hover:text-blue-600 transition-colors">
          {tire.serialCode}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{tireTitle(tire)}</p>
      </button>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-slate-400">O'rnatilgan sana</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200">
            {tire.installationDate ? formatDate(tire.installationDate) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">O'rnatilgan paytda</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200">{fmtKm(tire.installedMileageKm)}</dd>
        </div>
      </dl>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs mb-1">
          <span className="text-slate-500 dark:text-slate-400">
            {tire.drivenSinceInstallKm != null ? `${fmtKm(tire.drivenSinceInstallKm)} yurgan` : 'Yurgan km hisoblanmadi'}
          </span>
          <span className={`font-semibold ${st.text}`}>{tire.usedPct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full ${st.bar} transition-all`} style={{ width: `${tire.usedPct}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Norma: {fmtKm(tire.standardMileageKm || 40000)}</p>
      </div>

      {canEdit && (
        <button onClick={() => onRemove(tire)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <ArrowUp className="w-3.5 h-3.5" /> Mashinadan olib olish
        </button>
      )}
    </div>
  )
}

function QuickInstall({ row, onDone }: { row: OverviewRow; onDone: () => void }) {
  const [serial, setSerial] = useState('')
  const [position, setPosition] = useState('')
  const [date, setDate] = useState(todayISO())
  const [km, setKm] = useState('')
  const [open, setOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: () => api.post('/tires/quick-install', {
      vehicleId: row.vehicle.id,
      serialCode: serial.trim(),
      position: position || undefined,
      installationDate: date || undefined,
      installedMileageKm: km === '' ? undefined : Number(km),
    }),
    onSuccess: (res) => {
      toast.success(res.data?.message || "Shina yozildi")
      setSerial(''); setPosition(''); setKm(''); setOpen(false)
      onDone()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xatolik yuz berdi', { duration: 6000 }),
  })

  const submit = () => {
    if (!serial.trim()) { toast.error('Shina raqamini kiriting'); return }
    mutation.mutate()
  }

  return (
    <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-4">
      <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">
        Shina raqamini yozish
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={serial} onChange={e => setSerial(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Masalan: 5091609750" autoComplete="off"
          className={`${inputCls} font-mono text-base tracking-wide sm:flex-1`} />
        <select value={position} onChange={e => setPosition(e.target.value)} className={`${inputCls} sm:w-44`}>
          <option value="">Joyi (ixtiyoriy)</option>
          {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <button onClick={submit} disabled={mutation.isPending}
          className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 transition-colors">
          <Plus className="w-4 h-4" /> Yozish
        </button>
      </div>

      <button onClick={() => setOpen(o => !o)} className="mt-2 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline">
        {open ? 'Qo\'shimcha maydonlarni yashirish' : "Sana va kilometrni o'zgartirish"}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">O'rnatilgan sana</label>
            <input type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">O'rnatilgan paytdagi km</label>
            <input type="number" min={0} value={km} onChange={e => setKm(e.target.value)}
              placeholder={`Hozirgi: ${Math.round(row.vehicle.currentMileage)}`} className={inputCls} />
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        Sana — bugun, km — mashinaning hozirgi ko'rsatkichi. Raqam tizimda yo'q bo'lsa, shina o'zi yaratiladi.
      </p>
    </div>
  )
}

function VehicleTimeline({ vehicleId }: { vehicleId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tire-movements', 'vehicle', vehicleId],
    queryFn: () => api.get('/tires/movements', { params: { vehicleId, limit: 30 } }).then(r => r.data.data as any[]),
  })
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
        <History className="w-4 h-4 text-slate-400" /> Shina harakati tarixi
      </h3>
      {isLoading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : !data?.length ? (
        <p className="text-sm text-slate-400">Bu mashina bo'yicha harakat hali yozilmagan.</p>
      ) : (
        <ol className="relative border-l border-slate-200 dark:border-slate-700 ml-1.5 space-y-4">
          {data.map((e: any) => {
            const s = eventStyle(e.eventType)
            return (
              <li key={e.id} className="ml-4">
                <span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white dark:ring-slate-900 ${s.dot}`} />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${s.chip}`}>{s.label}</span>
                  <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">{e.tire?.serialCode}</span>
                  {e.position && <span className="text-xs text-slate-500">· {positionLabel(e.position)}</span>}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {formatDateTime(e.createdAt)}
                  {e.mileageAtEvent != null && ` · ${fmtKm(e.mileageAtEvent)}`}
                  {e.createdBy && ` · ${e.createdBy}`}
                </p>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

interface Props {
  rows: OverviewRow[]
  loading: boolean
  canEdit: boolean
  onRemove: (tire: OverviewTire, currentMileage: number) => void
  onOpenTire: (id: string) => void
  onChanged: () => void
}

export default function VehiclesPanel({ rows, loading, canEdit, onRemove, onOpenTire, onChanged }: Props) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (q && !(`${r.vehicle.registrationNumber} ${r.vehicle.brand} ${r.vehicle.model}`.toLowerCase().includes(q))) return false
      if (filter === 'with') return r.tires.length > 0
      if (filter === 'without') return r.tires.length === 0
      if (filter === 'attention') return r.criticalCount + r.warningCount > 0
      return true
    })
  }, [rows, search, filter])

  const selected = rows.find(r => r.vehicle.id === selectedId) || null

  const refresh = () => {
    onChanged()
    qc.invalidateQueries({ queryKey: ['tire-movements'] })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-4 items-start">
      {/* Chap: mashinalar ro'yxati */}
      <div className={`${selected ? 'hidden lg:block' : 'block'} rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 overflow-hidden`}>
        <div className="p-3 border-b border-slate-100 dark:border-slate-700 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Davlat raqami yoki mashina nomi"
              className={`${inputCls} pl-9`} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === f.key
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[68vh] overflow-y-auto">
          {loading ? (
            <p className="p-6 text-sm text-center text-slate-400">Yuklanmoqda…</p>
          ) : !filtered.length ? (
            <p className="p-6 text-sm text-center text-slate-400">Mashina topilmadi</p>
          ) : (
            filtered.map(r => (
              <VehicleListItem key={r.vehicle.id} row={r} active={r.vehicle.id === selectedId}
                onClick={() => setSelectedId(r.vehicle.id)} />
            ))
          )}
        </div>
        <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-700">
          {filtered.length} / {rows.length} ta mashina
        </p>
      </div>

      {/* O'ng: tanlangan mashina */}
      <div className={`${selected ? 'block' : 'hidden lg:block'} space-y-5`}>
        {!selected ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 py-20 px-6 text-center">
            <Car className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="font-medium text-slate-600 dark:text-slate-300">Mashinani tanlang</p>
            <p className="text-sm text-slate-400 mt-1">Chapdagi ro'yxatdan mashinani bossangiz, unga o'rnatilgan shinalar shu yerda ko'rinadi.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <button onClick={() => setSelectedId(null)}
                className="lg:hidden mt-1 p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Orqaga">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="font-mono text-2xl font-bold text-slate-900 dark:text-white leading-tight">{selected.vehicle.registrationNumber}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {selected.vehicle.brand} {selected.vehicle.model}
                  {selected.vehicle.branchName && ` · ${selected.vehicle.branchName}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Hozirgi km</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">{fmtKm(selected.vehicle.currentMileage)}</p>
              </div>
            </div>

            {canEdit && <QuickInstall key={selected.vehicle.id} row={selected} onDone={refresh} />}

            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
                O'rnatilgan shinalar <span className="text-slate-400 font-normal">({selected.tires.length})</span>
              </h3>
              {!selected.tires.length ? (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 py-8 text-center">
                  <p className="text-sm text-slate-500">Bu mashinaga hali shina yozilmagan.</p>
                  {canEdit && <p className="text-xs text-slate-400 mt-1">Yuqoridagi maydonga shina raqamini kiriting.</p>}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selected.tires.map(t => (
                    <TireCard key={t.id} tire={t} canEdit={canEdit} onRemove={x => onRemove(x, selected.vehicle.currentMileage)} onOpen={onOpenTire} />
                  ))}
                </div>
              )}
            </div>

            <VehicleTimeline vehicleId={selected.vehicle.id} />
          </>
        )}
      </div>
    </div>
  )
}
