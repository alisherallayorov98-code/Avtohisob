import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, Download, AlertTriangle, CheckCircle, XCircle, TrendingUp, Users, Calendar } from 'lucide-react'
import api from '../../../lib/api'
import { formatCurrency } from '../../../lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkSession {
  id: string
  date: string
  dateLabel: string
  vehicleId: string
  vehicle: { registrationNumber: string; brand: string; model: string }
  firstGpsLabel: string | null
  lastGpsLabel: string | null
  durationMin: number
  startStatus: 'early' | 'on_time' | 'late' | 'absent'
  startStatusLabel: string
  endStatus: string | null
  endStatusLabel: string | null
  lateStartMin: number
  earlyEndMin: number
}

interface ReportRow {
  vehicleId: string
  vehicle: { registrationNumber: string; brand: string; model: string }
  totalDays: number
  presentDays: number
  absentDays: number
  lateStartDays: number
  earlyEndDays: number
  onTimeDays: number
  attendancePct: number
  avgDurationMin: number
  avgLateStartMin: number
  avgEarlyEndMin: number
  avgStartLabel: string | null
  avgEndLabel: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(min: number): string {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}s ${m}d` : `${m}d`
}

function todayStr() { return new Date().toISOString().split('T')[0] }
function weekAgoStr() {
  const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]
}
function monthAgoStr() {
  const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().split('T')[0]
}

const STATUS_STYLE: Record<string, string> = {
  early:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  on_time: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  late:    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  absent:  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status] ?? ''}`}>
      {label}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkSessionsPage() {
  const [from, setFrom]       = useState(weekAgoStr)
  const [to, setTo]           = useState(todayStr)
  const [vehicleId, setVehicleId] = useState('')
  const [tab, setTab]         = useState<'daily' | 'summary'>('daily')
  const [backfilling, setBackfilling] = useState(false)

  // API so'rovlari
  const sessionsQ = useQuery({
    queryKey: ['th-work-sessions', from, to, vehicleId],
    queryFn: () => api.get('/th/work-sessions', { params: { from, to, vehicleId: vehicleId || undefined } })
      .then(r => r.data.data as WorkSession[]),
    enabled: !!from && !!to,
  })

  const reportQ = useQuery({
    queryKey: ['th-work-sessions-report', from, to, vehicleId],
    queryFn: () => api.get('/th/work-sessions/report', { params: { from, to, vehicleId: vehicleId || undefined } })
      .then(r => r.data.data),
    enabled: !!from && !!to,
  })

  const vehiclesQ = useQuery({
    queryKey: ['th-vehicles-simple'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data?.data ?? []),
    staleTime: 60_000,
  })

  const sessions: WorkSession[] = sessionsQ.data ?? []
  const report: ReportRow[]     = reportQ.data?.report ?? []

  // Yig'ma statistika (daily tab uchun)
  const summary = useMemo(() => {
    const total   = sessions.length
    const present = sessions.filter(s => s.startStatus !== 'absent').length
    const absent  = sessions.filter(s => s.startStatus === 'absent').length
    const late    = sessions.filter(s => s.startStatus === 'late').length
    const earlyEnd = sessions.filter(s => s.endStatus === 'early').length
    return { total, present, absent, late, earlyEnd }
  }, [sessions])

  const handleExcel = () => {
    const params = new URLSearchParams({ from, to })
    if (vehicleId) params.set('vehicleId', vehicleId)
    window.open(`/api/th/work-sessions/excel?${params}`, '_blank')
  }

  const handleBackfill = async () => {
    if (!window.confirm(`${from} dan ${to} gacha tarixiy ma'lumot yuklab olinsinmi? Bu bir necha daqiqa olishi mumkin.`)) return
    setBackfilling(true)
    try {
      await api.post('/th/work-sessions/backfill', { from, to })
      alert('Backfill ishga tushdi. Bir necha daqiqadan keyin sahifani yangilang.')
    } catch { alert('Xato yuz berdi') }
    setBackfilling(false)
  }

  const vehicles = vehiclesQ.data ?? []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-6 h-6 text-blue-500" /> Ish Vaqti Nazorati
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Kim qachon keldi, qachon ketdi — GPS asosida
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {backfilling ? 'Yuklanmoqda...' : 'Tarixiy ma\'lumot olish'}
          </button>
          <button
            onClick={handleExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Presetlar */}
          <div className="flex gap-1">
            {[
              { label: 'Bugun', f: todayStr, t: todayStr },
              { label: 'Hafta', f: weekAgoStr, t: todayStr },
              { label: 'Oy', f: monthAgoStr, t: todayStr },
            ].map(p => (
              <button
                key={p.label}
                onClick={() => { setFrom(p.f()); setTo(p.t()) }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  from === p.f() && to === p.t()
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2 items-center">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Dan</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} max={to}
                className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Gacha</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} min={from} max={todayStr()}
                className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Mashina</label>
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-w-[160px]">
              <option value="">Barcha mashinalar</option>
              {vehicles.map((v: any) => (
                <option key={v.id} value={v.id}>{v.registrationNumber} — {v.brand} {v.model}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Jami yozuv', value: summary.total, icon: <Calendar className="w-4 h-4" />, color: 'blue' },
          { label: 'Keldi', value: summary.present, icon: <CheckCircle className="w-4 h-4" />, color: 'green' },
          { label: 'Kelmadi', value: summary.absent, icon: <XCircle className="w-4 h-4" />, color: 'red' },
          { label: 'Kech keldi', value: summary.late, icon: <AlertTriangle className="w-4 h-4" />, color: 'orange' },
          { label: 'Erta ketdi', value: summary.earlyEnd, icon: <TrendingUp className="w-4 h-4" />, color: 'purple' },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs mb-1">
              {c.icon} {c.label}
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Tab tugmalari */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('daily')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'daily' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          Kundalik ro'yxat
        </button>
        <button
          onClick={() => setTab('summary')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${tab === 'summary' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          <Users className="w-4 h-4" /> Mashina yig'masi
        </button>
      </div>

      {/* ── Kundalik ro'yxat ── */}
      {tab === 'daily' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {sessionsQ.isLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">Yuklanmoqda...</div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <Clock className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">Ma'lumot topilmadi. "Tarixiy ma'lumot olish" tugmasini bosing.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Sana</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Mashina</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Kelish</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Ketish</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Davomiylik</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Holat</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Kechikish</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{s.dateLabel}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-gray-900 dark:text-white">{s.vehicle?.registrationNumber}</span>
                        <p className="text-xs text-gray-400">{s.vehicle?.brand} {s.vehicle?.model}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">{s.firstGpsLabel ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">{s.lastGpsLabel ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{fmt(s.durationMin)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.startStatus} label={s.startStatusLabel} />
                        {s.endStatusLabel && (
                          <p className="text-xs text-gray-400 mt-0.5">{s.endStatusLabel}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {s.lateStartMin > 0 && (
                          <span className="text-orange-600 dark:text-orange-400 font-medium">+{s.lateStartMin}d</span>
                        )}
                        {s.earlyEndMin > 0 && (
                          <p className="text-xs text-purple-500">-{s.earlyEndMin}d erta</p>
                        )}
                        {!s.lateStartMin && !s.earlyEndMin && s.startStatus !== 'absent' && (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Mashina yig'masi ── */}
      {tab === 'summary' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {reportQ.isLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">Yuklanmoqda...</div>
          ) : report.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <Users className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">Davr uchun ma'lumot topilmadi.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Mashina</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Ishtirok</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Kelmadi</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Kech keldi</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Erta ketdi</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">O'rt. kelish</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">O'rt. ketish</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">O'rt. ish (soat)</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400">Ishtirok %</th>
                  </tr>
                </thead>
                <tbody>
                  {report.map(r => (
                    <tr key={r.vehicleId} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-gray-900 dark:text-white">{r.vehicle?.registrationNumber}</span>
                        <p className="text-xs text-gray-400">{r.vehicle?.brand} {r.vehicle?.model}</p>
                      </td>
                      <td className="px-3 py-3 text-center text-gray-700 dark:text-gray-300">
                        {r.presentDays}/{r.totalDays}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {r.absentDays > 0
                          ? <span className="text-red-600 dark:text-red-400 font-semibold">{r.absentDays}</span>
                          : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {r.lateStartDays > 0 ? (
                          <span className="text-orange-600 dark:text-orange-400 font-semibold">
                            {r.lateStartDays}
                            {r.avgLateStartMin > 0 && <span className="text-xs font-normal ml-1">(+{r.avgLateStartMin}d)</span>}
                          </span>
                        ) : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {r.earlyEndDays > 0 ? (
                          <span className="text-purple-600 dark:text-purple-400 font-semibold">
                            {r.earlyEndDays}
                            {r.avgEarlyEndMin > 0 && <span className="text-xs font-normal ml-1">(-{r.avgEarlyEndMin}d)</span>}
                          </span>
                        ) : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-3 py-3 text-center font-mono text-gray-700 dark:text-gray-300">{r.avgStartLabel ?? '—'}</td>
                      <td className="px-3 py-3 text-center font-mono text-gray-700 dark:text-gray-300">{r.avgEndLabel ?? '—'}</td>
                      <td className="px-3 py-3 text-center text-gray-700 dark:text-gray-300">{fmt(r.avgDurationMin)}</td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${r.attendancePct >= 90 ? 'bg-green-500' : r.attendancePct >= 70 ? 'bg-orange-400' : 'bg-red-500'}`}
                              style={{ width: `${r.attendancePct}%` }}
                            />
                          </div>
                          <span className={`text-sm font-semibold ${r.attendancePct >= 90 ? 'text-green-600 dark:text-green-400' : r.attendancePct >= 70 ? 'text-orange-500' : 'text-red-500'}`}>
                            {r.attendancePct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
