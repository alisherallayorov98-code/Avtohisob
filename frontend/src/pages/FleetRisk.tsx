import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, AlertTriangle, CheckCircle, TrendingUp, Link as LinkIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import Badge from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import Button from '../components/ui/Button'

interface RiskVehicle {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  branch: string
  riskScore: number
  riskLevel: 'high' | 'medium' | 'low'
  healthScore: number
  overdueCount: number
  overhaulCount: number
  recentMaint: number
  unresolvedAnomalies: number
  lastInspection: string | null
  lastInspectionStatus: string | null
  factors: string[]
}

interface RiskSummary {
  high: number
  medium: number
  low: number
  total: number
}

const RISK_CONFIG: Record<string, { label: string; variant: any; icon: React.ReactNode }> = {
  high:   { label: 'Yuqori xavf', variant: 'danger',  icon: <ShieldAlert className="w-4 h-4 text-red-600" /> },
  medium: { label: 'O\'rta xavf', variant: 'warning', icon: <AlertTriangle className="w-4 h-4 text-yellow-600" /> },
  low:    { label: 'Past xavf',   variant: 'success', icon: <CheckCircle className="w-4 h-4 text-green-600" /> },
}

function SimpleStatCard({ label, value, valueClass }: { label: string; value: number | string; valueClass?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass || 'text-gray-900 dark:text-white'}`}>{value}</div>
    </div>
  )
}

function RiskBar({ score }: { score: number }) {
  const color = score >= 60 ? 'bg-red-500' : score >= 30 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right text-gray-600 dark:text-gray-300">{score}</span>
    </div>
  )
}

export default function FleetRisk() {
  const [levelFilter, setLevelFilter] = useState('')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['fleet-risk', levelFilter],
    queryFn: () => api.get('/fleet-risk', { params: { level: levelFilter || undefined } }).then(r => r.data),
  })

  const vehicles: RiskVehicle[] = Array.isArray(data?.data) ? data.data : []
  const summary: RiskSummary = data?.summary || { high: 0, medium: 0, low: 0, total: 0 }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-red-600" />
            Profilaktika dashboardi
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Flot xavf darajasi tahlili</p>
        </div>
        <Button
          variant="secondary"
          icon={<TrendingUp className="w-4 h-4" />}
          onClick={() => refetch()}
          loading={isFetching}
        >
          Yangilash
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SimpleStatCard label="Jami mashina" value={summary.total} />
        <SimpleStatCard label="Yuqori xavf" value={summary.high} valueClass="text-red-600" />
        <SimpleStatCard label="O'rta xavf" value={summary.medium} valueClass="text-yellow-600" />
        <SimpleStatCard label="Past xavf" value={summary.low} valueClass="text-green-600" />
      </div>

      {/* High risk warning banner */}
      {summary.high > 0 && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-700 dark:text-red-300">{summary.high} ta mashina yuqori xavf darajasida!</div>
            <div className="text-sm text-red-600 dark:text-red-400 mt-0.5">
              Bu mashinalar darhol tekshiruv va xizmat ko'rsatishni talab qiladi.
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      <Card>
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex flex-wrap gap-2">
          {(['', 'high', 'medium', 'low'] as const).map(lvl => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                levelFilter === lvl
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {lvl === '' ? 'Barchasi' : RISK_CONFIG[lvl]?.label || lvl}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {['Mashina', 'Filial', 'Xavf ball', 'Xavf darajasi', 'Sog\'liq', 'Muddati o\'tgan', 'Motor remont', 'Xavf sabablari', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Yuklanmoqda...</td></tr>
              ) : vehicles.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Mashina topilmadi</td></tr>
              ) : vehicles.map(v => {
                const cfg = RISK_CONFIG[v.riskLevel]
                return (
                  <tr key={v.vehicleId} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${v.riskLevel === 'high' ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}>
                    <td className="px-4 py-3">
                      <Link to={`/vehicles/${v.vehicleId}`} className="font-medium text-blue-600 hover:underline">
                        {v.registrationNumber}
                      </Link>
                      <div className="text-xs text-gray-400">{v.brand} {v.model}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{v.branch || '—'}</td>
                    <td className="px-4 py-3 min-w-[120px]">
                      <RiskBar score={v.riskScore} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {cfg?.icon}
                        <Badge variant={cfg?.variant || 'info'}>{cfg?.label || v.riskLevel}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {v.healthScore ? (
                        <span className={`font-semibold ${v.healthScore >= 80 ? 'text-green-600' : v.healthScore >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {v.healthScore}
                        </span>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {v.overdueCount > 0 ? (
                        <span className="text-red-600 font-semibold">{v.overdueCount} ta</span>
                      ) : (
                        <span className="text-green-600">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {v.overhaulCount >= 2 ? (
                        <span className="text-red-600 font-semibold">{v.overhaulCount}x ⚠</span>
                      ) : (
                        <span className="text-gray-500">{v.overhaulCount}x</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {v.factors.length === 0 ? (
                        <span className="text-green-500 text-xs">Muammo yo'q</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {v.factors.map((f, i) => (
                            <li key={i} className="text-xs text-gray-600 dark:text-gray-300 flex items-start gap-1">
                              <span className="text-orange-400 flex-shrink-0 mt-0.5">•</span>
                              {f}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/vehicles/${v.vehicleId}`}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                      >
                        <LinkIcon className="w-3 h-3" />
                        Batafsil
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Risk scoring explanation */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Xavf ball tizimi</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium text-red-600">60+ ball — Yuqori xavf</div>
                <div className="text-gray-500 text-xs mt-0.5">Darhol choralar ko'rish zarur</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium text-yellow-600">30-59 ball — O'rta xavf</div>
                <div className="text-xs text-gray-500 mt-0.5">Kuzatib borish tavsiya etiladi</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium text-green-600">0-29 ball — Past xavf</div>
                <div className="text-xs text-gray-500 mt-0.5">Mashina yaxshi holatda</div>
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500">
            Xavf ball quyidagilardan hisoblanadi: sog'liq ko'rsatkichi, muddati o'tgan xizmatlar, yil ichida remont soni, so'ngi oylik tekshiruv mavjudligi.
          </div>
        </div>
      </Card>
    </div>
  )
}
