import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { BrainCircuit, AlertTriangle, TrendingDown, TrendingUp, Minus, RefreshCw, Loader2 } from 'lucide-react'
import api from '../../../lib/api'

interface AiStatus {
  total: number
  trained: number
  lastUpdated: string | null
  trainingInProgress: boolean
  trainingProgress: { current: number; total: number }
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

// ── Sparkline (7 bar) ────────────────────────────────────────────────────────

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

// ── Asosiy sahifa ─────────────────────────────────────────────────────────────

export default function AiAnalyticsPage() {
  const qc = useQueryClient()
  const [started, setStarted] = useState(false)
  const [incrStarted, setIncrStarted] = useState(false)
  const [search, setSearch] = useState('')

  const { data: status, refetch: refetchStatus } = useQuery<AiStatus>({
    queryKey: ['th-ai-status'],
    queryFn: () => api.get('/th/ai/status').then(r => r.data.data),
    refetchInterval: (q) => (q.state.data?.trainingInProgress || started || incrStarted) ? 3000 : 30000,
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
      // Darhol holat so'rovini yangilaymiz
      setTimeout(() => refetchStatus(), 500)
      toast.success("To'liq o'qitish boshlandi (6 oy, bir necha daqiqa)")
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const incrMut = useMutation({
    mutationFn: () => api.post('/th/ai/train-incremental'),
    onSuccess: () => {
      setIncrStarted(true)
      setTimeout(() => refetchStatus(), 500)
      toast.success("Inkremental yangilanish boshlandi (1 oy)")
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const isRunning = status?.trainingInProgress || started || incrStarted

  // O'qitish tugaganda state'ni tozalaymiz — useEffect ichida, render paytida emas
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
          6 oylik GPS tarix asosida qaysi ko'chalar doim, qaysilari hech qachon qoplanmaganini ko'rsatadi
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
            <p className="text-xs text-gray-500 mt-0.5">Juftliklar</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-700">{status?.total ?? '—'}</p>
            <p className="text-xs text-gray-500 mt-0.5">Jami jadval</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xs font-bold text-gray-700 leading-tight">{fmt(status?.lastUpdated)}</p>
            <p className="text-xs text-gray-500 mt-0.5">Oxirgi o'qitish</p>
          </div>
        </div>

        {/* Progress bar */}
        {status && status.total > 0 && (
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-purple-500 transition-all duration-500"
              style={{ width: `${trainedPct}%` }}
            />
          </div>
        )}

        {isRunning && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs text-purple-800">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>
                GPS tarixlari tahlil qilinmoqda...
                {status?.trainingProgress && status.trainingProgress.total > 0 && (
                  <span className="ml-1 font-semibold">
                    {status.trainingProgress.current} / {status.trainingProgress.total} juftlik
                  </span>
                )}
              </span>
            </div>
            {status?.trainingProgress && status.trainingProgress.total > 0 && (
              <div className="h-1.5 bg-purple-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all duration-700"
                  style={{ width: `${Math.round(status.trainingProgress.current / status.trainingProgress.total * 100)}%` }}
                />
              </div>
            )}
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
        </div>
        <p className="text-xs text-gray-400">
          To'liq o'qitish: bir necha daqiqa. Oylik yangilash: 1-2 daqiqa. Har oy 1-sanada avtomatik yangilanadi.
        </p>
      </div>

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
