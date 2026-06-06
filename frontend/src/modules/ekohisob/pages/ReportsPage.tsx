import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Building2, TrendingUp, DollarSign, Target, Loader2, Download, Trophy } from 'lucide-react'
import ekoApi from '../lib/ekoApi'

interface Overview {
  kpi: { activeEntities: number; collectedThisMonth: number; expectedMonthly: number; collectRate: number; totalCollected6m: number }
  monthlyTrend: { month: string; label: string; collected: number }[]
  byDistrict: { name: string; total: number; paid: number; unpaid: number; collected: number; payRate: number }[]
  byInspector: { name: string; collected: number; payments: number }[]
  currentMonth: string
}

const fmt = (n: number) => n.toLocaleString('uz-UZ')

export default function ReportsPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ekoApi.get('/reports/overview')
      .then(res => setData(res.data.data ?? res.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function exportExcel() {
    if (!data) return
    const rows: string[][] = [['HISOBOT', data.currentMonth]]
    rows.push([], ['Oylik yig\'im dinamikasi'], ['Oy', 'Yig\'ilgan'])
    data.monthlyTrend.forEach(m => rows.push([m.label, String(m.collected)]))
    rows.push([], ['Tuman bo\'yicha'], ['Tuman', 'Jami', 'To\'lagan', 'To\'lamagan', 'Yig\'ilgan', 'Foiz%'])
    data.byDistrict.forEach(d => rows.push([d.name, String(d.total), String(d.paid), String(d.unpaid), String(d.collected), String(d.payRate)]))
    rows.push([], ['Inspektor samaradorligi'], ['Inspektor', 'Yig\'ilgan (6 oy)', 'To\'lovlar soni'])
    data.byInspector.forEach(i => rows.push([i.name, String(i.collected), String(i.payments)]))
    const csv = rows.map(r => r.join('\t')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/tab-separated-values;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `ekohisob-hisobot-${data.currentMonth}.xls`; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-green-600" /></div>
  }
  if (!data) {
    return <div className="flex-1 flex items-center justify-center text-gray-400">Ma'lumot yuklanmadi</div>
  }

  const maxDistrictCollected = Math.max(1, ...data.byDistrict.map(d => d.collected))
  const maxInspector = Math.max(1, ...data.byInspector.map(i => i.collected))

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Hisobot va analitika</h1>
          <p className="text-xs text-gray-500 mt-0.5">Oxirgi 6 oy · {data.currentMonth} joriy oy</p>
        </div>
        <button onClick={exportExcel}
          className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">
          <Download className="w-4 h-4" /> Excel
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Faol tashkilotlar', value: data.kpi.activeEntities, icon: Building2, color: 'bg-blue-50 text-blue-600' },
          { label: 'Bu oy yig\'ilgan', value: fmt(data.kpi.collectedThisMonth), icon: DollarSign, color: 'bg-green-50 text-green-600', amount: true },
          { label: 'Yig\'im foizi', value: data.kpi.collectRate + '%', icon: Target, color: data.kpi.collectRate >= 80 ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600' },
          { label: '6 oy jami', value: fmt(data.kpi.totalCollected6m), icon: TrendingUp, color: 'bg-indigo-50 text-indigo-600', amount: true },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${k.color}`}><k.icon className="w-4 h-4" /></div>
              <p className="text-xs text-gray-500">{k.label}</p>
            </div>
            <p className={`font-bold text-gray-900 ${k.amount ? 'text-base' : 'text-2xl'}`}>{k.value}{k.amount && <span className="text-xs font-normal text-gray-400"> so'm</span>}</p>
          </div>
        ))}
      </div>

      {/* Oylik dinamika grafik */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-600" /> Oylik yig'im dinamikasi
        </h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.monthlyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v} />
            <Tooltip
              formatter={(v: any) => [`${fmt(v)} so'm`, 'Yig\'ilgan']}
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
            />
            <Bar dataKey="collected" fill="#16a34a" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Tuman bo'yicha */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-4">📍 Tuman bo'yicha (joriy oy)</h2>
          {data.byDistrict.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Ma'lumot yo'q</p>
          ) : (
            <div className="space-y-3">
              {data.byDistrict.map(d => (
                <div key={d.name}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{d.name}</span>
                    <span className="text-gray-500">{fmt(d.collected)} so'm · <span className={d.payRate >= 80 ? 'text-green-600' : d.payRate >= 50 ? 'text-orange-500' : 'text-red-500'}>{d.payRate}%</span></span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.round(d.collected * 100 / maxDistrictCollected)}%` }} />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">{d.paid}/{d.total} to'lagan · {d.unpaid} qarzdor</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inspektor samaradorligi */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" /> Inspektor samaradorligi (6 oy)
          </h2>
          {data.byInspector.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Ma'lumot yo'q</p>
          ) : (
            <div className="space-y-3">
              {data.byInspector.map((i, idx) => (
                <div key={i.name}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700 flex items-center gap-1.5">
                      {idx < 3 && ['🥇', '🥈', '🥉'][idx]} {i.name}
                    </span>
                    <span className="text-gray-500">{fmt(i.collected)} so'm</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-amber-400 h-2 rounded-full" style={{ width: `${Math.round(i.collected * 100 / maxInspector)}%` }} />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">{i.payments} ta to'lov qabul qilgan</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
