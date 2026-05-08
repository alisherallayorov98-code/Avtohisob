import { useQuery } from '@tanstack/react-query'
import { BrainCircuit } from 'lucide-react'
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

function fmtDate(dt?: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function SupervisorPage() {
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

  const today = new Date().toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' })

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
        <p className="text-sm text-gray-500 mt-0.5">{today} — barcha tashkilotlar bo'yicha yig'ma</p>
      </div>

      {/* Yig'ma statistika */}
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

      {/* Tashkilotlar ro'yxati */}
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
      {/* AI Fingerprint holati (supervisor) */}
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
          {data.map((org) => {
            const c = coverageColor(org.today.coveragePct)
            return (
              <div key={org.orgId} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-semibold text-gray-800">{org.orgName}</p>
                    <p className="text-xs text-gray-400 font-mono">{org.orgId?.slice(0, 8) || 'global'}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${c.bg} ${c.text}`}>
                    {org.today.coveragePct !== null ? `${org.today.coveragePct}%` : '—'}
                  </span>
                </div>

                {/* Progress */}
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${c.bar}`}
                    style={{ width: `${org.today.coveragePct ?? 0}%` }} />
                </div>

                {/* Statistika */}
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
    </div>
  )
}
