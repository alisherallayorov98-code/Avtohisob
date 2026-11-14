// Mashina dosyesi — "nima, nega, qachon" savoliga bitta sahifada javob:
// avtopark bilan solishtirish, 12 oylik xarajat, hayot tarixi (vaqt chizig'i) va ochiq savollar.
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import { ArrowLeft, Wrench, Cpu, Droplets, ClipboardCheck, Fuel, CircleDot, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import api from '../lib/api'
import { cn, formatDate } from '../lib/utils'
import { FindingRow, DismissModal, AssignModal, formatUzs, type Finding } from '../components/insights/parts'

interface Metric { label: string; value: number | null; unit: string; fleet: number | null; better: 'lower' | 'higher'; note?: string }
interface TimelineEvent { date: string; kind: string; title: string; detail?: string; amount?: number; flag?: 'warning' | 'critical' }
interface DossierData {
  vehicle: { id: string; plate: string; brand: string; model: string; year: number; status: string; mileage: number; fuelType: string; fuelNorm: number | null; lastGpsSignal: string | null; insuranceExpiry: string | null; techInspectionExpiry: string | null }
  metrics: Metric[]
  monthly: Array<{ month: string; fuel: number; repairs: number; other: number; km: number | null }>
  services: Array<{ type: string; lastDate: string | null; lastKm: number | null; leftKm: number | null }>
  timeline: TimelineEvent[]
  findings: Finding[]
}

const STATUS: Record<string, string> = { active: 'Faol', maintenance: "Ta'mirda", inactive: 'Nofaol' }
const KIND: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  repair: { icon: Wrench, color: 'text-orange-500', label: "Ta'mir" },
  engine: { icon: Cpu, color: 'text-red-500', label: 'Dvigatel' },
  service: { icon: Droplets, color: 'text-blue-500', label: 'Xizmat' },
  inspection: { icon: ClipboardCheck, color: 'text-emerald-500', label: 'Tekshiruv' },
  fuel_month: { icon: Fuel, color: 'text-gray-400', label: "Yoqilg'i" },
  tire: { icon: CircleDot, color: 'text-purple-500', label: 'Shina' },
}
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek']
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')

function MetricCard({ m }: { m: Metric }) {
  let verdict: { text: string; tone: 'good' | 'bad' | 'neutral' } | null = null
  if (m.value != null && m.fleet != null && m.fleet > 0) {
    const diff = (m.value / m.fleet - 1) * 100
    if (Math.abs(diff) < 10) verdict = { text: "avtopark darajasida", tone: 'neutral' }
    else {
      const worse = m.better === 'lower' ? diff > 0 : diff < 0
      verdict = { text: `avtoparkdan ${Math.abs(Math.round(diff))}% ${diff > 0 ? 'yuqori' : 'past'}`, tone: worse ? 'bad' : 'good' }
    }
  }
  const Icon = !verdict || verdict.tone === 'neutral' ? Minus : verdict.text.includes('yuqori') ? TrendingUp : TrendingDown
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{m.label}</div>
      <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
        {m.value == null ? '—' : m.unit === "so'm" && m.value >= 1_000_000 ? formatUzs(m.value) : `${fmt(m.value)} ${m.unit}`}
      </div>
      {verdict && (
        <div className={cn('mt-1 inline-flex items-center gap-1 text-xs font-medium',
          verdict.tone === 'bad' ? 'text-red-600 dark:text-red-400' : verdict.tone === 'good' ? 'text-green-600 dark:text-green-400' : 'text-gray-500')}>
          <Icon className="w-3.5 h-3.5" /> {verdict.text} ({fmt(m.fleet!)})
        </div>
      )}
      {m.note && <div className="mt-0.5 text-xs text-gray-400">{m.note}</div>}
    </div>
  )
}

export default function InsightVehicle() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [kind, setKind] = useState<string>('')
  const [dismissing, setDismissing] = useState<Finding | null>(null)
  const [assigning, setAssigning] = useState<Finding | null>(null)

  const { data, isLoading, isError } = useQuery<DossierData>({
    queryKey: ['insight-vehicle', id],
    queryFn: () => api.get(`/insights/vehicle/${id}`).then(r => r.data.data),
    enabled: !!id,
  })

  // Javob saqlangach — server tahlilini majburan yangilab, dosyeni qayta olamiz
  const onChanged = async () => {
    await api.get('/insights', { params: { refresh: '1' } }).catch(() => undefined)
    qc.invalidateQueries({ queryKey: ['insight-vehicle', id] })
    qc.invalidateQueries({ queryKey: ['insights'] })
  }

  if (isLoading) return <div className="p-10 text-center text-gray-500">Dosye tayyorlanmoqda...</div>
  if (isError || !data) return <div className="p-10 text-center text-red-600">Dosyeni yuklab bo'lmadi.</div>

  const v = data.vehicle
  const chart = data.monthly.map(m => ({ ...m, label: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}` }))
  const hasMoney = chart.some(m => m.fuel + m.repairs + m.other > 0)
  const events = kind ? data.timeline.filter(e => e.kind === kind) : data.timeline
  const kinds = [...new Set(data.timeline.map(e => e.kind))]

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div>
        <Link to="/insights" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600"><ArrowLeft className="w-4 h-4" /> Tahlil</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold font-mono text-gray-900 dark:text-white">{v.plate}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {v.brand} {v.model}, {v.year} · {STATUS[v.status] || v.status} · {fmt(v.mileage)} km
              {v.lastGpsSignal && ` · GPS: ${formatDate(v.lastGpsSignal)}`}
            </p>
          </div>
          <Link to={`/vehicles/${v.id}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Mashina kartochkasi →</Link>
        </div>
      </div>

      {/* Avtopark bilan solishtirish */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {data.metrics.map(m => <MetricCard key={m.label} m={m} />)}
      </div>

      {/* Ochiq savollar */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 font-semibold text-gray-800 dark:text-gray-100">
          Ochiq savollar ({data.findings.length})
        </div>
        {data.findings.length === 0
          ? <p className="p-4 text-sm text-gray-500">Bu mashina bo'yicha ochiq savol yo'q.</p>
          : <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {data.findings.map(f => <FindingRow key={f.fingerprint} f={f} showPlate={false} onDismiss={setDismissing} onAssign={setAssigning} onChanged={onChanged} />)}
            </div>}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Oylik xarajatlar */}
        <div className="glass-card rounded-xl p-4 lg:col-span-2">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">12 oylik xarajat</h3>
          {hasMoney ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))} width={44} />
                  <Tooltip formatter={(n: number) => `${fmt(n)} so'm`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="fuel" name="Yoqilg'i" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="repairs" name="Ta'mir" stackId="a" fill="#f97316" />
                  <Bar dataKey="other" name="Boshqa" stackId="a" fill="#a3a3a3" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-sm text-gray-500">Oxirgi 12 oyda xarajat yozilmagan.</p>}
        </div>

        {/* Xizmatlar */}
        <div className="glass-card rounded-xl p-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Xizmatlar holati</h3>
          {data.services.length === 0 ? <p className="text-sm text-gray-500">Xizmat intervallari sozlanmagan.</p> : (
            <div className="space-y-2.5">
              {data.services.map(s => (
                <div key={s.type} className="flex items-start justify-between gap-2 text-sm">
                  <div>
                    <div className="text-gray-800 dark:text-gray-200">{s.type}</div>
                    <div className="text-xs text-gray-500">{s.lastDate ? formatDate(s.lastDate) : '—'}{s.lastKm != null ? `, ${fmt(s.lastKm)} km` : ''}</div>
                  </div>
                  {s.leftKm != null && (
                    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap',
                      s.leftKm < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : s.leftKm < 1000 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300')}>
                      {s.leftKm < 0 ? `${fmt(-s.leftKm)} km o'tgan` : `${fmt(s.leftKm)} km qoldi`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Sug'urta</span><span>{v.insuranceExpiry ? formatDate(v.insuranceExpiry) : '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Texosmotr</span><span>{v.techInspectionExpiry ? formatDate(v.techInspectionExpiry) : '—'}</span></div>
          </div>
        </div>
      </div>

      {/* Hayot tarixi */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Hayot tarixi</h3>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setKind('')} className={cn('text-xs px-2.5 py-1 rounded-full border', !kind ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 dark:border-gray-600')}>Hammasi</button>
            {kinds.map(k => (
              <button key={k} onClick={() => setKind(kind === k ? '' : k)} className={cn('text-xs px-2.5 py-1 rounded-full border', kind === k ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 dark:border-gray-600')}>
                {KIND[k]?.label || k}
              </button>
            ))}
          </div>
        </div>
        {events.length === 0 ? <p className="text-sm text-gray-500">Yozuv yo'q.</p> : (
          <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-3">
            {events.map((e, i) => {
              const k = KIND[e.kind] || KIND.repair
              const Icon = k.icon
              return (
                <li key={i} className="ml-5">
                  <span className={cn('absolute -left-[9px] mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white dark:bg-gray-900 ring-2',
                    e.flag === 'critical' ? 'ring-red-400' : e.flag === 'warning' ? 'ring-amber-400' : 'ring-gray-200 dark:ring-gray-700')}>
                    <Icon className={cn('w-2.5 h-2.5', k.color)} />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm text-gray-900 dark:text-gray-100">
                      <span className="text-xs text-gray-400 mr-2 font-mono">{formatDate(e.date)}</span>{e.title}
                    </p>
                    {!!e.amount && <span className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmt(e.amount)} so'm</span>}
                  </div>
                  {e.detail && <p className="text-xs text-gray-500 dark:text-gray-400">{e.detail}</p>}
                </li>
              )
            })}
          </ol>
        )}
      </div>

      <DismissModal finding={dismissing} ruleName="" onClose={() => { setDismissing(null); qc.invalidateQueries({ queryKey: ['insight-vehicle', id] }) }} />
      <AssignModal finding={assigning} onClose={() => setAssigning(null)} onChanged={onChanged} />
    </div>
  )
}
