import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  BrainCircuit, AlertTriangle, TrendingDown, TrendingUp, Minus,
  RefreshCw, Loader2, Terminal, Map as MapIcon, Download, ChevronDown, ChevronUp,
  CheckCircle2, Clock, Play,
} from 'lucide-react'
import api from '../../../lib/api'

interface AiStatus {
  total: number
  trained: number
  lastUpdated: string | null
  trainingInProgress: boolean
  trainingProgress: { current: number; total: number }
  trainingLog: string[]
}

interface MissedPattern {
  mfyId: string
  mfyName: string
  vehicleId: string
  vehicleNumber: string
  neverVisitedCells: number
  totalCells: number
  neverPct: number
  lastTrainedAt: string | null
}

interface StreetStats {
  totalMfys: number
  mfysWithStreets: number
  avgCoveragePct: number
  streetFetchInProgress: boolean
  topMissed: Array<{
    mfyId: string
    mfyName: string
    coveragePct: number
    coveredStreets: number
    totalStreets: number
  }>
}

interface MfyStreetDetail {
  mfyId: string
  mfyName: string
  totalStreets: number
  coveredStreets: number
  totalLengthM: number
  coveredLengthM: number
  coveragePct: number
  streets: Array<{
    osmWayId: string
    name: string | null
    highway: string
    lengthM: number
    covered: boolean
    coverPct: number
  }>
}

function fmt(dt?: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function RiskBadge({ pct }: { pct: number }) {
  if (pct >= 50) return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">Yuqori</span>
  if (pct >= 30) return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">O'rta</span>
  return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">Past</span>
}

function StreetCoverageBadge({ pct }: { pct: number }) {
  if (pct >= 75) return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">{pct}%</span>
  if (pct >= 50) return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">{pct}%</span>
  return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">{pct}%</span>
}

function SparkTrend({ vehicleId, mfyId }: { vehicleId: string; mfyId: string }) {
  const { data, isLoading } = useQuery<Array<{ month: string; coveragePct: number }>>({
    queryKey: ['th-ai-trend', vehicleId, mfyId],
    queryFn: () => api.get(`/th/ai/trend/${vehicleId}/${mfyId}`).then(r => r.data.data),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) return <div className="w-20 h-6 bg-gray-100 animate-pulse rounded" />
  if (!data || data.length === 0) return <span className="text-xs text-gray-300">—</span>

  const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month))
  const max = Math.max(...sorted.map(d => d.coveragePct), 1)
  const last = sorted[sorted.length - 1]?.coveragePct ?? 0
  const prev = sorted[sorted.length - 2]?.coveragePct ?? last
  const delta = last - prev

  const TrendIcon = delta > 3 ? TrendingUp : delta < -3 ? TrendingDown : Minus
  const trendColor = delta > 3 ? 'text-emerald-600' : delta < -3 ? 'text-red-500' : 'text-gray-400'

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-end gap-0.5 h-6">
        {sorted.map((d, i) => (
          <div
            key={i}
            className={`w-2 rounded-sm ${d.coveragePct >= 70 ? 'bg-emerald-400' : d.coveragePct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
            style={{ height: `${Math.max(4, Math.round(d.coveragePct / max * 24))}px` }}
            title={`${d.month}: ${d.coveragePct}%`}
          />
        ))}
      </div>
      <TrendIcon className={`w-3.5 h-3.5 ${trendColor}`} />
      <span className={`text-xs font-medium ${trendColor}`}>{last}%</span>
    </div>
  )
}

// ── MFY ko'cha detail panel ───────────────────────────────────────────────────

function MfyStreetDetailPanel({ mfyId, mfyName, onClose }: { mfyId: string; mfyName: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<MfyStreetDetail>({
    queryKey: ['th-mfy-street-detail', mfyId],
    queryFn: () => api.get(`/th/ai/street-stats?mfyId=${mfyId}`).then(r => r.data.data),
    staleTime: 5 * 60 * 1000,
  })

  const [showAll, setShowAll] = useState(false)

  const streets = data?.streets ?? []
  const visible = showAll ? streets : streets.slice(0, 15)

  function exportCsv() {
    if (!data) return
    const rows = [
      ['Ko\'cha nomi', 'Turi', 'Uzunlik (m)', 'Qoplangan', 'Qoplash %'],
      ...data.streets.map(s => [s.name || '—', s.highway, s.lengthM, s.covered ? 'Ha' : 'Yo\'q', s.coverPct]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${mfyName}-streets.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-800">{mfyName} — Ko'cha tahlili</h3>
            {data && (
              <p className="text-xs text-gray-500 mt-0.5">
                {data.coveredStreets}/{data.totalStreets} ko'cha · {Math.round(data.coveredLengthM / 1000 * 10) / 10} / {Math.round(data.totalLengthM / 1000 * 10) / 10} km qoplangan
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="flex items-center gap-1 px-3 py-1.5 text-xs text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600">✕</button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Yuklanmoqda...
            </div>
          ) : streets.length === 0 ? (
            <p className="text-center py-10 text-gray-400 text-sm">Bu MFY uchun ko'cha ma'lumoti yo'q. Avval OSM dan yuklang.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Ko'cha</th>
                    <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Turi</th>
                    <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Uzunlik</th>
                    <th className="pb-2 text-xs font-medium text-gray-500">Qoplash</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s, i) => (
                    <tr key={i} className={`border-b border-gray-50 ${s.covered ? '' : 'bg-red-50/40'}`}>
                      <td className="py-2 pr-3 font-medium text-gray-800 text-xs">{s.name || <span className="text-gray-400 italic">Nomsiz</span>}</td>
                      <td className="py-2 pr-3 text-xs text-gray-500">{s.highway}</td>
                      <td className="py-2 pr-3 text-xs text-gray-600">{s.lengthM}m</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${s.coverPct >= 75 ? 'bg-emerald-400' : s.coverPct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${s.coverPct}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-gray-700">{s.coverPct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {streets.length > 15 && (
                <button
                  onClick={() => setShowAll(v => !v)}
                  className="w-full mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center justify-center gap-1 py-2"
                >
                  {showAll ? <><ChevronUp className="w-3.5 h-3.5" /> Kamroq ko'rsat</> : <><ChevronDown className="w-3.5 h-3.5" /> Barchasini ko'rsat ({streets.length})</>}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Ko'cha qamrovi bo'limi ────────────────────────────────────────────────────

function StreetCoverageSection() {
  const qc = useQueryClient()
  const [fetchingAll, setFetchingAll] = useState(false)
  const [selectedMfy, setSelectedMfy] = useState<{ id: string; name: string } | null>(null)

  const { data: stats, isLoading, refetch } = useQuery<StreetStats>({
    queryKey: ['th-street-stats'],
    queryFn: () => api.get('/th/ai/street-stats').then(r => r.data.data),
    staleTime: 5 * 60 * 1000,
    refetchInterval: (q) => (q.state.data?.streetFetchInProgress || fetchingAll) ? 3000 : false,
  })

  useEffect(() => {
    if (fetchingAll && stats && !stats.streetFetchInProgress) {
      setFetchingAll(false)
      qc.invalidateQueries({ queryKey: ['th-street-stats'] })
    }
  }, [stats?.streetFetchInProgress]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAllMut = useMutation({
    mutationFn: () => api.post('/th/ai/fetch-streets', {}),
    onSuccess: () => {
      setFetchingAll(true)
      toast.success('OSM dan ko\'chalar yuklanmoqda...')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const isStreetsRunning = stats?.streetFetchInProgress || fetchingAll

  const coveragePct = stats?.avgCoveragePct ?? 0
  const coverageColor = coveragePct >= 75 ? 'text-emerald-600' : coveragePct >= 50 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MapIcon className="w-4 h-4 text-teal-600" />
          <p className="font-semibold text-gray-800">Ko'cha qamrovi (OSM tahlili)</p>
        </div>
        <button
          onClick={() => fetchAllMut.mutate()}
          disabled={isStreetsRunning || fetchAllMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium rounded-xl transition-colors"
        >
          {isStreetsRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {isStreetsRunning ? "Yuklanmoqda..." : "OSM dan ko'chalarni yuklash"}
        </button>
      </div>

      <p className="text-xs text-gray-400">
        OpenStreetMap dan har bir MFY uchun ko'cha segmentlari yuklanadi. So'ngra GPS treklar bo'yicha qaysi ko'chalarga borilgani aniqlanadi.
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center h-20 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" />Yuklanmoqda...</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-teal-50 rounded-xl p-3 text-center">
              <p className={`text-2xl font-bold ${coverageColor}`}>{coveragePct}%</p>
              <p className="text-xs text-teal-700 mt-0.5">O'rtacha qamrov</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">{stats?.mfysWithStreets ?? 0}</p>
              <p className="text-xs text-gray-500 mt-0.5">Ko'cha ma'lumoti bor MFY</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">{stats?.totalMfys ?? 0}</p>
              <p className="text-xs text-gray-500 mt-0.5">Jami MFY</p>
            </div>
          </div>

          {stats && stats.mfysWithStreets === 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Hali ko'cha ma'lumotlari yuklanmagan. "OSM dan ko'chalarni yuklash" tugmasini bosing.
            </div>
          )}

          {/* Top missed MFYs */}
          {(stats?.topMissed?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Kam qoplanayotgan MFY lar (so'nggi 7 kun)</p>
              <div className="space-y-1.5">
                {stats!.topMissed.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedMfy({ id: m.mfyId, name: m.mfyName })}
                  >
                    <span className="text-xs text-gray-400 w-4 shrink-0">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{m.mfyName}</p>
                      <p className="text-xs text-gray-400">{m.coveredStreets}/{m.totalStreets} ko'cha qoplangan</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${m.coveragePct >= 75 ? 'bg-emerald-400' : m.coveragePct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${m.coveragePct}%` }}
                        />
                      </div>
                      <StreetCoverageBadge pct={m.coveragePct} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {selectedMfy && (
        <MfyStreetDetailPanel
          mfyId={selectedMfy.id}
          mfyName={selectedMfy.name}
          onClose={() => setSelectedMfy(null)}
        />
      )}
    </div>
  )
}

// ── Coverage Heatmap ─────────────────────────────────────────────────────────

interface AllPattern {
  mfyId: string
  mfyName: string
  vehicleId: string
  vehicleNumber: string
  neverVisitedCells: number
  totalCells: number
  neverPct: number
}

function CoverageHeatmap() {
  const { data, isLoading } = useQuery<AllPattern[]>({
    queryKey: ['th-ai-heatmap'],
    queryFn: () => api.get('/th/ai/missed-patterns?threshold=0').then(r => r.data.data),
    staleTime: 10 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <MapIcon className="w-4 h-4 text-blue-600" />
          <p className="font-semibold text-gray-800">Qamrov xaritasi (heatmap)</p>
        </div>
        <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />Yuklanmoqda...
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) return null

  // MFY bo'yicha guruhlash
  const mfyMap = new Map<string, { name: string; vehicles: AllPattern[] }>()
  for (const p of data) {
    if (!mfyMap.has(p.mfyId)) mfyMap.set(p.mfyId, { name: p.mfyName, vehicles: [] })
    mfyMap.get(p.mfyId)!.vehicles.push(p)
  }

  // Barcha vehiclelar (unique)
  const allVehicleIds = [...new Set(data.map(p => p.vehicleId))]
  const allVehicleNums = new Map(data.map(p => [p.vehicleId, p.vehicleNumber]))

  // Har katak uchun rang
  function cellColor(pct: number) {
    if (pct <= 5) return 'bg-emerald-500'
    if (pct <= 20) return 'bg-amber-400'
    if (pct <= 40) return 'bg-orange-500'
    return 'bg-red-500'
  }

  const mfyEntries = [...mfyMap.entries()].sort((a, b) => {
    const maxA = Math.max(...a[1].vehicles.map(v => v.neverPct))
    const maxB = Math.max(...b[1].vehicles.map(v => v.neverPct))
    return maxB - maxA
  })

  const topMfys = mfyEntries.slice(0, 15)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MapIcon className="w-4 h-4 text-blue-600" />
          <p className="font-semibold text-gray-800">Qamrov xaritasi (heatmap)</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Yaxshi</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> O'rtacha</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Yomon</span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">Har katak = mashina × MFY. Rang = qoplanmagan katak %.</p>

      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left pr-3 pb-2 text-gray-500 font-medium w-40 min-w-36 sticky left-0 bg-white">MFY</th>
              {allVehicleIds.slice(0, 20).map(vId => (
                <th key={vId} className="pb-2 px-0.5">
                  <div className="text-gray-400 font-normal" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', height: 60, fontSize: 10 }}>
                    {allVehicleNums.get(vId)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topMfys.map(([mfyId, mfy]) => {
              const vMap = new Map(mfy.vehicles.map(v => [v.vehicleId, v]))
              return (
                <tr key={mfyId} className="border-t border-gray-50">
                  <td className="pr-3 py-1 text-gray-700 font-medium sticky left-0 bg-white truncate max-w-36">
                    {mfy.name}
                  </td>
                  {allVehicleIds.slice(0, 20).map(vId => {
                    const p = vMap.get(vId)
                    return (
                      <td key={vId} className="px-0.5 py-1">
                        {p ? (
                          <div
                            className={`w-6 h-6 rounded-sm ${cellColor(p.neverPct)} opacity-80 hover:opacity-100 cursor-default`}
                            title={`${p.vehicleNumber} × ${mfy.name}: ${p.neverPct}% qoplanmagan`}
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-sm bg-gray-100" title="Grafik yo'q" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {mfyEntries.length > 15 && (
        <p className="text-xs text-gray-400 mt-2">Faqat eng muammoli 15 ta MFY ko'rsatilmoqda ({mfyEntries.length} tadan)</p>
      )}
    </div>
  )
}

// ── Mashina bo'yicha o'qitish ro'yxati ───────────────────────────────────────

interface VehicleTrainingStatus {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  total: number
  trained: number
  lastTrainedAt: string | null
  status: 'untrained' | 'partial' | 'trained'
  inProgress: boolean
  // Queue tizimidan:
  trainingStatus: 'idle' | 'training' | 'queued'
  queuePosition: number  // 0 = aktiv, 1+ = navbat tartib raqami, -1 = navbatda emas
}

interface VehicleStatusResponse {
  data: VehicleTrainingStatus[]
  queueLength: number
  activeVehicleId: string | null
}

function VehicleTrainingList() {
  const qc = useQueryClient()
  const [showTrained, setShowTrained] = useState(false)

  const { data, isLoading, refetch } = useQuery<VehicleStatusResponse>({
    queryKey: ['th-ai-vehicle-status'],
    queryFn: () => api.get('/th/ai/vehicle-status').then(r => r.data),
    refetchInterval: (q) => {
      const d = q.state.data as VehicleStatusResponse | undefined
      const busy = d?.data?.some(v => v.trainingStatus === 'training' || v.trainingStatus === 'queued')
      return busy ? 3000 : 15000
    },
  })

  const trainMut = useMutation({
    mutationFn: (vehicleId: string) => api.post('/th/ai/train-vehicle', { vehicleId }),
    onSuccess: (res) => {
      const s = res.data?.data?.status
      if (s === 'queued') toast('Navbatga qo\'shildi', { icon: '🕐' })
      else if (s === 'started') toast.success('O\'qitish boshlandi')
      setTimeout(() => refetch(), 600)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const vehicles = data?.data ?? []
  const queueLength = data?.queueLength ?? 0
  const activeVehicleId = data?.activeVehicleId ?? null
  const visible = showTrained ? vehicles : vehicles.filter(v => v.status !== 'trained')

  const untrainedCount = vehicles.filter(v => v.status === 'untrained').length
  const partialCount = vehicles.filter(v => v.status === 'partial').length
  const trainedCount = vehicles.filter(v => v.status === 'trained').length

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-purple-600" />
          <p className="font-semibold text-gray-800">Mashina bo'yicha o'qitish</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> {untrainedCount} o'qitilmagan
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> {partialCount} qisman
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> {trainedCount} tayyor
            </span>
          </div>
          <button
            onClick={() => setShowTrained(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            {showTrained ? 'Tayyorlarni yashirish' : `Tayyorlarni ko'rsatish (${trainedCount})`}
          </button>
          <button onClick={() => refetch()} className="p-1 hover:bg-gray-100 rounded">
            <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Queue holati banneri */}
      {activeVehicleId && (
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>
            O'qitilmoqda: <strong>{vehicles.find(v => v.vehicleId === activeVehicleId)?.registrationNumber ?? activeVehicleId}</strong>
            {queueLength > 0 && <span className="ml-2 text-purple-500">· Navbatda yana {queueLength} ta mashina</span>}
          </span>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Bir vaqtda faqat 1 ta mashina o'qitiladi — xotirani tejash uchun. Qolganlar navbatda ketma-ket ishlanadi.
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center h-20 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />Yuklanmoqda...
        </div>
      ) : visible.length === 0 ? (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Barcha mashinalar o'qitilgan!
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Mashina</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">O'rganilgan</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 hidden sm:table-cell">Oxirgi</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(v => {
                const pct = v.total > 0 ? Math.round(v.trained / v.total * 100) : 0
                const tStatus = v.trainingStatus ?? (v.inProgress ? 'training' : 'idle')
                const isDisabled = tStatus === 'training' || tStatus === 'queued' || (trainMut.isPending && trainMut.variables === v.vehicleId)
                return (
                  <tr key={v.vehicleId} className={`border-b border-gray-50 hover:bg-gray-50/50 ${
                    tStatus === 'training' ? 'bg-purple-50/30' :
                    v.status === 'untrained' ? 'bg-red-50/20' :
                    v.status === 'partial' ? 'bg-amber-50/20' : ''
                  }`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          tStatus === 'training' ? 'bg-purple-400 animate-pulse' :
                          tStatus === 'queued'   ? 'bg-blue-400' :
                          v.status === 'trained' ? 'bg-emerald-400' :
                          v.status === 'partial' ? 'bg-amber-400' : 'bg-red-400'
                        }`} />
                        <div>
                          <p className="font-medium text-gray-800 text-sm">{v.registrationNumber}</p>
                          {(v.brand || v.model) && (
                            <p className="text-[10px] text-gray-400">{v.brand} {v.model}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-gray-600">{v.trained}/{v.total} juftlik</span>
                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                      <span className="text-xs text-gray-400 flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" />
                        {v.lastTrainedAt ? fmt(v.lastTrainedAt) : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => trainMut.mutate(v.vehicleId)}
                        disabled={isDisabled}
                        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap border transition-colors ${
                          tStatus === 'training'
                            ? 'text-purple-700 bg-purple-100 border-purple-300 cursor-not-allowed'
                            : tStatus === 'queued'
                            ? 'text-blue-600 bg-blue-50 border-blue-200 cursor-not-allowed'
                            : 'text-purple-700 bg-purple-50 border-purple-200 hover:bg-purple-100'
                        }`}
                      >
                        {tStatus === 'training'
                          ? <><Loader2 className="w-3 h-3 animate-spin" /> O'qitilmoqda</>
                          : tStatus === 'queued'
                          ? <><Clock className="w-3 h-3" /> Navbat: {v.queuePosition}</>
                          : <><Play className="w-3 h-3" /> O'qitish</>}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Real-time training log panel ─────────────────────────────────────────────

function TrainingPanel({ status }: { status: AiStatus }) {
  const logRef = useRef<HTMLDivElement>(null)
  const { current, total } = status.trainingProgress
  const pct = total > 0 ? Math.round(current / total * 100) : 0

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [status.trainingLog])

  return (
    <div className="bg-purple-950 rounded-xl border border-purple-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 text-purple-300 animate-spin shrink-0" />
        <span className="text-sm font-semibold text-purple-200">
          AI o'qitish jarayonida...
          {total > 0 && (
            <span className="ml-2 text-purple-400 font-normal">
              {current} / {total} juftlik
            </span>
          )}
        </span>
        <span className="ml-auto text-sm font-bold text-purple-200">{pct}%</span>
      </div>

      <div className="h-2 bg-purple-900 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full transition-all duration-700"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>

      <div
        ref={logRef}
        className="h-48 overflow-y-auto font-mono text-xs space-y-0.5 pr-1"
        style={{ scrollBehavior: 'smooth' }}
      >
        {status.trainingLog.length === 0 ? (
          <p className="text-purple-500 italic">Tayyor bo'lguncha kuting...</p>
        ) : (
          status.trainingLog.map((line, i) => {
            const isOk = line.startsWith('✅')
            const isWarn = line.startsWith('⚠') || line.startsWith('❌')
            const isWialon = line.startsWith('📡')
            return (
              <p
                key={i}
                className={
                  isOk ? 'text-emerald-400' :
                  isWarn ? 'text-amber-400' :
                  isWialon ? 'text-blue-400' :
                  'text-purple-300'
                }
              >
                {line}
              </p>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Asosiy sahifa ─────────────────────────────────────────────────────────────

export default function AiAnalyticsPage() {
  const qc = useQueryClient()
  const [started, setStarted] = useState(false)
  const [incrStarted, setIncrStarted] = useState(false)
  const [search, setSearch] = useState('')

  const { data: status, refetch: refetchStatus } = useQuery<AiStatus>({
    queryKey: ['th-ai-status'],
    queryFn: () => api.get('/th/ai/status').then(r => r.data.data),
    refetchInterval: (q) => (q.state.data?.trainingInProgress || started || incrStarted) ? 2000 : 30000,
  })

  const { data: patterns, isLoading: pLoading } = useQuery<MissedPattern[]>({
    queryKey: ['th-ai-missed'],
    queryFn: () => api.get('/th/ai/missed-patterns?threshold=15').then(r => r.data.data),
    staleTime: 10 * 60 * 1000,
  })

  const trainMut = useMutation({
    mutationFn: () => api.post('/th/ai/train'),
    onSuccess: () => {
      setStarted(true)
      setTimeout(() => refetchStatus(), 600)
      toast.success("To'liq o'qitish boshlandi (6 oy)")
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const incrMut = useMutation({
    mutationFn: () => api.post('/th/ai/train-incremental'),
    onSuccess: () => {
      setIncrStarted(true)
      setTimeout(() => refetchStatus(), 600)
      toast.success("Oylik yangilash boshlandi")
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const isRunning = status?.trainingInProgress || started || incrStarted

  useEffect(() => {
    if ((started || incrStarted) && status && !status.trainingInProgress) {
      setStarted(false)
      setIncrStarted(false)
      qc.invalidateQueries({ queryKey: ['th-ai-missed'] })
    }
  }, [status?.trainingInProgress]) // eslint-disable-line react-hooks/exhaustive-deps

  const trainedPct = status && status.total > 0
    ? Math.round(status.trained / status.total * 100)
    : 0

  const filtered = (patterns ?? []).filter(p =>
    !search || p.mfyName.toLowerCase().includes(search.toLowerCase()) ||
    p.vehicleNumber.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-bold text-gray-800">AI Ko'cha Tahlili</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          GPS monitoring tarixi asosida qaysi ko'chalar doim, qaysilari hech qachon qoplanmaganini ko'rsatadi
        </p>
      </div>

      {/* AI holati + o'qitish */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-purple-600" />
          <p className="font-semibold text-gray-800">AI o'qitish holati</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-purple-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-purple-700">{trainedPct}%</p>
            <p className="text-xs text-purple-600 mt-0.5">O'rganilgan</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-700">{status?.trained ?? '—'}</p>
            <p className="text-xs text-gray-500 mt-0.5">O'rganilgan juftlik</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-700">{status?.total ?? '—'}</p>
            <p className="text-xs text-gray-500 mt-0.5">Jami jadval juftligi</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xs font-bold text-gray-700 leading-tight">{fmt(status?.lastUpdated)}</p>
            <p className="text-xs text-gray-500 mt-0.5">Oxirgi o'qitish</p>
          </div>
        </div>

        {status && status.total > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Fingerprint qamrovi</span>
              <span>{status.trained} / {status.total}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-purple-500 transition-all duration-500"
                style={{ width: `${trainedPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => trainMut.mutate()}
            disabled={isRunning || trainMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-medium rounded-xl transition-colors"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
            To'liq o'qitish (6 oy)
          </button>
          <button
            onClick={() => incrMut.mutate()}
            disabled={isRunning || incrMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-purple-300 text-purple-700 hover:bg-purple-50 disabled:opacity-40 rounded-xl transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${incrStarted ? 'animate-spin' : ''}`} />
            Oylik yangilash (tez)
          </button>
          {!isRunning && status && status.total === 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              GPS monitoring tarixi topilmadi. Avval bir necha kun monitoring ishga tushirilsin.
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Terminal className="w-3 h-3" />
          GPS monitoring tarixi asosida o'qitiladi. Har oy 1-sanada avtomatik yangilanadi.
        </p>
      </div>

      {/* Mashina bo'yicha o'qitish ro'yxati */}
      <VehicleTrainingList />

      {/* Live training panel */}
      {(isRunning && status) && (
        <TrainingPanel status={status} />
      )}

      {/* Ko'cha qamrovi (OSM) */}
      <StreetCoverageSection />

      {/* Qamrov heatmap */}
      {!isRunning && <CoverageHeatmap />}

      {/* Hech qachon borilmagan joylar */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <p className="font-semibold text-gray-800">Muammoli hududlar</p>
            <span className="text-xs text-gray-400">(6 oyda ≥15% katak qoplanmagan)</span>
          </div>
          <input
            placeholder="MFY yoki mashina..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-44 px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>

        {pLoading ? (
          <div className="flex items-center justify-center h-24 text-gray-400 text-sm">Yuklanmoqda...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            {patterns?.length === 0
              ? 'Muammoli hudud topilmadi. AI yaxshi ishlayapti!'
              : 'Qidiruv natijasi yo\'q'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">MFY</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">Mashina</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">Qoplanmagan</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">6 oy trendi</th>
                  <th className="pb-2 text-xs font-medium text-gray-500">Xavf</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 pr-4">
                      <p className="font-medium text-gray-800">{p.mfyName}</p>
                      <p className="text-xs text-gray-400">{p.lastTrainedAt ? `o'rganildi: ${fmt(p.lastTrainedAt)}` : 'o\'rganilmagan'}</p>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-gray-700">{p.vehicleNumber}</td>
                    <td className="py-2.5 pr-4">
                      <p className="font-bold text-gray-800">{p.neverPct}%</p>
                      <p className="text-xs text-gray-400">{p.neverVisitedCells}/{p.totalCells} katak</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <SparkTrend vehicleId={p.vehicleId} mfyId={p.mfyId} />
                    </td>
                    <td className="py-2.5">
                      <RiskBadge pct={p.neverPct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length >= 100 && (
              <p className="text-xs text-gray-400 mt-2 text-center">
                Faqat birinchi 100 ta ko'rsatilmoqda. Filtr ishlatib toraytiring.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
