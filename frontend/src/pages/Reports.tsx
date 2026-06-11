import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  TrendingUp, Fuel, Wrench, Package, Building2, BarChart3, Calendar, Download,
  Save, BookOpen, Trash2, FileSpreadsheet, Car, User, ExternalLink, ChevronDown,
  Printer, LayoutDashboard, AlertTriangle, ArrowUp, ArrowDown, Minus,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import Table from '../components/ui/Table'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import SearchableSelect from '../components/ui/SearchableSelect'
import { useAuthStore } from '../stores/authStore'

type ReportType = 'summary' | 'vehicles' | 'expenses' | 'fuel' | 'maintenance' | 'inventory' | 'branch'
type MainTab = 'live' | 'saved' | 'vehicle-detail'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

// ── Yordamchi: o'tgan oy/bu oy/chorak sana presetlari ────────────────────────
function getPresetRange(preset: string): { from: string; to: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  if (preset === 'this-month') {
    return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now) }
  }
  if (preset === 'last-month') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const e = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: fmt(s), to: fmt(e) }
  }
  if (preset === 'this-quarter') {
    const q = Math.floor(now.getMonth() / 3)
    return { from: fmt(new Date(now.getFullYear(), q * 3, 1)), to: fmt(now) }
  }
  if (preset === 'this-year') {
    return { from: fmt(new Date(now.getFullYear(), 0, 1)), to: fmt(now) }
  }
  if (preset === 'last-year') {
    return { from: fmt(new Date(now.getFullYear() - 1, 0, 1)), to: fmt(new Date(now.getFullYear() - 1, 11, 31)) }
  }
  return { from: '', to: '' }
}

// ── Delta badge (o'sish/kamayish ko'rsatkichi) ────────────────────────────────
function DeltaBadge({ pct, inverse = false }: { pct: number | null; inverse?: boolean }) {
  if (pct === null) return <span className="text-xs text-gray-400">—</span>
  const good = inverse ? pct < 0 : pct > 0
  const icon = pct > 0 ? <ArrowUp className="w-3 h-3" /> : pct < 0 ? <ArrowDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
      pct === 0 ? 'bg-gray-100 text-gray-500' :
      good ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {icon}{Math.abs(pct)}%
    </span>
  )
}

// ── Export dropdown ───────────────────────────────────────────────────────────
function ExportMenu({
  onExcel, onFull, on1C, onPrint,
  loading,
}: {
  onExcel?: () => void; onFull?: () => void; on1C?: () => void; onPrint?: () => void
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <Download className="w-4 h-4 text-gray-500" />
        Eksport
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
          {onExcel && (
            <button onClick={() => { onExcel(); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
              <FileSpreadsheet className="w-4 h-4 text-green-600" /> Excel (joriy tab)
            </button>
          )}
          {onFull && (
            <button onClick={() => { onFull(); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
              <FileSpreadsheet className="w-4 h-4 text-blue-600" /> To'liq hisobot (Excel)
            </button>
          )}
          {on1C && (
            <button onClick={() => { on1C(); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
              <Download className="w-4 h-4 text-orange-500" /> 1C eksport (CSV)
            </button>
          )}
          {onPrint && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
              <button onClick={() => { onPrint(); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                <Printer className="w-4 h-4 text-gray-500" /> Chop etish (PDF)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sana presetlari ───────────────────────────────────────────────────────────
function DatePresets({ onSelect }: { onSelect: (from: string, to: string) => void }) {
  const presets = [
    { key: 'this-month', label: 'Bu oy' },
    { key: 'last-month', label: "O'tgan oy" },
    { key: 'this-quarter', label: 'Bu chorak' },
    { key: 'this-year', label: 'Bu yil' },
    { key: 'last-year', label: "O'tgan yil" },
  ]
  return (
    <div className="flex flex-wrap gap-1">
      {presets.map(p => (
        <button
          key={p.key}
          onClick={() => { const r = getPresetRange(p.key); onSelect(r.from, r.to) }}
          className="px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ── Filial filtri ─────────────────────────────────────────────────────────────
function BranchFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data as Array<{ id: string; name: string }>),
    staleTime: 5 * 60 * 1000,
  })
  if (!branches || branches.length <= 1) return null
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <option value="">Barcha filiallar</option>
      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  )
}

// ── KPI karta ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = 'blue', delta }: {
  label: string; value: string | number; sub?: string; color?: string; delta?: number | null
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    gray: 'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color] || colors.blue}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
      {(sub || delta !== undefined) && (
        <div className="flex items-center gap-2 mt-1">
          {sub && <p className="text-xs opacity-70">{sub}</p>}
          {delta !== undefined && <DeltaBadge pct={delta ?? null} />}
        </div>
      )}
    </div>
  )
}

// ── Tooltip formatlash ────────────────────────────────────────────────────────
const CurrencyTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-gray-700">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {formatCurrency(Number(p.value))}</p>
      ))}
    </div>
  )
}

// ── Xulosa tab ────────────────────────────────────────────────────────────────
function SummaryTab({ branchId }: { branchId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-summary', branchId],
    queryFn: () => api.get('/reports/summary', { params: { branchId: branchId || undefined } }).then(r => r.data.data),
  })

  if (isLoading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!data) return null

  const { currentMonth: cur, prevMonth, delta, trend, top5Vehicles, totalVehicles } = data

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Joriy oy KPI */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Joriy oy</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Jami xarajat" value={formatCurrency(cur.total)} delta={delta.total} color="blue" />
          <KpiCard label="Yoqilg'i" value={formatCurrency(cur.fuel)} delta={delta.fuel} color="yellow" />
          <KpiCard label="Ta'mirlash" value={formatCurrency(cur.maintenance)} delta={delta.maintenance} color="green" />
          <KpiCard label="Boshqa xarajatlar" value={formatCurrency(cur.expenses)} delta={delta.expenses} color="purple" />
        </div>
      </div>

      {/* O'tgan oy solishtirish */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">O'tgan oy bilan solishtirish</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {[
            { label: 'Jami', cur: cur.total, prev: prevMonth.total },
            { label: "Yoqilg'i", cur: cur.fuel, prev: prevMonth.fuel },
            { label: "Ta'mirlash", cur: cur.maintenance, prev: prevMonth.maintenance },
            { label: 'Boshqa', cur: cur.expenses, prev: prevMonth.expenses },
          ].map(item => (
            <div key={item.label}>
              <p className="text-gray-500 dark:text-gray-400 text-xs">{item.label}</p>
              <p className="font-bold text-gray-900 dark:text-white">{formatCurrency(item.cur)}</p>
              <p className="text-xs text-gray-400">{formatCurrency(item.prev)} o'tgan oy</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 12 oylik trend */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="font-semibold text-gray-800 dark:text-white text-sm mb-3">12 oylik xarajat dinamikasi</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 0, right: 5, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                <Tooltip content={<CurrencyTooltip />} />
                <Bar dataKey="fuel" name="Yoqilg'i" stackId="a" fill="#F59E0B" />
                <Bar dataKey="maintenance" name="Ta'mirlash" stackId="a" fill="#10B981" />
                <Bar dataKey="expenses" name="Boshqa" stackId="a" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top 5 mashina */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="font-semibold text-gray-800 dark:text-white text-sm mb-3">Top 5 — eng ko'p xarajat (12 oy)</p>
          <div className="space-y-2">
            {top5Vehicles.map((v: any, i: number) => {
              const maxCost = top5Vehicles[0]?.totalCost || 1
              const pct = Math.round((v.totalCost / maxCost) * 100)
              return (
                <div key={v.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-4 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <Link to={`/vehicles/${v.id}`} className="text-sm font-medium text-blue-600 hover:underline truncate">
                        {v.registrationNumber}
                      </Link>
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-200 ml-2 shrink-0">{formatCurrency(v.totalCost)}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 mt-3">Jami {totalVehicles} ta mashina</p>
        </div>
      </div>
    </div>
  )
}

// ── Mashinalar tab ─────────────────────────────────────────────────────────────
function VehiclesTab({ data }: { data: any[] }) {
  const totalAll = data.reduce((s, r) => s + r.grandTotal, 0)
  const totalFuel = data.reduce((s, r) => s + r.totalFuelCost, 0)
  const totalMaint = data.reduce((s, r) => s + r.totalMaintenanceCost, 0)
  const avgCost = data.length > 0 ? totalAll / data.length : 0
  const topByFuel = [...data].sort((a, b) => b.totalFuelCost - a.totalFuelCost)[0]

  const vehicleColumns = [
    { key: 'registrationNumber', title: 'Mashina', render: (r: any) => (
      <Link to={`/vehicles/${r.id}`} className="font-mono font-medium text-blue-600 hover:underline flex items-center gap-1">
        {r.registrationNumber}<ExternalLink className="w-3 h-3 opacity-60" />
      </Link>
    )},
    { key: 'model', title: 'Model', render: (r: any) => `${r.brand} ${r.model}` },
    { key: 'branch', title: 'Filial' },
    { key: 'totalFuelCost', title: "Yoqilg'i", render: (r: any) => formatCurrency(r.totalFuelCost) },
    { key: 'totalMaintenanceCost', title: "Ta'mirlash", render: (r: any) => formatCurrency(r.totalMaintenanceCost) },
    { key: 'totalExpenses', title: 'Boshqa', render: (r: any) => formatCurrency(r.totalExpenses) },
    { key: 'grandTotal', title: 'Jami', render: (r: any) => (
      <span className={`font-bold ${r.grandTotal > avgCost * 1.5 ? 'text-red-600' : 'text-blue-600'}`}>
        {formatCurrency(r.grandTotal)}
      </span>
    )},
    { key: 'mileage', title: 'Masofa', render: (r: any) => `${Number(r.mileage).toLocaleString()} km` },
    { key: 'kmL', title: 'km/L', render: (r: any) => r.kmL ? <span className={`font-mono text-xs ${r.kmL < 5 ? 'text-red-600' : r.kmL > 12 ? 'text-green-600' : 'text-gray-600'}`}>{r.kmL}</span> : '—' },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Jami xarajat" value={formatCurrency(totalAll)} color="blue" />
        <KpiCard label="Yoqilg'i xarajati" value={formatCurrency(totalFuel)} color="yellow" />
        <KpiCard label="Ta'mirlash xarajati" value={formatCurrency(totalMaint)} color="green" />
        <KpiCard label="O'rtacha / mashina" value={formatCurrency(avgCost)} sub={`${data.length} ta mashina`} color="gray" />
      </div>

      {data.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Top 10 — xarajat bo'yicha</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                <YAxis type="category" dataKey="registrationNumber" tick={{ fontSize: 11 }} width={90} />
                <Tooltip content={<CurrencyTooltip />} />
                <Bar dataKey="totalFuelCost" name="Yoqilg'i" stackId="a" fill="#F59E0B" />
                <Bar dataKey="totalMaintenanceCost" name="Ta'mirlash" stackId="a" fill="#10B981" />
                <Bar dataKey="totalExpenses" name="Boshqa" stackId="a" fill="#3B82F6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <Table columns={vehicleColumns} data={data} numbered />
    </div>
  )
}

// ── Yoqilg'i tab ──────────────────────────────────────────────────────────────
function FuelTab({ data }: { data: any }) {
  const fuelTypeColors: Record<string, string> = { 'A-92': '#3B82F6', 'A-95': '#8B5CF6', 'Dizel': '#F59E0B', 'Gaz': '#10B981' }

  const pieData = Object.entries(data.byFuelType || {}).map(([name, val]: [string, any]) => ({
    name, value: val.cost, liters: val.liters,
  }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Jami xarajat" value={formatCurrency(data.totalCost)} color="blue" />
        <KpiCard label="Jami litr" value={`${Number(data.totalLiters).toFixed(0)} L`} color="yellow" />
        <KpiCard label="O'rtacha narx" value={`${formatCurrency(data.avgPricePerLiter)} / L`} sub={`${data.count} ta yondirishlar`} color="gray" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Oylik trend */}
        {data.monthTrend?.length > 1 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Oylik dinamika</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.monthTrend} margin={{ top: 5, right: 10, bottom: 15, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                  <YAxis yAxisId="cost" tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                  <YAxis yAxisId="liters" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `${v}L`} />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Line yAxisId="cost" type="monotone" dataKey="cost" name="Xarajat" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  <Line yAxisId="liters" type="monotone" dataKey="liters" name="Litr" stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Yoqilg'i turi */}
        {pieData.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Yoqilg'i turi bo'yicha</p>
            <div className="flex items-center gap-4">
              <div className="w-36 h-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={60}>
                      {pieData.map((_, i) => <Cell key={i} fill={fuelTypeColors[_.name] || COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 flex-1">
                {pieData.map((item, i) => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fuelTypeColors[item.name] || COLORS[i % COLORS.length] }} />
                      <span className="text-gray-600 dark:text-gray-300">{item.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-xs">{formatCurrency(item.value)}</p>
                      <p className="text-[10px] text-gray-400">{Number(item.liters).toFixed(0)} L</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top mashinalar */}
      {data.topVehicles?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Top 10 mashina — yoqilg'i sarfi</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">#</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Mashina</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Litr</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Xarajat</th>
              </tr></thead>
              <tbody>
                {data.topVehicles.map((v: any, i: number) => (
                  <tr key={v.registrationNumber} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-sm font-medium text-gray-800 dark:text-gray-200">{v.registrationNumber}</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-400">{v.liters} L</td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-600">{formatCurrency(v.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Ta'mirlash tab ────────────────────────────────────────────────────────────
function MaintenanceTab({ data }: { data: any }) {
  const pieData = Object.entries(data.byCategory || {}).map(([name, cost]) => ({ name, value: cost as number }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Jami xarajat" value={formatCurrency(data.totalCost)} color="blue" />
        <KpiCard label="Ishlar soni" value={data.count} color="green" />
        <KpiCard label="O'rtacha 1 ta ish" value={formatCurrency(data.avgPerRecord)} color="gray" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Oylik trend */}
        {data.monthTrend?.length > 1 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Oylik dinamika</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthTrend} margin={{ top: 0, right: 5, bottom: 15, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Bar dataKey="cost" name="Ta'mirlash" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Kategoriya pie */}
        {pieData.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Kategoriya bo'yicha</p>
            <div className="flex items-center gap-4">
              <div className="w-36 h-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={60}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 flex-1 text-sm">
                {pieData.map((item, i) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-600 dark:text-gray-300 truncate max-w-[100px]">{item.name}</span>
                    </div>
                    <span className="font-semibold text-xs">{formatCurrency(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top ehtiyot qismlar */}
      {data.topParts?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Eng ko'p ishlatilgan ehtiyot qismlar</p>
          <div className="space-y-2">
            {data.topParts.slice(0, 8).map((p: any, i: number) => {
              const maxCost = data.topParts[0]?.totalCost || 1
              const pct = Math.round((p.totalCost / maxCost) * 100)
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-4 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-sm mb-0.5">
                      <span className="text-gray-700 dark:text-gray-200 truncate">{p.name}</span>
                      <span className="font-semibold text-gray-800 dark:text-white ml-2 shrink-0">{formatCurrency(p.totalCost)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">{p.count} ta</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Ustalar bo'yicha */}
      {data.byWorker?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Usta bo'yicha</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Usta</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Ishlar</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Jami</th>
              </tr></thead>
              <tbody>
                {data.byWorker.map((w: any) => (
                  <tr key={w.name} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/50">
                    <td className="px-3 py-2.5 flex items-center gap-2">
                      <User className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="font-medium text-gray-800 dark:text-gray-200">{w.name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500">{w.count}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-green-600">{formatCurrency(w.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Xarajatlar tab ────────────────────────────────────────────────────────────
function ExpensesTab({ data }: { data: any }) {
  const pieData = Object.entries(data.byCategory || {}).map(([name, val]) => ({ name, value: val as number }))
  const total = pieData.reduce((s, d) => s + d.value, 0)
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Jami xarajat" value={formatCurrency(data.total || 0)} color="blue" />
        <KpiCard label="Yozuvlar soni" value={data.count || 0} color="gray" />
      </div>
      {pieData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-4">Kategoriya bo'yicha taqsimot</p>
          <div className="flex flex-wrap items-center gap-6">
            <div className="w-44 h-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={35}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 flex-1">
              {pieData.sort((a, b) => b.value - a.value).map((item, i) => (
                <div key={item.name} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-sm text-gray-600 dark:text-gray-300 truncate">{item.name}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{formatCurrency(item.value)}</p>
                    <p className="text-xs text-gray-400">{total > 0 ? Math.round(item.value / total * 100) : 0}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Inventar tab ──────────────────────────────────────────────────────────────
function InventoryTab({ data }: { data: any }) {
  const pieData = Object.entries(data.byCategory || {}).map(([name, val]: [string, any]) => ({
    name, value: val.value,
  }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Ombor qiymati" value={formatCurrency(data.totalValue)} color="blue" />
        <KpiCard label="Jami pozitsiya" value={data.totalItems} color="green" />
        <KpiCard label="Kam qolgan" value={data.lowStockCount} color={data.lowStockCount > 0 ? 'red' : 'gray'} />
      </div>

      {/* Kam qolgan tovarlar */}
      {data.lowStockItems?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <p className="font-semibold text-sm text-red-700 dark:text-red-400">Kam qolgan tovarlar ({data.lowStockItems.length})</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Ehtiyot qism</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Ombor</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Hozirgi</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Min</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Holat</th>
              </tr></thead>
              <tbody>
                {data.lowStockItems.map((item: any) => {
                  const ratio = item.quantityOnHand / Math.max(item.reorderLevel, 1)
                  const critical = item.quantityOnHand === 0
                  return (
                    <tr key={item.id} className={`border-b border-gray-50 dark:border-gray-700/50 ${critical ? 'bg-red-50/50 dark:bg-red-900/10' : 'bg-yellow-50/30 dark:bg-yellow-900/10'}`}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-gray-800 dark:text-gray-200">{item.name}</p>
                        <p className="text-xs text-gray-400">{item.category}</p>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{item.warehouse}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-bold ${critical ? 'text-red-600' : 'text-yellow-600'}`}>{item.quantityOnHand}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{item.reorderLevel}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${critical ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {critical ? 'Tugagan' : `${Math.round(ratio * 100)}%`}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kategoriya donut */}
      {pieData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Kategoriya bo'yicha qiymat</p>
          <div className="flex flex-wrap items-center gap-6">
            <div className="w-40 h-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={65}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 flex-1">
              {pieData.sort((a, b) => b.value - a.value).map((item, i) => (
                <div key={item.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{item.name}</span>
                  </div>
                  <span className="font-semibold text-xs">{formatCurrency(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Filiallar tab ─────────────────────────────────────────────────────────────
function BranchTab({ data }: { data: any[] }) {
  const maxTotal = Math.max(...data.map(b => b.totalExpenses + b.totalFuelCost), 1)

  const branchColumns = [
    { key: 'name', title: 'Filial', render: (r: any) => <span className="font-medium">{r.name}</span> },
    { key: 'location', title: 'Joylashuv' },
    { key: 'vehicles', title: 'Mashinalar', render: (r: any) => `${r.activeVehicles}/${r.totalVehicles}` },
    { key: 'totalFuelCost', title: "Yoqilg'i", render: (r: any) => formatCurrency(r.totalFuelCost) },
    { key: 'totalExpenses', title: 'Xarajat', render: (r: any) => formatCurrency(r.totalExpenses) },
    { key: 'perVehicle', title: 'Mashina boshiga', render: (r: any) => {
      const total = r.totalExpenses + r.totalFuelCost
      return r.totalVehicles > 0 ? formatCurrency(total / r.totalVehicles) : '—'
    }},
    { key: 'inventoryValue', title: 'Ombor', render: (r: any) => formatCurrency(r.inventoryValue) },
  ]

  return (
    <div className="space-y-5">
      {/* Solishtirma progress barlar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <p className="font-semibold text-sm text-gray-700 dark:text-gray-200">Filiallar solishtirmasi</p>
        {data.map(b => {
          const total = b.totalExpenses + b.totalFuelCost
          const pct = Math.round((total / maxTotal) * 100)
          const fuelPct = total > 0 ? Math.round((b.totalFuelCost / total) * 100) : 0
          return (
            <div key={b.id} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-200">{b.name}</span>
                <span className="text-gray-500">{formatCurrency(total)}</span>
              </div>
              <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex">
                <div className="h-full bg-yellow-400" style={{ width: `${pct * fuelPct / 100}%` }} />
                <div className="h-full bg-blue-500" style={{ width: `${pct * (100 - fuelPct) / 100}%` }} />
              </div>
              <p className="text-[10px] text-gray-400">{b.activeVehicles}/{b.totalVehicles} mashina</p>
            </div>
          )
        })}
        <div className="flex items-center gap-4 text-xs text-gray-400 pt-1">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> Yoqilg'i</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Xarajat</span>
        </div>
      </div>

      <Table columns={branchColumns} data={data} numbered />
    </div>
  )
}

// ── Asosiy komponent ──────────────────────────────────────────────────────────
export default function Reports() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { isAdmin, isManager } = useAuthStore()

  const tabs: { key: ReportType; label: string; icon: React.ReactNode }[] = [
    { key: 'summary', label: 'Xulosa', icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'vehicles', label: t('reports.tabVehicles'), icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'expenses', label: t('reports.tabExpenses'), icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'fuel', label: t('reports.tabFuel'), icon: <Fuel className="w-4 h-4" /> },
    { key: 'maintenance', label: t('reports.tabMaintenance'), icon: <Wrench className="w-4 h-4" /> },
    { key: 'inventory', label: t('reports.tabInventory'), icon: <Package className="w-4 h-4" /> },
    { key: 'branch', label: t('reports.tabBranch'), icon: <Building2 className="w-4 h-4" /> },
  ]

  const [mainTab, setMainTab] = useState<MainTab>('live')
  const [activeTab, setActiveTab] = useState<ReportType>('summary')
  // Default: joriy oy — rahbar "shu oyda qaysi mashinaga nechi xarajat" deb
  // so'raganda Reports ochilishi bilanoq joriy oy ko'rsatkichlari ko'rinadi.
  const _initRange = getPresetRange('this-month')
  const [from, setFrom] = useState(_initRange.from)
  const [to, setTo] = useState(_initRange.to)
  const [branchId, setBranchId] = useState('')
  const [saveModal, setSaveModal] = useState(false)
  const [reportName, setReportName] = useState('')
  const [exporting, setExporting] = useState(false)

  // Vehicle detail
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [vdFrom, setVdFrom] = useState('')
  const [vdTo, setVdTo] = useState('')
  const [exportingVehicle, setExportingVehicle] = useState(false)

  const reportParams = { from: from || undefined, to: to || undefined, branchId: branchId || undefined }

  const { data, isLoading } = useQuery({
    queryKey: ['report', activeTab, from, to, branchId],
    queryFn: () => api.get(`/reports/${activeTab}`, { params: reportParams }).then(r => r.data.data),
    enabled: mainTab === 'live' && activeTab !== 'summary',
    placeholderData: keepPreviousData,
  })

  const { data: savedReports, isLoading: savedLoading } = useQuery({
    queryKey: ['saved-reports'],
    queryFn: () => api.get('/saved-reports').then(r => r.data.data),
    enabled: mainTab === 'saved',
  })

  const { data: allVehicles } = useQuery({
    queryKey: ['vehicles-list'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true' } }).then(r => r.data.data),
    enabled: mainTab === 'vehicle-detail',
  })

  const { data: vehicleDetail, isLoading: vdLoading } = useQuery({
    queryKey: ['vehicle-detail-report', selectedVehicleId, vdFrom, vdTo],
    queryFn: () => api.get(`/reports/vehicle/${selectedVehicleId}`, {
      params: { from: vdFrom || undefined, to: vdTo || undefined }
    }).then(r => r.data.data),
    enabled: mainTab === 'vehicle-detail' && !!selectedVehicleId,
  })

  const saveReportMutation = useMutation({
    mutationFn: (name: string) => api.post('/saved-reports', { name, type: activeTab, filters: { from: from || null, to: to || null }, data }),
    onSuccess: () => { toast.success(t('reports.toast.saved')); qc.invalidateQueries({ queryKey: ['saved-reports'] }); setSaveModal(false); setReportName('') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteReportMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/saved-reports/${id}`),
    onSuccess: () => { toast.success(t('reports.toast.deleted')); qc.invalidateQueries({ queryKey: ['saved-reports'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const EXPORT_ENDPOINT: Record<string, string> = {
    vehicles: 'vehicles', expenses: 'expenses', fuel: 'fuel-records',
    maintenance: 'maintenance', inventory: 'inventory', branch: 'branches',
  }

  const doExport = async (url: string, filename: string) => {
    setExporting(true)
    try {
      const res = await api.get(url, { responseType: 'blob' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(res.data)
      link.download = filename
      link.click()
      URL.revokeObjectURL(link.href)
    } catch { toast.error(t('reports.toast.exportError')) }
    finally { setExporting(false) }
  }

  const handleExcelTab = () => {
    const ep = EXPORT_ENDPOINT[activeTab]
    if (!ep) return
    const p = new URLSearchParams()
    if (from) p.set('from', from); if (to) p.set('to', to)
    doExport(`/exports/${ep}?${p}`, `${activeTab}-hisobot-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const handleFullExcel = () => {
    const p = new URLSearchParams()
    if (from) p.set('from', from); if (to) p.set('to', to)
    doExport(`/exports/full-report?${p}`, `full-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const handle1C = () => {
    const p = new URLSearchParams()
    if (from) p.set('from', from); if (to) p.set('to', to)
    doExport(`/exports/1c-report?${p}`, `1C-export-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const handleVehicleExport = async () => {
    if (!selectedVehicleId) return
    setExportingVehicle(true)
    try {
      const p = new URLSearchParams()
      if (vdFrom) p.set('from', vdFrom); if (vdTo) p.set('to', vdTo)
      const res = await api.get(`/exports/vehicle-report/${selectedVehicleId}?${p}`, { responseType: 'blob' })
      const veh = vehicleDetail?.vehicle
      const link = document.createElement('a')
      link.href = URL.createObjectURL(res.data)
      link.download = veh ? `${veh.registrationNumber}-hisobot-${new Date().toISOString().slice(0, 10)}.xlsx` : 'vehicle-report.xlsx'
      link.click()
      URL.revokeObjectURL(link.href)
    } catch { toast.error(t('reports.toast.exportError')) }
    finally { setExportingVehicle(false) }
  }

  const renderContent = () => {
    if (activeTab === 'summary') return <SummaryTab branchId={branchId} />
    if (isLoading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
    if (!data) return null

    if (activeTab === 'vehicles') return <VehiclesTab data={Array.isArray(data) ? data : []} />
    if (activeTab === 'fuel') return <FuelTab data={data} />
    if (activeTab === 'maintenance') return <MaintenanceTab data={data} />
    if (activeTab === 'expenses') return <ExpensesTab data={data} />
    if (activeTab === 'inventory') return <InventoryTab data={data} />
    if (activeTab === 'branch') return <BranchTab data={Array.isArray(data) ? data : []} />
    return null
  }

  const renderVehicleDetail = () => {
    if (!selectedVehicleId) return (
      <div className="text-center py-16 text-gray-400">
        <Car className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="font-medium text-gray-500">{t('reports.vehicleDetailEmpty')}</p>
        <p className="text-sm mt-1">{t('reports.vehicleDetailEmptyHint')}</p>
      </div>
    )
    if (vdLoading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
    if (!vehicleDetail) return null

    const { vehicle, summary, byWorker, byPart, maintenance, fuelRecords, expenses } = vehicleDetail

    const maintenanceCols = [
      { key: 'installationDate', title: t('reports.colDate'), render: (r: any) => new Date(r.installationDate).toLocaleDateString('uz-UZ') },
      { key: 'sparePart', title: t('reports.colSparePart'), render: (r: any) => r.sparePart?.name },
      { key: 'articleCode', title: t('reports.colArticle'), render: (r: any) => <span className="font-mono text-xs text-gray-500">{r.sparePart?.articleCode?.code || '—'}</span> },
      { key: 'quantityUsed', title: t('reports.colQty') },
      { key: 'performedBy', title: t('reports.colWorker'), render: (r: any) => r.performedBy?.fullName },
      { key: 'cost', title: t('reports.colPrice'), render: (r: any) => <span className="font-semibold">{formatCurrency(Number(r.cost))}</span> },
    ]
    const fuelCols = [
      { key: 'refuelDate', title: t('reports.colDate'), render: (r: any) => new Date(r.refuelDate).toLocaleDateString('uz-UZ') },
      { key: 'fuelType', title: t('reports.colFuelType') },
      { key: 'amountLiters', title: t('reports.colLiters'), render: (r: any) => `${Number(r.amountLiters).toFixed(1)} L` },
      { key: 'pricePerLiter', title: t('reports.colPricePerLiter'), render: (r: any) => formatCurrency(Number(r.pricePerLiter)) },
      { key: 'cost', title: t('reports.colTotal'), render: (r: any) => <span className="font-semibold">{formatCurrency(Number(r.cost))}</span> },
    ]
    const expensesCols = [
      { key: 'expenseDate', title: t('reports.colDate'), render: (r: any) => new Date(r.expenseDate).toLocaleDateString('uz-UZ') },
      { key: 'category', title: t('reports.colCategory'), render: (r: any) => r.category?.name },
      { key: 'description', title: t('reports.colComment') },
      { key: 'amount', title: t('reports.colAmount'), render: (r: any) => <span className="font-semibold">{formatCurrency(Number(r.amount))}</span> },
    ]

    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-5 text-white">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold">{vehicle.brand} {vehicle.model}</h2>
              <p className="font-mono text-lg mt-0.5">{vehicle.registrationNumber}</p>
              <p className="text-blue-200 text-sm mt-1">{vehicle.branch?.name} • {vehicle.year} yil • {Number(vehicle.mileage).toLocaleString()} km</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${vehicle.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`}>
              {vehicle.status === 'active' ? t('reports.vehicleStatusActive') : vehicle.status}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Ta'mirlash" value={formatCurrency(summary.totalMaintenance)} sub={`${summary.maintenanceCount} ta`} color="blue" />
          <KpiCard label="Yoqilg'i" value={formatCurrency(summary.totalFuel)} sub={`${summary.fuelCount} ta`} color="green" />
          <KpiCard label="Boshqa xarajat" value={formatCurrency(summary.totalExpenses)} color="yellow" />
          <KpiCard label="Jami" value={formatCurrency(summary.grandTotal)} color="gray" />
        </div>
        {byWorker?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <User className="w-4 h-4 text-blue-500" /> {t('reports.sectionWorkers')}
            </h3>
            <Table columns={[
              { key: 'name', title: t('reports.colWorkerName'), render: (r: any) => <span className="font-medium flex items-center gap-2"><User className="w-4 h-4 text-blue-400" />{r.name}</span> },
              { key: 'count', title: t('reports.colJobCount') },
              { key: 'totalCost', title: t('reports.colTotalPay'), render: (r: any) => <span className="font-bold text-green-600">{formatCurrency(r.totalCost)}</span> },
            ]} data={byWorker} numbered />
          </div>
        )}
        {byPart?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <Package className="w-4 h-4 text-purple-500" /> {t('reports.sectionParts')}
            </h3>
            <Table columns={[
              { key: 'name', title: t('reports.colSparePart') },
              { key: 'category', title: t('reports.colCategory') },
              { key: 'count', title: t('reports.colCount') },
              { key: 'totalCost', title: t('reports.colTotal'), render: (r: any) => <span className="font-bold">{formatCurrency(r.totalCost)}</span> },
            ]} data={byPart} numbered />
          </div>
        )}
        {maintenance?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-yellow-500" /> {t('reports.sectionMaintenance')}
            </h3>
            <Table columns={maintenanceCols} data={maintenance} numbered />
          </div>
        )}
        {fuelRecords?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <Fuel className="w-4 h-4 text-green-500" /> {t('reports.sectionFuel')}
            </h3>
            <Table columns={fuelCols} data={fuelRecords} numbered />
          </div>
        )}
        {expenses?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-orange-500" /> {t('reports.sectionExpenses')}
            </h3>
            <Table columns={expensesCols} data={expenses} numbered />
          </div>
        )}
      </div>
    )
  }

  const savedColumns = [
    { key: 'name', title: t('reports.colName'), render: (r: any) => <span className="font-medium">{r.name}</span> },
    { key: 'type', title: t('reports.colType'), render: (r: any) => <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{r.type}</span> },
    { key: 'createdAt', title: t('reports.colSaved'), render: (r: any) => new Date(r.createdAt).toLocaleDateString('uz-UZ') },
    { key: 'actions', title: '', render: (r: any) => (
      <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />} onClick={() => deleteReportMutation.mutate(r.id)} />
    )},
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('reports.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('reports.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {mainTab === 'vehicle-detail' && selectedVehicleId && (
            <Button variant="outline" icon={<FileSpreadsheet className="w-4 h-4 text-green-600" />}
              loading={exportingVehicle} onClick={handleVehicleExport}>
              {t('reports.vehicleExcelBtn')}
            </Button>
          )}
          {mainTab === 'live' && (isAdmin() || isManager()) && (
            <ExportMenu
              loading={exporting}
              onExcel={activeTab !== 'summary' ? handleExcelTab : undefined}
              onFull={handleFullExcel}
              on1C={handle1C}
              onPrint={activeTab === 'summary' ? () => window.print() : undefined}
            />
          )}
          {mainTab === 'live' && data && activeTab !== 'summary' && (
            <Button size="sm" variant="outline" icon={<Save className="w-3.5 h-3.5" />} onClick={() => setSaveModal(true)}>
              {t('reports.saveBtn')}
            </Button>
          )}
        </div>
      </div>

      {/* Main tabs */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'live' as MainTab, label: t('reports.mainTabLive'), icon: <BarChart3 className="w-4 h-4" /> },
          { key: 'saved' as MainTab, label: t('reports.mainTabSaved'), icon: <BookOpen className="w-4 h-4" /> },
          { key: 'vehicle-detail' as MainTab, label: t('reports.mainTabVehicleDetail'), icon: <Car className="w-4 h-4" /> },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setMainTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mainTab === tab.key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Saved reports */}
      {mainTab === 'saved' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-800 dark:text-white">{t('reports.savedTitle')}</h3>
          </div>
          {savedLoading ? (
            <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : !savedReports?.length ? (
            <div className="text-center py-12 text-gray-400">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="font-medium">{t('reports.noSaved')}</p>
              <p className="text-sm mt-1">{t('reports.noSavedHint')}</p>
            </div>
          ) : (
            <Table columns={savedColumns} data={savedReports} numbered />
          )}
        </div>
      )}

      {/* Vehicle detail */}
      {mainTab === 'vehicle-detail' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px] max-w-xs">
                <SearchableSelect
                  options={[{ value: '', label: t('reports.selectVehiclePlaceholder') }, ...(allVehicles || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` }))]}
                  value={selectedVehicleId} onChange={v => setSelectedVehicleId(v)}
                  placeholder={t('reports.vehicleSearchPlaceholder')}
                />
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <input type="date" value={vdFrom} onChange={e => setVdFrom(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-gray-400">—</span>
                <input type="date" value={vdTo} onChange={e => setVdTo(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </CardHeader>
          <CardBody>{renderVehicleDetail()}</CardBody>
        </Card>
      )}

      {/* Live report */}
      {mainTab === 'live' && (
        <>
          {/* Report type tabs */}
          <div className="flex gap-2 flex-wrap">
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          <Card>
            <CardHeader>
              <div className="space-y-2">
                {/* Sana presetlari */}
                <div className="flex flex-wrap items-center gap-2">
                  <DatePresets onSelect={(f, t) => { setFrom(f); setTo(t) }} />
                  {activeTab !== 'summary' && (
                    <div className="flex items-center gap-2 ml-auto">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <span className="text-gray-400">—</span>
                      <input type="date" value={to} onChange={e => setTo(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}
                </div>
                {/* Filial filtri */}
                {activeTab !== 'summary' && <BranchFilter value={branchId} onChange={setBranchId} />}
              </div>
            </CardHeader>
            <CardBody>{renderContent()}</CardBody>
          </Card>
        </>
      )}

      {/* Save Modal */}
      <Modal open={saveModal} onClose={() => setSaveModal(false)} title={t('reports.saveModalTitle')} size="sm"
        footer={<>
          <Button variant="outline" onClick={() => setSaveModal(false)}>{t('reports.cancelBtn')}</Button>
          <Button loading={saveReportMutation.isPending} onClick={() => reportName.trim() && saveReportMutation.mutate(reportName.trim())}>{t('reports.saveBtn')}</Button>
        </>}
      >
        <Input label={t('reports.saveModalNameLabel')} placeholder={t('reports.saveModalPlaceholder')}
          value={reportName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReportName(e.target.value)} />
      </Modal>

      {/* Print CSS */}
      <style>{`@media print { nav, aside, header, button, .no-print { display: none !important; } }`}</style>
    </div>
  )
}
