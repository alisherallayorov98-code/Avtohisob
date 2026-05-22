import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Trophy, TrendingUp, Calendar, Flame } from 'lucide-react'
import api from '../../../lib/api'

interface DriverRank {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  rank: number
  score: number
  coveragePct: number
  visitedDays: number
  workingDays: number
  attendancePct: number
  streak: number
  badge: 'gold' | 'silver' | 'bronze' | null
}

interface LeaderboardData {
  month: string
  drivers: DriverRank[]
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-')
  const months = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
  return `${months[parseInt(mo) - 1]} ${y}`
}

function prevMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 2, 1))
  return d.toISOString().slice(0, 7)
}
function nextMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo, 1))
  return d.toISOString().slice(0, 7)
}

const BADGE_CFG = {
  gold:   { emoji: '🥇', bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', ring: 'ring-2 ring-amber-400' },
  silver: { emoji: '🥈', bg: 'bg-gray-50',  border: 'border-gray-300',  text: 'text-gray-700',  ring: 'ring-2 ring-gray-300' },
  bronze: { emoji: '🥉', bg: 'bg-orange-50',border: 'border-orange-300',text: 'text-orange-800',ring: 'ring-2 ring-orange-400' },
}

function ScoreBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  )
}

export default function DriverLeaderboardPage() {
  const today = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(today)

  const { data, isLoading } = useQuery<{ data: LeaderboardData }>({
    queryKey: ['th-leaderboard', month],
    queryFn: () => api.get('/th/driver/leaderboard', { params: { month } }).then(r => r.data),
  })

  const drivers = data?.data?.drivers ?? []
  const top3 = drivers.slice(0, 3)
  const rest = drivers.slice(3)

  function handleExcel() {
    window.open(`/api/th/driver/leaderboard/excel?month=${month}`, '_blank')
  }

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5 max-w-4xl">
      {/* Sarlavha */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            Haydovchi reytingi
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Ball = qamrov 50% + davomat 30% + streak 20%</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Oy tanlash */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-1 py-1">
            <button
              onClick={() => setMonth(prevMonth(month))}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[120px] text-center">
              {monthLabel(month)}
            </span>
            <button
              onClick={() => setMonth(nextMonth(month))}
              disabled={month >= today}
              className="p-1 hover:bg-gray-100 rounded disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </div>

          <button
            onClick={handleExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400 text-sm animate-pulse">Yuklanmoqda...</div>
      ) : drivers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">Bu oy uchun ma'lumot yo'q</div>
      ) : (
        <>
          {/* Top-3 Podium */}
          {top3.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {/* 2-o'rin chapda */}
              {[
                top3[1] ?? null,
                top3[0] ?? null,
                top3[2] ?? null,
              ].map((d, i) => {
                if (!d) return <div key={i} />
                const badgeCfg = d.badge ? BADGE_CFG[d.badge] : null
                const heights = ['h-28', 'h-36', 'h-24']
                return (
                  <div key={d.vehicleId} className={`${badgeCfg?.bg ?? 'bg-gray-50'} ${badgeCfg?.border ?? 'border-gray-200'} border rounded-xl p-3 flex flex-col items-center justify-end ${heights[i]} ${badgeCfg?.ring ?? ''}`}>
                    <span className="text-2xl mb-1">{badgeCfg?.emoji ?? ''}</span>
                    <p className="font-bold text-sm text-gray-800 text-center leading-tight">{d.registrationNumber}</p>
                    <p className={`text-lg font-black ${badgeCfg?.text ?? 'text-gray-700'}`}>{d.score}</p>
                    <p className="text-[10px] text-gray-400">ball</p>
                  </div>
                )
              })}
            </div>
          )}

          {/* To'liq jadval */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="font-semibold text-sm text-gray-700">Barcha haydovchilar</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">#</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">Mashina</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500">Ball</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 hidden sm:table-cell">
                      <span className="flex items-center gap-1 justify-end"><TrendingUp className="w-3 h-3" />Qamrov</span>
                    </th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 hidden sm:table-cell">
                      <span className="flex items-center gap-1 justify-end"><Calendar className="w-3 h-3" />Davomat</span>
                    </th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 hidden md:table-cell">
                      <span className="flex items-center gap-1 justify-end"><Flame className="w-3 h-3" />Streak</span>
                    </th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 hidden md:table-cell">Unvon</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map(d => {
                    const badgeCfg = d.badge ? BADGE_CFG[d.badge] : null
                    return (
                      <tr
                        key={d.vehicleId}
                        className={`border-b border-gray-50 hover:bg-gray-50/50 ${badgeCfg?.bg ?? ''}`}
                      >
                        <td className="px-4 py-3 font-bold text-gray-500 text-sm">{d.rank}</td>
                        <td className="px-3 py-3">
                          <div>
                            <p className="font-medium text-gray-800 text-sm">{d.registrationNumber}</p>
                            {(d.brand || d.model) && (
                              <p className="text-[10px] text-gray-400">{d.brand} {d.model}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className={`font-black text-base ${d.score >= 80 ? 'text-emerald-700' : d.score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                              {d.score}
                            </span>
                            <div className="w-16">
                              <ScoreBar value={d.score} />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right hidden sm:table-cell">
                          <span className={`text-sm font-semibold ${d.coveragePct >= 80 ? 'text-emerald-700' : d.coveragePct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                            {d.coveragePct}%
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right hidden sm:table-cell">
                          <div className="text-sm text-gray-700">
                            <span className="font-semibold">{d.attendancePct}%</span>
                            <span className="text-gray-400 text-[10px] ml-1">({d.visitedDays}/{d.workingDays} kun)</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right hidden md:table-cell">
                          {d.streak > 0 ? (
                            <span className="flex items-center gap-1 justify-end text-orange-500 font-semibold text-sm">
                              <Flame className="w-3.5 h-3.5" />
                              {d.streak}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-sm">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          {d.badge && badgeCfg && (
                            <span className={`text-sm ${badgeCfg.text} font-medium`}>
                              {badgeCfg.emoji}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Izoh */}
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
              <p className="text-[10px] text-gray-400">
                Ball = Qamrov% × 0.5 + Davomat% × 0.3 + min(Streak, 14)/14 × 100 × 0.2
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
