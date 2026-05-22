import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BrainCircuit, X, ChevronRight, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import api from '../../../lib/api'

interface OrgOverview {
  orgId: string | null
  orgName: string
  today: {
    visited: number
    notVisited: number
    noGps: number
    suspicious: number
    total: number
    coveragePct: number | null
  }
  vehicles: number
  overdueContainers: number
}

function coverageColor(pct: number | null) {
  if (pct === null) return { bar: 'bg-gray-200', text: 'text-gray-500', bg: 'bg-gray-50' }
  if (pct >= 80) return { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' }
  if (pct >= 50) return { bar: 'bg-amber-400', text: 'text-amber-700', bg: 'bg-amber-50' }
  return { bar: 'bg-red-400', text: 'text-red-700', bg: 'bg-red-50' }
}

interface OrgAiOverview {
  orgId: string
  orgName: string
  trainedPct: number
  trained: number
  total: number
  untrainedPairs: number
  lastTrainedAt: string | null
}

interface DrillVehicle {
  vehicle: { id: string; registrationNumber: string; brand?: string; model?: string }
  visited: number
  notVisited: number
  noGps: number
  suspicious: number
  total: number
  coveragePct: number | null
  trips: Array<{ status: string; mfyName?: string; districtName?: string }>
}

function fmtDate(dt?: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Org Drill-down Modal ──────────────────────────────────────────────────────
function OrgDrillModal({ orgId, orgName, date, onClose }: {
  orgId: string; orgName: string; date: string; onClose: () => void
}) {
  const { data, isLoading } = useQuery<{ data: DrillVehicle[]; orgName: string; date: string }>({
    queryKey: ['th-supervisor-daily', orgId, date],
    queryFn: () => api.get('/th/supervisor/daily', { params: { orgId, date } }).then(r => r.data),
    staleTime: 2 * 60 * 1000,
  })

  const vehicles = data?.data ?? []
  const totals = vehicles.reduce((acc, v) => ({
    visited: acc.visited + v.visited,
    notVisited: acc.notVisited + v.notVisited,
    noGps: acc.noGps + v.noGps,
    suspicious: acc.suspicious + v.suspicious,
  }), { visited: 0, notVisited: 0, noGps: 0, suspicious: 0 })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-800">{orgName}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{fmtDate(date)} — mashina bo'yicha kunlik hisobot</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Jami */}
        {vehicles.length > 0 && (
          <div className="flex gap-4 px-5 py-3 border-b border-gray-50 text-xs">
            <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> {totals.visited} bajarildi</span>
            <span className="flex items-center gap-1 text-red-600"><XCircle className="w-3.5 h-3.5" /> {totals.notVisited} bajarilmadi</span>
            <span className="flex items-center gap-1 text-gray-400">GPS yo'q: {totals.noGps}</span>
            {totals.suspicious > 0 && <span className="flex items-center gap-1 text-orange-500"><AlertTriangle className="w-3.5 h-3.5" /> {totals.suspicious} shubhali</span>}
          </div>
        )}

        <div className="overflow-y-auto flex-1 px-5 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Yuklanmoqda...</div>
          ) : vehicles.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">Bu sana uchun ma'lumot topilmadi</div>
          ) : (
            <div className="space-y-2">
              {vehicles.map((v, i) => {
                const c = coverageColor(v.coveragePct)
                return (
                  <div key={v.vehicle?.id ?? i} className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-bold text-sm text-gray-800">{v.vehicle?.registrationNumber}</span>
                        {v.vehicle?.brand && (
                          <span className="text-xs text-gray-400">{v.vehicle.brand} {v.vehicle.model}</span>
                        )}
                        {v.suspicious > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-orange-100 text-orange-600 font-medium">
                            {v.suspicious} shubhali
                          </span>
                        )}
                      </div>
                      <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-bold ${c.bg} ${c.text}`}>
                        {v.coveragePct !== null ? `${v.coveragePct}%` : v.noGps > 0 ? 'GPS yo\'q' : '—'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                      <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${v.coveragePct ?? 0}%` }} />
                    </div>
                    <div className="flex gap-3 text-xs text-gray-500">
                      <span className="text-emerald-600">{v.visited} ✓</span>
                      <span className="text-red-500">{v.notVisited} ✗</span>
                      {v.noGps > 0 && <span>{v.noGps} GPS yo'q</span>}
                      <span className="text-gray-400">{v.total} jami</span>
                    </div>
                    {v.trips.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {v.trips.slice(0, 10).map((t, j) => (
                          <span key={j} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            t.status === 'visited' ? 'bg-emerald-50 text-emerald-700' :
                            t.status === 'not_visited' ? 'bg-red-50 text-red-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {t.mfyName || '?'}
                          </span>
                        ))}
                        {v.trips.length > 10 && (
                          <span className="text-[10px] text-gray-400">+{v.trips.length - 10}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SupervisorPage() {
  const [selectedOrg, setSelectedOrg] = useState<{ id: string; name: string } | null>(null)
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  const { data, isLoading, error } = useQuery({
    queryKey: ['th-supervisor-overview'],
    queryFn: () => api.get('/th/supervisor/overview').then(r => r.data.data as OrgOverview[]),
    refetchInterval: 5 * 60 * 1000,
  })

  const { data: aiData } = useQuery<OrgAiOverview[]>({
    queryKey: ['th-supervisor-ai'],
    queryFn: () => api.get('/th/supervisor/ai-overview').then(r => r.data.data),
    refetchInterval: 10 * 60 * 1000,
  })

  const todayLabel = today.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' })

  const totals = data?.reduce((acc, org) => ({
    visited: acc.visited + org.today.visited,
    total: acc.total + org.today.total,
    suspicious: acc.suspicious + org.today.suspicious,
    vehicles: acc.vehicles + org.vehicles,
    overdueContainers: acc.overdueContainers + org.overdueContainers,
  }), { visited: 0, total: 0, suspicious: 0, vehicles: 0, overdueContainers: 0 })

  const overallPct = totals && totals.total > 0
    ? Math.round(totals.visited / totals.total * 100)
    : null

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Supervisor ko'rinishi</h1>
        <p className="text-sm text-gray-500 mt-0.5">{todayLabel} — barcha tashkilotlar bo'yicha yig'ma</p>
      </div>

      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-emerald-50 rounded-xl p-4">
            <p className="text-2xl font-bold text-emerald-700">{overallPct !== null ? `${overallPct}%` : '—'}</p>
            <p className="text-xs text-emerald-600 mt-0.5">Umumiy qamrov</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-2xl font-bold text-blue-700">{totals.vehicles}</p>
            <p className="text-xs text-blue-600 mt-0.5">Faol mashinalar</p>
          </div>
          <div className="bg-orange-50 rounded-xl p-4">
            <p className="text-2xl font-bold text-orange-700">{totals.suspicious}</p>
            <p className="text-xs text-orange-600 mt-0.5">Shubhali tashriflar</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4">
            <p className="text-2xl font-bold text-red-700">{totals.overdueContainers}</p>
            <p className="text-xs text-red-600 mt-0.5">Kechikkan konteynerlar</p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Yuklanmoqda...</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Supervisor ma'lumotlarini yuklashda xato. Faqat super_admin uchun mavjud.
        </div>
      )}
      {data && data.length === 0 && (
        <div className="bg-gray-50 rounded-xl p-8 text-center text-gray-400 text-sm">
          Faol Toza-Hudud obunasi topilmadi
        </div>
      )}

      {aiData && aiData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <BrainCircuit className="w-4 h-4 text-purple-600" />
            <p className="font-semibold text-gray-800 text-sm">AI Ko'cha Tahlili holati</p>
          </div>
          <div className="space-y-2">
            {aiData.map(org => (
              <div key={org.orgId} className="flex items-center gap-3 text-xs">
                <p className="w-32 truncate font-medium text-gray-700">{org.orgName}</p>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${org.trainedPct >= 80 ? 'bg-purple-500' : org.trainedPct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${org.trainedPct}%` }}
                  />
                </div>
                <span className="w-10 text-right font-bold text-gray-700">{org.trainedPct}%</span>
                <span className="text-gray-400 w-20 text-right">{fmtDate(org.lastTrainedAt)}</span>
                {org.untrainedPairs > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">
                    +{org.untrainedPairs}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">Tashkilot kartasini bosib batafsil ko'rish mumkin</p>
          {data.map((org) => {
            const c = coverageColor(org.today.coveragePct)
            return (
              <div
                key={org.orgId}
                className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 cursor-pointer hover:border-emerald-300 hover:shadow-sm transition-all"
                onClick={() => org.orgId && setSelectedOrg({ id: org.orgId, name: org.orgName })}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div>
                      <p className="font-semibold text-gray-800">{org.orgName}</p>
                      <p className="text-xs text-gray-400 font-mono">{org.orgId?.slice(0, 8) || 'global'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${c.bg} ${c.text}`}>
                      {org.today.coveragePct !== null ? `${org.today.coveragePct}%` : '—'}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </div>
                </div>

                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${c.bar}`}
                    style={{ width: `${org.today.coveragePct ?? 0}%` }} />
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
                  <div className="text-center">
                    <p className="font-bold text-emerald-700">{org.today.visited}</p>
                    <p className="text-gray-400">Bajarildi</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-red-600">{org.today.notVisited}</p>
                    <p className="text-gray-400">Bajarilmadi</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-gray-500">{org.today.noGps}</p>
                    <p className="text-gray-400">GPS yo'q</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-orange-600">{org.today.suspicious}</p>
                    <p className="text-gray-400">Shubhali</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-blue-700">{org.vehicles}</p>
                    <p className="text-gray-400">Mashinalar</p>
                  </div>
                  <div className="text-center">
                    <p className={`font-bold ${org.overdueContainers > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {org.overdueContainers}
                    </p>
                    <p className="text-gray-400">Kechikgan</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectedOrg && (
        <OrgDrillModal
          orgId={selectedOrg.id}
          orgName={selectedOrg.name}
          date={todayStr}
          onClose={() => setSelectedOrg(null)}
        />
      )}
    </div>
  )
}
