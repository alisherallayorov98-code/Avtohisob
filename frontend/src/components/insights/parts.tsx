import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Cpu, Droplets, Fuel, Satellite, FileText, CircleDot, Wrench, Package, ClipboardList, Wallet, Database,
  ArrowRight, EyeOff, RotateCcw, Sparkles,
} from 'lucide-react'
import api from '../../lib/api'
import { cn, formatDate } from '../../lib/utils'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

export type Severity = 'critical' | 'warning' | 'info'
export type Category = 'engine' | 'service' | 'fuel' | 'gps' | 'documents' | 'tires' | 'repairs' | 'warehouse' | 'waybills' | 'budget' | 'data'

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
  fingerprint: string
  plate: string | null
  branchId: string | null
  isNew?: boolean
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

export function FindingRow({ f, showPlate = true, onDismiss }: { f: Finding; showPlate?: boolean; onDismiss: (f: Finding) => void }) {
  const sev = SEVERITY[f.severity]
  return (
    <div className="flex gap-3 py-3 px-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <span className={cn('mt-1.5 h-2.5 w-2.5 rounded-full flex-shrink-0', sev.dot)} title={sev.label} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {showPlate && f.plate && f.vehicleId && (
            <Link to={`/vehicles/${f.vehicleId}`} className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-900/40">
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
        </div>
        <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100 break-words">{f.title}</p>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400 break-words">{f.detail}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link to={f.action.path} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700">
            {f.action.label} <ArrowRight className="w-3 h-3" />
          </Link>
          <button onClick={() => onDismiss(f)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
            <EyeOff className="w-3 h-3" /> Normal holat
          </button>
        </div>
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
