import { AlertCircle, AlertTriangle, CheckCircle2, Fuel, Wrench, Circle, DollarSign, Gauge } from 'lucide-react'
import { formatDate } from '../../lib/utils'
import { Card, money, monthLabel, shortMoney } from './vehicleUi'

export type AlertLevel = 'critical' | 'warning'
export interface VehicleAlert { level: AlertLevel; text: string; tab: 'service' | 'tires' | 'maintenance' }

const daysLeft = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)

/** Sahifa tepasidagi lenta va "Texnik holat" uchun yagona ogohlantirishlar ro'yxati */
export function buildAlerts(opts: {
  vehicle: any
  intervals: any[]
  currentMileage: number
  tiresCurrent: any[]
  label: (serviceType: string) => string
}): VehicleAlert[] {
  const { vehicle, intervals, currentMileage, tiresCurrent, label } = opts
  const out: VehicleAlert[] = []
  for (const i of intervals) {
    if (i.status === 'ok') continue
    const rest = i.nextDueKm ? Number(i.nextDueKm) - currentMileage : null
    const tail = rest == null ? '' : rest > 0 ? ` — ${Math.round(rest).toLocaleString('uz-UZ')} km qoldi` : ` — ${Math.abs(Math.round(rest)).toLocaleString('uz-UZ')} km o'tgan`
    out.push({ level: i.status === 'overdue' ? 'critical' : 'warning', text: `${label(i.serviceType)}${tail}`, tab: 'service' })
  }
  for (const [name, exp] of [['Sug\'urta', vehicle.insuranceExpiry], ["Texnik ko'rik", vehicle.techInspectionExpiry]] as const) {
    if (!exp) continue
    const d = daysLeft(exp)
    if (d < 0) out.push({ level: 'critical', text: `${name} muddati o'tgan (${formatDate(exp)})`, tab: 'service' })
    else if (d <= 30) out.push({ level: d <= 7 ? 'critical' : 'warning', text: `${name}: ${d} kun qoldi`, tab: 'service' })
  }
  const crit = tiresCurrent.filter(t => t.usageLevel === 'critical').length
  const warn = tiresCurrent.filter(t => t.usageLevel === 'warning').length
  if (crit) out.push({ level: 'critical', text: `${crit} ta shinani almashtirish kerak`, tab: 'tires' })
  if (warn) out.push({ level: 'warning', text: `${warn} ta shina me'yorga yaqinlashmoqda`, tab: 'tires' })
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))
}

const EVENT_ICON: Record<string, { icon: any; cls: string; label: string }> = {
  maintenance: { icon: Wrench, cls: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400', label: "Ta'mirlash" },
  fuel: { icon: Fuel, cls: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400', label: "Yoqilg'i" },
  expense: { icon: DollarSign, cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', label: 'Xarajat' },
}

function MonthlyChart({ monthly }: { monthly: any[] }) {
  const max = Math.max(...monthly.map(m => m.total), 1)
  return (
    <div>
      <div className="flex items-end gap-2 h-36">
        {monthly.map(m => {
          const h = (m.total / max) * 100
          const part = (v: number) => (m.total ? (v / m.total) * 100 : 0)
          return (
            <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${monthLabel(m.month)}: ${money(m.total)}`}>
              <span className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 tabular-nums">{m.total ? shortMoney(m.total) : ''}</span>
              <div className="w-full max-w-[44px] rounded-t-md overflow-hidden flex flex-col-reverse bg-gray-100 dark:bg-gray-700/50" style={{ height: `${Math.max(h, m.total ? 4 : 2)}%` }}>
                <div className="bg-blue-500" style={{ height: `${part(m.maintenance)}%` }} />
                <div className="bg-amber-400" style={{ height: `${part(m.fuel)}%` }} />
                <div className="bg-gray-400" style={{ height: `${part(m.expenses)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 mt-1.5">
        {monthly.map(m => <span key={m.month} className="flex-1 text-center text-[10px] text-gray-400 truncate">{monthLabel(m.month).slice(0, 3)}</span>)}
      </div>
      <div className="flex gap-4 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-blue-500" /> Ta'mirlash</span>
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-amber-400" /> Yoqilg'i</span>
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-gray-400" /> Boshqa</span>
      </div>
    </div>
  )
}

interface Props {
  summary: any
  byPart: any[]
  intervals: any[]
  currentMileage: number
  tiresCurrent: any[]
  alerts: VehicleAlert[]
  overview: any
  label: (serviceType: string) => string
  goTab: (t: 'service' | 'tires' | 'maintenance' | 'fuel') => void
}

export default function OverviewTab({ summary, byPart, intervals, currentMileage, tiresCurrent, alerts, overview, label, goTab }: Props) {
  const monthly: any[] = overview?.monthly || []
  const hasChart = monthly.some(m => m.total > 0)
  const cons = overview?.consumption
  const events: any[] = overview?.events || []

  const sortedIntervals = [...intervals].sort((a, b) => {
    const o: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2 }
    return (o[a.status] ?? 2) - (o[b.status] ?? 2)
  })

  return (
    <div className="p-5 space-y-5">
      {/* Xarajat kartalari */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button onClick={() => goTab('maintenance')} className="text-left rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"><Wrench className="w-3.5 h-3.5 text-blue-500" /> Ta'mirlash</p>
          <p className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{money(summary?.totalMaintenance || 0)}</p>
          <p className="text-xs text-gray-400">{summary?.maintenanceCount || 0} ta yozuv</p>
        </button>
        <button onClick={() => goTab('fuel')} className="text-left rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"><Fuel className="w-3.5 h-3.5 text-amber-500" /> Yoqilg'i</p>
          <p className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{money(summary?.totalFuel || 0)}</p>
          <p className="text-xs text-gray-400">{summary?.fuelCount || 0} ta to'ldirish</p>
        </button>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"><DollarSign className="w-3.5 h-3.5 text-gray-500" /> Boshqa xarajat</p>
          <p className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{money(summary?.totalExpenses || 0)}</p>
          <p className="text-xs text-gray-400">&nbsp;</p>
        </div>
        <div className="rounded-xl p-4 bg-gradient-to-br from-blue-600 to-blue-700 text-white">
          <p className="text-xs text-blue-200">Jami xarajat</p>
          <p className="text-base sm:text-lg font-bold mt-1 tabular-nums">{money(summary?.grandTotal || 0)}</p>
          <p className="text-xs text-blue-200">tanlangan davr</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Texnik holat */}
        <Card title="Texnik holat" right={<span className="text-xs text-gray-400">{currentMileage.toLocaleString('uz-UZ')} km</span>}>
          <div className="p-4 space-y-2">
            {alerts.length === 0 && intervals.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-4 h-4" /> Hammasi me'yorda</p>
            )}
            {alerts.map((a, i) => (
              <button key={i} onClick={() => goTab(a.tab)}
                className={`w-full text-left flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${a.level === 'critical'
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                {a.level === 'critical' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                <span>{a.text}</span>
              </button>
            ))}
            {intervals.length === 0 ? (
              <button onClick={() => goTab('service')} className="w-full text-left text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-2">
                <Gauge className="w-4 h-4" /> Moy va filtr intervallarini sozlang — shunda qachon almashtirish kerakligi ko'rinadi
              </button>
            ) : (
              <div className="pt-2 space-y-2">
                {sortedIntervals.filter(i => i.status === 'ok').slice(0, 4).map(i => {
                  const rest = i.nextDueKm ? Math.round(Number(i.nextDueKm) - currentMileage) : null
                  return (
                    <div key={i.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300"><CheckCircle2 className="w-4 h-4 text-emerald-500" />{label(i.serviceType)}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{rest != null ? `${rest.toLocaleString('uz-UZ')} km qoldi` : '—'}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {tiresCurrent.length > 0 && !alerts.some(a => a.tab === 'tires') && (
              <button onClick={() => goTab('tires')} className="w-full flex items-center justify-between text-sm pt-1">
                <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300"><Circle className="w-4 h-4 text-emerald-500" />Shinalar ({tiresCurrent.length} ta)</span>
                <span className="text-xs text-emerald-600 dark:text-emerald-400">Yaxshi</span>
              </button>
            )}
          </div>
        </Card>

        {/* Yoqilg'i sarfi — ma'lumot yetarli bo'lsagina */}
        {cons ? (
          <Card title="Yoqilg'i sarfi" right={<span className="text-xs text-gray-400">oxirgi {cons.fills} ta to'ldirish</span>}>
            <div className="p-4">
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{String(cons.l100).replace('.', ',')}</p>
                <p className="text-sm text-gray-500">L / 100 km</p>
                {cons.overPct != null && (
                  <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-md ${cons.level === 'critical'
                    ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : cons.level === 'warning'
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                    me'yordan {cons.overPct > 0 ? '+' : ''}{cons.overPct}%
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {cons.spanKm.toLocaleString('uz-UZ')} km yurishda {cons.liters.toLocaleString('uz-UZ')} litr sarflangan
                {cons.normPer100 ? ` · me'yor ${cons.normPer100} L` : " · me'yor belgilanmagan"}
              </p>
            </div>
          </Card>
        ) : (
          <Card title="Oxirgi voqealar">
            <Events events={events} goTab={goTab} />
          </Card>
        )}
      </div>

      {hasChart && (
        <Card title="Oxirgi 6 oy xarajati">
          <div className="p-4"><MonthlyChart monthly={monthly} /></div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {cons && (
          <Card title="Oxirgi voqealar">
            <Events events={events} goTab={goTab} />
          </Card>
        )}
        {byPart && byPart.length > 0 && (
          <Card title="Ko'p ishlatiladigan qismlar">
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {byPart.slice(0, 5).map((p: any) => (
                <div key={p.name} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{p.count} marta ishlatilgan</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums flex-shrink-0">{money(p.totalCost)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function Events({ events, goTab }: { events: any[]; goTab: Props['goTab'] }) {
  if (events.length === 0) return <p className="py-8 text-center text-sm text-gray-400">Hali voqea yo'q</p>
  return (
    <div className="divide-y divide-gray-50 dark:divide-gray-700">
      {events.map(e => {
        const cfg = EVENT_ICON[e.type]
        const Icon = cfg.icon
        return (
          <button key={`${e.type}-${e.id}`} onClick={() => goTab(e.type === 'fuel' ? 'fuel' : 'maintenance')} className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.cls}`}><Icon className="w-4 h-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-900 dark:text-white truncate">{e.title}</p>
              <p className="text-xs text-gray-400">{cfg.label} · {formatDate(e.date)}</p>
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums flex-shrink-0">{money(e.amount)}</span>
          </button>
        )
      })}
    </div>
  )
}
