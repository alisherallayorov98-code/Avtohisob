import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import SearchableSelect from '../components/ui/SearchableSelect'
import Badge from '../components/ui/Badge'

// "Sarf hisoboti — 100 km ga" — Fuel.tsx sahifasidan mustaqil sahifaga ko'chirilgan.
// Quyishdan quyishgacha (fill-to-fill) metodikasi; ma'lumot manbai /fuel-records/norm-analysis.
export default function FuelConsumption() {
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const { data: normData } = useQuery({
    queryKey: ['fuel-norm-analysis', fromDate, toDate],
    queryFn: () => api.get('/fuel-records/norm-analysis', { params: { from: fromDate || undefined, to: toDate || undefined } }).then(r => r.data.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-all'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true' } }).then(r => r.data.data),
  })
  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} - ${v.brand} ${v.model}` }))

  // Davr presetlari (oy/hafta) — sana inputlarini to'ldiradi
  const setPeriodPreset = (preset: 'thisMonth' | 'lastMonth' | 'thisWeek') => {
    const now = new Date()
    let from: Date, to: Date
    if (preset === 'thisMonth') {
      from = new Date(now.getFullYear(), now.getMonth(), 1); to = now
    } else if (preset === 'lastMonth') {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0)
    } else {
      const dow = (now.getDay() + 6) % 7 // dushanba = 0
      from = new Date(now); from.setDate(now.getDate() - dow); to = now
    }
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setFromDate(iso(from)); setToDate(iso(to))
  }

  // Sarf bo'yicha kamayish tartibida; vehicleFilter bo'lsa bitta mashina
  const reportRows = (normData?.rows || [])
    .filter((r: any) => !vehicleFilter || r.vehicleId === vehicleFilter)
    .slice()
    .sort((a: any, b: any) => (b.actual ?? -1) - (a.actual ?? -1))
  const reportAvg = (() => {
    const withData = reportRows.filter((r: any) => r.actual != null && r.km > 0)
    if (!withData.length) return null
    const totalKm = withData.reduce((s: number, r: any) => s + Number(r.km), 0)
    const totalL = withData.reduce((s: number, r: any) => s + Number(r.consumedLiters), 0)
    return totalKm > 0 ? (totalL / totalKm) * 100 : null
  })()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link to="/fuel" className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-1">
            <ArrowLeft className="w-4 h-4" /> Yoqilg'iga qaytish
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-blue-500" /> Sarf hisoboti — 100 km ga
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Quyishdan quyishgacha (fill-to-fill). {fromDate || toDate ? `${fromDate || '...'} — ${toDate || '...'}` : 'oxirgi 90 kun'}
            {vehicleFilter ? ' · bitta mashina' : ' · barcha mashinalar'}
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3">
          <div className="min-w-56 flex-1 max-w-xs">
            <SearchableSelect
              options={[{ value: '', label: 'Barcha mashinalar' }, ...vehicles]}
              value={vehicleFilter}
              onChange={setVehicleFilter}
              placeholder="Avtomashina bo'yicha filter..."
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setPeriodPreset('thisWeek')} className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">Bu hafta</button>
            <button onClick={() => setPeriodPreset('thisMonth')} className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">Bu oy</button>
            <button onClick={() => setPeriodPreset('lastMonth')} className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">O'tgan oy</button>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {(fromDate || toDate) && (
              <button onClick={() => { setFromDate(''); setToDate('') }}
                className="px-2.5 py-1.5 text-xs text-red-500 hover:text-red-700 rounded-lg border border-red-200 hover:border-red-300">Tozalash</button>
            )}
            {reportAvg != null && (
              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">O'rtacha: <b className="text-gray-800 dark:text-gray-200">{reportAvg.toFixed(1)} L/100km</b></span>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900">
              <tr className="text-gray-500 text-xs border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-2 font-medium">Avtomashina</th>
                <th className="text-right px-3 py-2 font-medium">Masofa</th>
                <th className="text-right px-3 py-2 font-medium">Yoqilg'i</th>
                <th className="text-right px-3 py-2 font-medium">Sarf (100km)</th>
                <th className="text-right px-3 py-2 font-medium">Norma</th>
                <th className="text-left px-3 py-2 font-medium">Holat</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Ma'lumot yo'q</td></tr>
              ) : reportRows.map((r: any) => {
                const noData = r.actual == null
                return (
                  <tr key={r.vehicleId} className={`border-b border-gray-50 dark:border-gray-700/50 ${r.status === 'over' ? 'bg-red-50/60 dark:bg-red-900/10' : ''}`}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-gray-900 dark:text-white">{r.registrationNumber}</p>
                      <p className="text-xs text-gray-400">{r.brand} {r.model}</p>
                    </td>
                    <td className="text-right px-3 py-2 text-gray-600 dark:text-gray-300">
                      {r.km != null && r.km > 0 ? `${Number(r.km).toLocaleString()} km` : '—'}
                      {r.km > 0 && (
                        <span className={`ml-1 text-[10px] ${r.method === 'stop' ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                          {r.method === 'stop' ? 'aniq' : r.method === 'fill' ? 'GPS~' : 'odo'}
                        </span>
                      )}
                    </td>
                    <td className="text-right px-3 py-2 text-gray-600 dark:text-gray-300">{r.consumedLiters != null ? Number(r.consumedLiters).toFixed(0) : '—'}</td>
                    <td className={`text-right px-3 py-2 font-semibold ${r.status === 'over' ? 'text-red-600 dark:text-red-400' : r.status === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-gray-800 dark:text-gray-200'}`}>
                      {noData ? <span className="text-gray-300 font-normal text-xs">ma'lumot yo'q</span> : `${Number(r.actual).toFixed(1)} L/100km`}
                    </td>
                    <td className="text-right px-3 py-2 text-gray-500">{r.norm != null ? Number(r.norm).toFixed(1) : '—'}</td>
                    <td className="px-3 py-2">
                      {r.status === 'over' ? <Badge variant="danger">Yuqori</Badge>
                        : r.status === 'under' ? <Badge variant="info">Past</Badge>
                        : r.status === 'ok' ? <Badge variant="success">Normada</Badge>
                        : r.status === 'no_norm' ? <span className="text-xs text-amber-500">Norma yo'q</span>
                        : <span className="text-xs text-gray-400">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
