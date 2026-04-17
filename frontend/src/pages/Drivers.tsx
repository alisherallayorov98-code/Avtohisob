import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, TrendingUp, AlertTriangle, CheckCircle, Truck, Fuel, Wrench, Clock } from 'lucide-react'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'

interface DriverStat {
  driverId: string
  driverName: string
  trips: number
  totalKm: number
  avgKmPerTrip: number
  totalFuelIssued: number
  totalFuelConsumed: number
  avgFuelPer100Km: number | null
  avgTripHours: number | null
  vehicleCount: number
  maintenanceCost: number
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high'
}

interface DriversData {
  drivers: DriverStat[]
  period: { from: string; to: string }
  totalTrips: number
  totalKm: number
}

const RISK_CONFIG = {
  low:    { label: 'Xavfsiz',  color: 'text-green-600 bg-green-50 dark:bg-green-900/20',   dot: 'bg-green-500' },
  medium: { label: "O'rtacha", color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20', dot: 'bg-yellow-500' },
  high:   { label: 'Xavfli',   color: 'text-red-600 bg-red-50 dark:bg-red-900/20',          dot: 'bg-red-500' },
}

const MONTHS = ['', 'Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

export default function Drivers() {
  const today = new Date()
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000)
  const [from, setFrom] = useState(ninetyDaysAgo.toISOString().slice(0, 10))
  const [to, setTo] = useState(today.toISOString().slice(0, 10))
  const [sort, setSort] = useState<'riskScore' | 'totalKm' | 'trips'>('riskScore')

  const { data, isLoading } = useQuery<DriversData>({
    queryKey: ['driver-stats', from, to],
    queryFn: () => api.get('/analytics/drivers', { params: { from, to } }).then(r => r.data),
    staleTime: 120000,
  })

  const drivers = [...(data?.drivers ?? [])].sort((a, b) => b[sort] - a[sort])
  const highRisk = drivers.filter(d => d.riskLevel === 'high').length
  const medRisk = drivers.filter(d => d.riskLevel === 'medium').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-7 h-7 text-blue-600" />
            Haydovchi Analitikasi
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Yo'lxatlar bo'yicha haydovchi faoliyati va xavf tahlili
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="text-sm px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-gray-400 text-sm">—</span>
          <input type="date" value={to} min={from} max={today.toISOString().slice(0, 10)} onChange={e => setTo(e.target.value)}
            className="text-sm px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs text-gray-400 mb-1">Jami haydovchilar</div>
          <div className="text-2xl font-bold text-blue-600">{drivers.length}</div>
          <div className="text-xs text-gray-400">{data?.totalTrips ?? 0} ta safari</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs text-gray-400 mb-1">Jami km</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{(data?.totalKm ?? 0).toLocaleString()}</div>
          <div className="text-xs text-gray-400">barcha haydovchilar</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs text-gray-400 mb-1">Xavfli haydovchi</div>
          <div className={`text-2xl font-bold ${highRisk > 0 ? 'text-red-600' : 'text-gray-400'}`}>{highRisk}</div>
          <div className="text-xs text-gray-400">zudlik bilan tekshirish</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs text-gray-400 mb-1">O'rtacha xavf</div>
          <div className={`text-2xl font-bold ${medRisk > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{medRisk}</div>
          <div className="text-xs text-gray-400">nazorat talab qiladi</div>
        </div>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Saralash:</span>
        {([['riskScore', 'Xavf skori'], ['totalKm', 'Km'], ['trips', 'Safarlar']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setSort(key)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${sort === key ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">Haydovchilar reytingi</h2>
        </div>
        {isLoading ? (
          <div className="py-16 flex justify-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : drivers.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            Bu davr uchun yo'lxat ma'lumoti yo'q
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-5 pb-3 pt-2 font-medium">#</th>
                  <th className="pb-3 pt-2 pr-4 font-medium">Haydovchi</th>
                  <th className="pb-3 pt-2 pr-4 font-medium"><Truck className="w-3 h-3 inline mr-1" />Safari / Km</th>
                  <th className="pb-3 pt-2 pr-4 font-medium"><Fuel className="w-3 h-3 inline mr-1" />Yoqilg'i sarfi</th>
                  <th className="pb-3 pt-2 pr-4 font-medium"><Clock className="w-3 h-3 inline mr-1" />O'rt. safari</th>
                  <th className="pb-3 pt-2 pr-4 font-medium"><Wrench className="w-3 h-3 inline mr-1" />Ta'mirlash</th>
                  <th className="pb-3 pt-2 pr-5 font-medium">Xavf</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d, i) => {
                  const risk = RISK_CONFIG[d.riskLevel]
                  return (
                    <tr key={d.driverId} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                      <td className="px-5 py-3 text-gray-400 text-sm">{i + 1}</td>
                      <td className="py-3 pr-4">
                        <div className="font-medium text-gray-900 dark:text-white">{d.driverName}</div>
                        <div className="text-xs text-gray-400">{d.vehicleCount} ta mashina</div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{d.trips} safari</div>
                        <div className="text-xs text-gray-400">{d.totalKm.toLocaleString()} km · o'rt. {d.avgKmPerTrip.toLocaleString()} km</div>
                      </td>
                      <td className="py-3 pr-4">
                        {d.avgFuelPer100Km !== null ? (
                          <div>
                            <div className={`text-sm font-semibold ${d.avgFuelPer100Km > 15 ? 'text-red-600' : d.avgFuelPer100Km > 12 ? 'text-yellow-600' : 'text-gray-900 dark:text-white'}`}>
                              {d.avgFuelPer100Km} l/100km
                            </div>
                            <div className="text-xs text-gray-400">{d.totalFuelConsumed.toLocaleString()} l jami</div>
                          </div>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="py-3 pr-4 text-sm text-gray-600 dark:text-gray-300">
                        {d.avgTripHours !== null ? `${d.avgTripHours} soat` : '—'}
                      </td>
                      <td className="py-3 pr-4">
                        <div className={`text-sm font-medium ${d.maintenanceCost > 5000000 ? 'text-red-600' : d.maintenanceCost > 1000000 ? 'text-yellow-600' : 'text-gray-700 dark:text-gray-300'}`}>
                          {formatCurrency(d.maintenanceCost)}
                        </div>
                      </td>
                      <td className="py-3 pr-5">
                        <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${risk.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                          {risk.label}
                          <span className="ml-1 opacity-70">({d.riskScore})</span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Risk tushuntirish */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 text-xs text-blue-700 dark:text-blue-300">
        <div className="font-medium mb-1">Xavf skori qanday hisoblanadi?</div>
        <ul className="space-y-0.5 list-disc list-inside">
          <li>Yoqilg'i sarfi 15 l/100km dan oshsa: +30 ball</li>
          <li>Yoqilg'i sarfi 12–15 l/100km: +15 ball</li>
          <li>Ta'mirlash xarajati 5 mln dan oshsa: +25 ball</li>
          <li>5 dan ko'p turli mashina haydasa: +15 ball</li>
          <li>Jami 40+: Xavfli · 20–39: O'rtacha · 20 dan kam: Xavfsiz</li>
        </ul>
      </div>
    </div>
  )
}
