// Tahlil — admin uchun robot yordamchi. qoidalar avtopark ma'lumotlarini doimiy
// solishtiradi va har bir topilmani aniq savol + bitta tugma ko'rinishida beradi.
// Ma'lumot kiritilsa savol o'zi yo'qoladi; "Normal holat" sababi bilan yashiradi.
import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bot, RefreshCw, Search, EyeOff, CheckCircle2, ChevronDown, ChevronRight, Sparkles, TrendingDown, TrendingUp,
  Settings2, Target, FileSearch, Send, Inbox,
} from 'lucide-react'
import api from '../lib/api'
import { cn, formatDateTime } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import {
  FindingRow, DismissModal, DismissedModal, SettingsModal, TrendBars, CATEGORIES, SEVERITY, formatUzs,
  type Finding, type RuleMeta, type Category, type Severity,
} from '../components/insights/parts'
import AskBox from '../components/insights/AskBox'
import { SendModal, RequestsTab } from '../components/insights/RequestParts'

interface VehicleScore { vehicleId: string; plate: string; critical: number; warning: number; info: number; score: number }

interface InsightsData {
  generatedAt: string
  ruleCount: number
  summary: { total: number; critical: number; warning: number; info: number; impactUzs: number; byCategory: Record<Category, number> }
  hiddenCount: number
  assignedCount: number
  requestedCount: number
  answeredCount: number
  trend: { previousTotal: number | null; newCount: number; resolvedCount: number; series: Array<{ date: string; total: number; critical: number }> } | null
  findings: Finding[]
  top: string[]
  vehicles: VehicleScore[]
  branches: Array<{ id: string; name: string }>
  rules: RuleMeta[]
  examples: Array<{ group: string; q: string }>
}

const normalize = (s: string) => s.toLowerCase().replace(/[\s\-'"`ʻʼ‘’]/g, '')
const GROUP_PREVIEW = 5

export default function Insights() {
  const [searchParams] = useSearchParams()
  const [branchId, setBranchId] = useState('')
  const [tab, setTab] = useState<'today' | 'questions' | 'vehicles' | 'requests'>(searchParams.get('tab') === 'requests' ? 'requests' : 'today')
  const [category, setCategory] = useState<Category | ''>('')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [onlyNew, setOnlyNew] = useState(false)
  const [onlyAssigned, setOnlyAssigned] = useState(false)
  const [query, setQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<Finding | null>(null)
  const [sending, setSending] = useState<Finding[] | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Faqat "Qayta tekshirish" yoki javob saqlangandagina server keshini chetlab o'tamiz
  const forceRef = useRef(false)

  const { data, isLoading, isFetching, isError, refetch } = useQuery<InsightsData>({
    queryKey: ['insights', branchId],
    queryFn: () => {
      const refresh = forceRef.current ? '1' : undefined
      forceRef.current = false
      return api.get('/insights', { params: { branchId: branchId || undefined, refresh } }).then(r => r.data.data)
    },
    staleTime: 60_000,
  })
  const forceRefresh = () => { forceRef.current = true; refetch() }

  const ruleByKey = useMemo(() => new Map((data?.rules || []).map(r => [r.key, r])), [data])

  const q = normalize(query.trim())
  const filtered = useMemo(() => {
    if (!data) return []
    return data.findings.filter(f =>
      (!category || f.category === category)
      && (!severity || f.severity === severity)
      && (!onlyNew || f.isNew)
      && (!onlyAssigned || f.assignment)
      && (!q || normalize(`${f.plate || ''} ${f.title} ${f.detail}`).includes(q)))
  }, [data, category, severity, onlyNew, onlyAssigned, q])

  const topFindings = useMemo(() => {
    if (!data) return []
    const byFp = new Map(data.findings.map(f => [f.fingerprint, f]))
    return data.top.map(fp => byFp.get(fp)).filter((f): f is Finding => !!f)
  }, [data])

  // Qoida bo'yicha guruhlash — server tartibi (kritik, pul ta'siri) saqlanadi
  const groups = useMemo(() => {
    const m = new Map<string, Finding[]>()
    for (const f of filtered) m.set(f.ruleKey, [...(m.get(f.ruleKey) || []), f])
    return [...m.entries()]
  }, [filtered])

  const vehicleRows = useMemo(() => {
    if (!data) return []
    const counts = new Map<string, { critical: number; warning: number; info: number; score: number }>()
    for (const f of filtered) {
      if (!f.vehicleId) continue
      const c = counts.get(f.vehicleId) || { critical: 0, warning: 0, info: 0, score: 0 }
      c[f.severity]++
      c.score += f.severity === 'critical' ? 10 : f.severity === 'warning' ? 3 : 1
      counts.set(f.vehicleId, c)
    }
    return data.vehicles
      .filter(v => counts.has(v.vehicleId))
      .map(v => ({ ...v, ...counts.get(v.vehicleId)! }))
      .sort((a, b) => b.score - a.score)
  }, [data, filtered])

  // Qidiruv bitta mashinaga to'g'ri kelsa — dosyesini avtomatik ochamiz
  const singleVehicle = q && vehicleRows.length === 1 ? vehicleRows[0].vehicleId : null
  const openVehicle = expandedVehicle ?? singleVehicle

  const toggleGroup = (k: string) => setExpandedGroups(prev => {
    const n = new Set(prev)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const rowProps = { onDismiss: setDismissing, onSend: (f: Finding) => setSending([f]), onChanged: forceRefresh }
  const s = data?.summary
  const trend = data?.trend
  const filtersActive = !!(category || severity || onlyNew || onlyAssigned || q)

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Sarlavha */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Tahlil — robot yordamchi</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Avtopark {data?.ruleCount ?? 122} ta qoida bo'yicha doimiy tekshiriladi. Javob bersangiz yoki ma'lumot kiritsangiz, savol o'zi yo'qoladi.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(data?.branches.length || 0) > 1 && (
            <select value={branchId} onChange={e => setBranchId(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
              <option value="">Barcha filiallar</option>
              {data!.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {!!data?.hiddenCount && (
            <Button variant="outline" size="sm" icon={<EyeOff className="w-4 h-4" />} onClick={() => setShowHidden(true)}>
              Yashirilgan ({data.hiddenCount})
            </Button>
          )}
          <ExcelExportButton endpoint="/insights/export" filename="tahlil.xlsx" params={{ branchId: branchId || undefined }} size="sm" />
          <Button variant="outline" size="sm" icon={<Settings2 className="w-4 h-4" />} onClick={() => setShowSettings(true)} title="Chegaralar" />
          <Button variant="outline" size="sm" loading={isFetching} icon={<RefreshCw className="w-4 h-4" />} onClick={forceRefresh}>
            Qayta tekshirish
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="glass-card rounded-xl p-10 text-center text-gray-500">
          <div className="h-8 w-8 mx-auto mb-3 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Avtopark tekshirilmoqda...
        </div>
      )}

      {isError && (
        <div className="glass-card rounded-xl p-6 text-center">
          <p className="text-red-600 mb-3">Tahlilni yuklab bo'lmadi.</p>
          <Button variant="outline" onClick={() => refetch()}>Qayta urinish</Button>
        </div>
      )}

      {data && s && (
        <>
          <AskBox examples={data.examples} branchId={branchId} />

          {/* Xulosa kartochkalari */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(['critical', 'warning', 'info'] as Severity[]).map(sv => (
              <button key={sv} onClick={() => { setSeverity(severity === sv ? '' : sv); setTab('questions') }}
                className={cn('glass-card rounded-xl p-4 text-left transition-shadow hover:shadow-md border-l-4', SEVERITY[sv].bar,
                  severity === sv && 'ring-2 ring-blue-500')}>
                <div className="text-sm text-gray-500 dark:text-gray-400">{SEVERITY[sv].label}</div>
                <div className={cn('text-2xl font-bold mt-1', SEVERITY[sv].text)}>{s[sv]}</div>
              </button>
            ))}
            <div className="glass-card rounded-xl p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">Kechagidan beri</div>
              {trend && trend.previousTotal != null ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-semibold">
                      <TrendingDown className="w-4 h-4" /> {trend.resolvedCount} hal qilindi
                    </span>
                    <button onClick={() => { setOnlyNew(!onlyNew); setTab('questions') }}
                      className={cn('inline-flex items-center gap-1 font-semibold text-violet-600 dark:text-violet-400 rounded px-1', onlyNew && 'bg-violet-100 dark:bg-violet-900/40')}>
                      <TrendingUp className="w-4 h-4" /> {trend.newCount} yangi
                    </button>
                  </div>
                  <div className="mt-2"><TrendBars series={trend.series} /></div>
                </>
              ) : (
                <p className="mt-1 text-xs text-gray-500">{trend ? "Ertadan boshlab o'zgarishlar shu yerda ko'rinadi" : 'Filial tanlanganda trend ko\'rsatilmaydi'}</p>
              )}
            </div>
          </div>

          {s.impactUzs > 0 && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              Pulga baholanadigan savollar bo'yicha taxminiy ta'sir: <b>{formatUzs(s.impactUzs)}</b>.
            </div>
          )}

          {s.total === 0 ? (
            <div className="glass-card rounded-xl p-10 text-center">
              <CheckCircle2 className="w-12 h-12 mx-auto text-green-500 mb-3" />
              <p className="text-lg font-semibold text-gray-900 dark:text-white">Hozircha savol yo'q</p>
              <p className="text-sm text-gray-500 mt-1">Barcha tekshiruvlardan o'tdi. Tizim har kuni qayta tekshiradi.</p>
            </div>
          ) : (
            <>
              {/* Tablar */}
              <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
                <TabBtn active={tab === 'today'} onClick={() => setTab('today')}><Target className="w-4 h-4" /> Bugungi reja</TabBtn>
                <TabBtn active={tab === 'questions'} onClick={() => setTab('questions')}>Barcha savollar ({filtersActive ? `${filtered.length}/${s.total}` : s.total})</TabBtn>
                <TabBtn active={tab === 'vehicles'} onClick={() => setTab('vehicles')}>Mashinalar bo'yicha ({vehicleRows.length})</TabBtn>
                <TabBtn active={tab === 'requests'} onClick={() => setTab('requests')}>
                  <Inbox className="w-4 h-4" /> So'rovlar
                  {!!data.answeredCount && <span className="ml-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-violet-600 text-white">{data.answeredCount}</span>}
                </TabBtn>
              </div>

              {tab === 'requests' ? (
                <RequestsTab onChanged={forceRefresh} />
              ) : tab === 'today' ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Eng muhim {topFindings.length} ta savol — daraja, pul ta'siri va yangiligi bo'yicha tanlangan. Kimgadir topshirilganlari pastga tushadi.
                  </p>
                  <div className="glass-card rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-700/60">
                    {topFindings.map((f, i) => (
                      <div key={f.fingerprint} className="flex">
                        <div className={cn('w-10 flex-shrink-0 flex items-start justify-center pt-3.5 text-sm font-bold', SEVERITY[f.severity].text)}>{i + 1}</div>
                        <div className="flex-1 min-w-0 -ml-3"><FindingRow f={f} {...rowProps} /></div>
                      </div>
                    ))}
                  </div>
                  {!!data.requestedCount && (
                    <button onClick={() => setTab('requests')} className="inline-flex items-center gap-1.5 text-sm text-blue-700 dark:text-blue-400 hover:underline">
                      <Send className="w-4 h-4" /> {data.requestedCount} ta savol filiallarga yuborilgan{data.answeredCount ? `, ${data.answeredCount} tasiga javob keldi` : ''} — ko'rish
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Qidiruv va filtrlar */}
                  <div className="glass-card rounded-xl p-3 space-y-3">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={query} onChange={e => { setQuery(e.target.value); setExpandedVehicle(null) }}
                        placeholder="Ro'yxatdan qidirish — mashina raqami yoki so'z"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-9 pr-3 py-2 text-sm" />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip active={!category} onClick={() => setCategory('')}>Hammasi <b>{s.total}</b></Chip>
                      {(Object.keys(CATEGORIES) as Category[]).filter(c => s.byCategory[c] > 0).map(c => {
                        const Icon = CATEGORIES[c].icon
                        return (
                          <Chip key={c} active={category === c} onClick={() => setCategory(category === c ? '' : c)}>
                            <Icon className="w-3.5 h-3.5" /> {CATEGORIES[c].label} <b>{s.byCategory[c]}</b>
                          </Chip>
                        )
                      })}
                    </div>
                    {(severity || onlyNew || onlyAssigned) && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        {severity && <button onClick={() => setSeverity('')} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">Daraja: {SEVERITY[severity].label} ✕</button>}
                        {onlyNew && <button onClick={() => setOnlyNew(false)} className="px-2 py-1 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"><Sparkles className="w-3 h-3 inline" /> Faqat yangilar ✕</button>}
                        {onlyAssigned && <button onClick={() => setOnlyAssigned(false)} className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Faqat topshirilganlar ✕</button>}
                      </div>
                    )}
                    {filtered.some(f => !f.request) && (
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100 dark:border-gray-700">
                        <span className="text-xs text-gray-500">Har bir savol o'z mashinasining filialiga yuboriladi.</span>
                        <Button size="sm" variant="outline" icon={<Send className="w-3.5 h-3.5" />} onClick={() => setSending(filtered.filter(f => !f.request))}>
                          Ko'rinayotganlarni filialga yuborish ({filtered.filter(f => !f.request).length})
                        </Button>
                      </div>
                    )}
                  </div>

                  {filtered.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">Filtrga mos savol topilmadi.</p>
                  ) : tab === 'questions' ? (
                    <div className="space-y-3">
                      {groups.map(([key, items]) => {
                        const rule = ruleByKey.get(key)
                        const top = items[0].severity
                        const expanded = expandedGroups.has(key) || items.length <= GROUP_PREVIEW
                        const shown = expanded ? items : items.slice(0, GROUP_PREVIEW)
                        const Icon = CATEGORIES[items[0].category].icon
                        return (
                          <div key={key} className={cn('glass-card rounded-xl border-l-4 overflow-hidden', SEVERITY[top].bar)}>
                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
                              <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              <span className="text-xs text-gray-400 font-mono">#{rule?.no}</span>
                              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex-1 min-w-0 truncate">{rule?.name || key}</span>
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">{items.length}</span>
                            </div>
                            <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                              {shown.map(f => <FindingRow key={f.fingerprint} f={f} {...rowProps} />)}
                            </div>
                            {items.length > GROUP_PREVIEW && (
                              <button onClick={() => toggleGroup(key)} className="w-full text-center text-sm text-blue-600 dark:text-blue-400 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700">
                                {expanded ? 'Yig\'ish' : `Yana ${items.length - GROUP_PREVIEW} tasini ko'rsatish`}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="glass-card rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
                      {vehicleRows.map(v => {
                        const open = openVehicle === v.vehicleId
                        const items = open ? filtered.filter(f => f.vehicleId === v.vehicleId) : []
                        return (
                          <div key={v.vehicleId}>
                            <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                              <button onClick={() => setExpandedVehicle(open ? '' : v.vehicleId)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                                {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                                <span className="font-mono font-semibold text-gray-900 dark:text-white">{v.plate}</span>
                                <span className="flex-1" />
                                {v.critical > 0 && <Count n={v.critical} sv="critical" />}
                                {v.warning > 0 && <Count n={v.warning} sv="warning" />}
                                {v.info > 0 && <Count n={v.info} sv="info" />}
                              </button>
                              <Link to={`/insights/vehicle/${v.vehicleId}`} title="To'liq dosye" className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30">
                                <FileSearch className="w-4 h-4" />
                              </Link>
                            </div>
                            {open && (
                              <div className="bg-gray-50/50 dark:bg-gray-900/20 divide-y divide-gray-100 dark:divide-gray-700/60 border-t border-gray-100 dark:border-gray-700">
                                {items.map(f => <FindingRow key={f.fingerprint} f={f} showPlate={false} {...rowProps} />)}
                                <Link to={`/insights/vehicle/${v.vehicleId}`} className="block text-center text-sm text-blue-600 dark:text-blue-400 py-2 hover:underline">
                                  {v.plate} — to'liq dosye va tarix →
                                </Link>
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {vehicleRows.length === 0 && <p className="text-sm text-gray-500 text-center py-8">Mashinaga bog'liq savol yo'q.</p>}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <p className="text-xs text-gray-400 text-center">Oxirgi tekshiruv: {formatDateTime(data.generatedAt)}</p>
        </>
      )}

      <DismissModal finding={dismissing} ruleName={dismissing ? ruleByKey.get(dismissing.ruleKey)?.name || '' : ''} onClose={() => setDismissing(null)} />
      <SendModal findings={sending} branches={data?.branches || []} onClose={() => setSending(null)} onSent={forceRefresh} />
      <DismissedModal open={showHidden} onClose={() => setShowHidden(false)} rules={data?.rules || []} />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} onSaved={forceRefresh} />
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-colors',
        active ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700')}>
      {children}
    </button>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
        active ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
      {children}
    </button>
  )
}

function Count({ n, sv }: { n: number; sv: Severity }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full', SEVERITY[sv].soft, SEVERITY[sv].text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', SEVERITY[sv].dot)} /> {n}
    </span>
  )
}
