import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Cpu, Droplets, Fuel, Satellite, FileText, CircleDot, Wrench, Package, ClipboardList, Wallet, Database,
  ArrowRight, EyeOff, RotateCcw, Sparkles, PenLine, Calculator, UserPlus, Clock, Layers,
} from 'lucide-react'
import api from '../../lib/api'
import { cn, formatDate } from '../../lib/utils'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import QuickForm from './QuickForm'

export type Severity = 'critical' | 'warning' | 'info'
export type Category = 'engine' | 'service' | 'fuel' | 'gps' | 'documents' | 'tires' | 'repairs' | 'warehouse' | 'waybills' | 'budget' | 'data'

export interface Evidence { note?: string; columns: string[]; rows: Array<Array<string | number>> }

export type QuickAction =
  | { kind: 'engine_record'; prefill: { date?: string; mileage?: number; cost?: number; description?: string; recordType?: string } }
  | { kind: 'oil_change'; serviceType: 'oil_change' | 'air_filter' | 'fuel_filter'; prefill: { date?: string; km?: number } }
  | { kind: 'vehicle_date'; field: 'insuranceExpiry' | 'techInspectionExpiry'; label: string }
  | { kind: 'vehicle_number'; field: 'fuelNormPer100km' | 'tankCapacity'; label: string; unit: string; prefill?: number }
  | { kind: 'vehicle_status'; suggest: 'active' | 'maintenance' | 'inactive' }

export interface AssignmentInfo { id: string; assigneeId: string; assigneeName: string | null; dueDate: string | null; overdue: boolean; note: string | null }

export interface Finding {
  ruleKey: string
  category: Category
  severity: Severity
  vehicleId: string | null
  subjectKey: string
  title: string
  detail: string
  action: { label: string; path: string }
  impactUzs?: number
  evidence?: Evidence
  quick?: QuickAction
  fingerprint: string
  plate: string | null
  branchId: string | null
  isNew?: boolean
  extra?: string[]
  mergedFrom?: string[]
  priority?: number
  assignment?: AssignmentInfo
}

export interface RuleMeta { no: number; key: string; category: Category; name: string }

export const CATEGORIES: Record<Category, { label: string; icon: React.ElementType }> = {
  engine: { label: 'Dvigatel', icon: Cpu },
  service: { label: 'Moy va xizmat', icon: Droplets },
  fuel: { label: "Yoqilg'i", icon: Fuel },
  gps: { label: 'GPS', icon: Satellite },
  documents: { label: 'Hujjatlar', icon: FileText },
  tires: { label: 'Shinalar', icon: CircleDot },
  repairs: { label: "Ta'mir", icon: Wrench },
  warehouse: { label: 'Ombor', icon: Package },
  waybills: { label: "Yo'l varaqasi", icon: ClipboardList },
  budget: { label: 'Byudjet', icon: Wallet },
  data: { label: "Ma'lumot", icon: Database },
}

export const SEVERITY: Record<Severity, { label: string; dot: string; bar: string; text: string; soft: string }> = {
  critical: { label: 'Kritik', dot: 'bg-red-500', bar: 'border-l-red-500', text: 'text-red-600 dark:text-red-400', soft: 'bg-red-50 dark:bg-red-900/20' },
  warning: { label: 'Diqqat', dot: 'bg-amber-500', bar: 'border-l-amber-500', text: 'text-amber-600 dark:text-amber-400', soft: 'bg-amber-50 dark:bg-amber-900/20' },
  info: { label: "Ma'lumot uchun", dot: 'bg-sky-500', bar: 'border-l-sky-500', text: 'text-sky-600 dark:text-sky-400', soft: 'bg-sky-50 dark:bg-sky-900/20' },
}

export function formatUzs(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mln so'm`
  return `${Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`
}

export function MiniTable({ columns, rows }: { columns: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            {columns.map(c => <th key={c} className="py-1 pr-3 font-medium whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
              {r.map((cell, j) => <td key={j} className="py-1 pr-3 text-gray-700 dark:text-gray-300 align-top">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Panel = 'quick' | 'evidence' | null

export function FindingRow({ f, showPlate = true, onDismiss, onAssign, onChanged }: {
  f: Finding; showPlate?: boolean
  onDismiss: (f: Finding) => void
  onAssign: (f: Finding) => void
  onChanged: () => void
}) {
  const sev = SEVERITY[f.severity]
  const [panel, setPanel] = useState<Panel>(null)
  const toggle = (p: Panel) => setPanel(cur => (cur === p ? null : p))
  const btn = 'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors'
  return (
    <div className="flex gap-3 py-3 px-4 hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition-colors">
      <span className={cn('mt-1.5 h-2.5 w-2.5 rounded-full flex-shrink-0', sev.dot)} title={sev.label} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {showPlate && f.plate && f.vehicleId && (
            <Link to={`/insights/vehicle/${f.vehicleId}`} title="Mashina dosyesi"
              className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-900/40">
              {f.plate}
            </Link>
          )}
          {f.isNew && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              <Sparkles className="w-3 h-3" /> Yangi
            </span>
          )}
          {!!f.impactUzs && (
            <span className={cn('text-[11px] font-medium px-1.5 py-0.5 rounded', sev.soft, sev.text)}>≈ {formatUzs(f.impactUzs)}</span>
          )}
          {f.extra && f.extra.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <Layers className="w-3 h-3" /> +{f.extra.length} belgi
            </span>
          )}
          {f.assignment && (
            <span className={cn('inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded',
              f.assignment.overdue ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300')}>
              <Clock className="w-3 h-3" /> {f.assignment.assigneeName || "Mas'ul"}
              {f.assignment.dueDate && ` · ${formatDate(f.assignment.dueDate)}`}{f.assignment.overdue && ' · muddati o\'tdi'}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100 break-words">{f.title}</p>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400 break-words">{f.detail}</p>
        {f.extra && f.extra.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {f.extra.map((x, i) => <li key={i} className="text-xs text-gray-500 dark:text-gray-400 pl-3 border-l-2 border-gray-200 dark:border-gray-700 break-words">{x}</li>)}
          </ul>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {f.quick && f.vehicleId && (
            <button onClick={() => toggle('quick')} className={cn(btn, 'bg-blue-600 text-white hover:bg-blue-700')}>
              <PenLine className="w-3 h-3" /> Javob berish
            </button>
          )}
          <Link to={f.action.path} className={cn(btn, f.quick ? 'border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30' : 'bg-blue-600 text-white hover:bg-blue-700')}>
            {f.action.label} <ArrowRight className="w-3 h-3" />
          </Link>
          {f.evidence && (
            <button onClick={() => toggle('evidence')} className={cn(btn, 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700', panel === 'evidence' && 'bg-gray-100 dark:bg-gray-700')}>
              <Calculator className="w-3 h-3" /> Qanday hisoblandi
            </button>
          )}
          <button onClick={() => onAssign(f)} className={cn(btn, 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700')}>
            <UserPlus className="w-3 h-3" /> {f.assignment ? 'Qayta topshirish' : 'Topshirish'}
          </button>
          <button onClick={() => onDismiss(f)} className={cn(btn, 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700')}>
            <EyeOff className="w-3 h-3" /> Normal holat
          </button>
        </div>

        {panel === 'quick' && f.quick && (
          <QuickForm finding={f} onCancel={() => setPanel(null)} onDone={() => { setPanel(null); onChanged() }} />
        )}
        {panel === 'evidence' && f.evidence && (
          <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-3">
            {f.evidence.note && <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{f.evidence.note}</p>}
            {f.evidence.rows.length > 0 && <MiniTable columns={f.evidence.columns} rows={f.evidence.rows} />}
          </div>
        )}
      </div>
    </div>
  )
}

export function DismissModal({ finding, ruleName, onClose }: { finding: Finding | null; ruleName: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [scope, setScope] = useState<'one' | 'rule'>('one')
  const [days, setDays] = useState(90)
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => api.post('/insights/dismiss', {
      ruleKey: finding!.ruleKey, fingerprint: finding!.fingerprint, vehicleId: finding!.vehicleId,
      title: finding!.title, scope, days, reason,
    }),
    onSuccess: () => {
      toast.success(scope === 'rule' ? 'Bu turdagi savollar yashirildi' : 'Savol yashirildi')
      qc.invalidateQueries({ queryKey: ['insights'] })
      qc.invalidateQueries({ queryKey: ['insights-dismissals'] })
      setReason(''); setScope('one'); setDays(90)
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.response?.data?.message || 'Xatolik'),
  })
  if (!finding) return null
  return (
    <Modal open={!!finding} onClose={onClose} title="Normal holat deb belgilash" size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={reason.trim().length < 3}>Yashirish</Button>
        </div>
      }>
      <div className="space-y-4">
        <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3">{finding.title}</p>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" className="mt-0.5" checked={scope === 'one'} onChange={() => setScope('one')} />
            <span className="text-gray-800 dark:text-gray-200">Faqat shu savol</span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" className="mt-0.5" checked={scope === 'rule'} onChange={() => setScope('rule')} />
            <span className="text-gray-800 dark:text-gray-200">
              Bu turdagi <b>barcha</b> savollar
              <span className="block text-xs text-gray-500">"{ruleName}" — biz uchun kerak emas</span>
            </span>
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Muddat</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
            <option value={30}>30 kun</option>
            <option value={90}>90 kun</option>
            <option value={0}>Doimiy</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sabab <span className="text-red-500">*</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
            placeholder="Masalan: mashina ijarada, yoqilg'ini ijarachi quyadi"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
          <p className="mt-1 text-xs text-gray-500">Muddat tugagach yoki qaytarilsa, savol yana chiqadi.</p>
        </div>
      </div>
    </Modal>
  )
}

interface Assignee { id: string; fullName: string; role: string; branch?: { name: string } | null }
const ROLE: Record<string, string> = { admin: 'Admin', manager: 'Menejer', branch_manager: 'Filial rahbari', operator: 'Operator' }

export function AssignModal({ finding, onClose, onChanged }: { finding: Finding | null; onClose: () => void; onChanged: () => void }) {
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const { data: users } = useQuery<Assignee[]>({
    queryKey: ['insights-assignees'],
    queryFn: () => api.get('/insights/assignees').then(r => r.data.data),
    enabled: !!finding,
    staleTime: 5 * 60_000,
  })
  const m = useMutation({
    mutationFn: () => api.post('/insights/assign', { fingerprint: finding!.fingerprint, assigneeId, dueDate: dueDate || undefined, note: note || undefined }),
    onSuccess: () => {
      toast.success("Topshirildi — mas'ulga bildirishnoma yuborildi")
      setAssigneeId(''); setDueDate(''); setNote('')
      onClose(); onChanged()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.response?.data?.message || 'Xatolik'),
  })
  const unassign = useMutation({
    mutationFn: () => api.delete(`/insights/assign/${finding!.assignment!.id}`),
    onSuccess: () => { toast.success('Topshiriq bekor qilindi'); onClose(); onChanged() },
  })
  if (!finding) return null
  return (
    <Modal open={!!finding} onClose={onClose} title="Mas'ulga topshirish" size="md"
      footer={
        <div className="flex justify-between gap-2">
          <div>{finding.assignment && <Button variant="ghost" loading={unassign.isPending} onClick={() => unassign.mutate()}>Topshiriqni bekor qilish</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Yopish</Button>
            <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!assigneeId}>Topshirish</Button>
          </div>
        </div>
      }>
      <div className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3">{finding.title}</p>
        {finding.assignment && (
          <p className="text-xs text-gray-500">Hozir: {finding.assignment.assigneeName}{finding.assignment.dueDate ? `, muddat ${formatDate(finding.assignment.dueDate)}` : ''}</p>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mas'ul <span className="text-red-500">*</span></label>
          <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
            <option value="">— tanlang —</option>
            {(users || []).map(u => <option key={u.id} value={u.id}>{u.fullName} ({ROLE[u.role] || u.role}{u.branch?.name ? `, ${u.branch.name}` : ''})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Muddat</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
        </div>
        <p className="text-xs text-gray-500">Mas'ul bildirishnoma oladi. Ma'lumot kiritilib savol yo'qolganda topshiriq o'zi yopiladi.</p>
      </div>
    </Modal>
  )
}

interface Dismissal {
  id: string; fingerprint: string; ruleKey: string; title: string | null; reason: string
  until: string | null; createdAt: string; createdByName: string | null
}

export function DismissedModal({ open, onClose, rules }: { open: boolean; onClose: () => void; rules: RuleMeta[] }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<Dismissal[]>({
    queryKey: ['insights-dismissals'],
    queryFn: () => api.get('/insights/dismissals').then(r => r.data.data),
    enabled: open,
  })
  const restore = useMutation({
    mutationFn: (id: string) => api.delete(`/insights/dismissals/${id}`),
    onSuccess: () => {
      toast.success('Qaytarildi')
      qc.invalidateQueries({ queryKey: ['insights'] })
      qc.invalidateQueries({ queryKey: ['insights-dismissals'] })
    },
    onError: () => toast.error('Xatolik'),
  })
  const ruleName = (k: string) => rules.find(r => r.key === k)?.name || k
  return (
    <Modal open={open} onClose={onClose} title="Yashirilgan savollar" size="lg">
      {isLoading ? (
        <p className="text-sm text-gray-500">Yuklanmoqda...</p>
      ) : !data?.length ? (
        <p className="text-sm text-gray-500">Yashirilgan savol yo'q.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {data.map(d => (
            <div key={d.id} className="py-3 flex gap-3 items-start">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
                  {d.fingerprint.startsWith('rule:') ? <>Barcha savollar: <i>{ruleName(d.ruleKey)}</i></> : (d.title || ruleName(d.ruleKey))}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 break-words">Sabab: {d.reason}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {d.createdByName ? `${d.createdByName}, ` : ''}{formatDate(d.createdAt)} · {d.until ? `${formatDate(d.until)} gacha` : 'doimiy'}
                </p>
              </div>
              <Button size="sm" variant="outline" icon={<RotateCcw className="w-3.5 h-3.5" />} loading={restore.isPending && restore.variables === d.id} onClick={() => restore.mutate(d.id)}>
                Qaytarish
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

interface ThresholdMeta { key: string; label: string; unit: string; min: number; max: number; group: string }

export function SettingsModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { data } = useQuery<{ values: Record<string, number>; defaults: Record<string, number>; meta: ThresholdMeta[] }>({
    queryKey: ['insights-settings'],
    queryFn: () => api.get('/insights/settings').then(r => r.data.data),
    enabled: open,
  })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const val = (k: string) => draft[k] ?? String(data?.values[k] ?? '')
  const m = useMutation({
    mutationFn: () => api.put('/insights/settings', { values: Object.fromEntries((data?.meta || []).map(x => [x.key, Number(val(x.key))])) }),
    onSuccess: () => { toast.success('Saqlandi — tahlil yangi chegaralar bilan qayta hisoblanadi'); setDraft({}); onClose(); onSaved() },
    onError: () => toast.error('Xatolik'),
  })
  const groups = [...new Set((data?.meta || []).map(x => x.group))]
  return (
    <Modal open={open} onClose={onClose} title="Tahlil chegaralari" size="lg"
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => setDraft(Object.fromEntries((data?.meta || []).map(x => [x.key, String(data!.defaults[x.key])])))}>Standartga qaytarish</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
            <Button loading={m.isPending} onClick={() => m.mutate()}>Saqlash</Button>
          </div>
        </div>
      }>
      {!data ? <p className="text-sm text-gray-500">Yuklanmoqda...</p> : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Tashkilotingizga moslang: masalan, karyer texnikasida sarf chegarasini oshirish kerak bo'lishi mumkin. Ruxsat etilgan oraliqdan tashqari qiymat standartga qaytadi.</p>
          {groups.map(g => (
            <div key={g}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{g}</h4>
              <div className="space-y-2">
                {data.meta.filter(x => x.group === g).map(x => {
                  const changed = Number(val(x.key)) !== data.defaults[x.key]
                  return (
                    <div key={x.key} className="flex items-center gap-3">
                      <label className="flex-1 text-sm text-gray-700 dark:text-gray-300">{x.label}</label>
                      <input type="number" min={x.min} max={x.max} value={val(x.key)} onChange={e => setDraft(d => ({ ...d, [x.key]: e.target.value }))}
                        className={cn('w-32 rounded-md border px-2.5 py-1.5 text-sm text-right bg-white dark:bg-gray-800', changed ? 'border-blue-400' : 'border-gray-300 dark:border-gray-600')} />
                      <span className="w-20 text-xs text-gray-500">{x.unit}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

/** Kunlik savollar soni — mini ustunli grafik */
export function TrendBars({ series }: { series: Array<{ date: string; total: number; critical: number }> }) {
  if (series.length < 2) return null
  const max = Math.max(...series.map(s => s.total), 1)
  return (
    <div className="flex items-end gap-0.5 h-8" aria-hidden>
      {series.map(s => (
        <div key={s.date} className="flex-1 min-w-[4px] flex flex-col justify-end" title={`${s.date.split('-').reverse().join('.')}: ${s.total} ta`}>
          <div className="w-full rounded-sm bg-blue-200 dark:bg-blue-800" style={{ height: `${Math.max(8, (s.total / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  )
}
