// Tahlil → filialga so'rov: yuborish oynasi, yozishmalar, admin "So'rovlar" yorlig'i.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Send, CheckCircle2, RotateCcw, XCircle, Building2, Clock } from 'lucide-react'
import api from '../../lib/api'
import { cn, formatDate, formatDateTime } from '../../lib/utils'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import type { Finding, Evidence } from './parts'
import { MiniTable } from './parts'

export interface RequestMessage { id: string; side: 'admin' | 'branch' | 'system'; userName: string | null; text: string; createdAt: string }
export interface InsightRequestRow {
  id: string; branchId: string; branchName: string | null; fingerprint: string; ruleKey: string; vehicleId: string | null; plate: string | null
  title: string; detail: string; evidence: Evidence | null; quick: Finding['quick'] | null; actionPath: string | null
  status: 'open' | 'answered' | 'closed' | 'resolved'; dueDate: string | null; createdAt: string; updatedAt: string
  messages: RequestMessage[]
}

export const REQ_STATUS: Record<InsightRequestRow['status'], { label: string; cls: string }> = {
  open: { label: 'Javob kutilmoqda', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  answered: { label: 'Javob berildi', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
  closed: { label: 'Yopilgan', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  resolved: { label: "Hal bo'ldi", cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
}

const errText = (e: any) => e?.response?.data?.error || e?.response?.data?.message || 'Xatolik'
const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm'

export function isOverdue(r: Pick<InsightRequestRow, 'status' | 'dueDate'>): boolean {
  return r.status === 'open' && !!r.dueDate && new Date(r.dueDate).getTime() < Date.now()
}

export function Thread({ messages }: { messages: RequestMessage[] }) {
  if (!messages.length) return null
  return (
    <div className="space-y-1.5">
      {messages.map(m => (
        <div key={m.id} className={cn('rounded-lg px-3 py-2 text-sm',
          m.side === 'admin' ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900'
            : m.side === 'branch' ? 'bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-900'
              : 'bg-gray-50 dark:bg-gray-800/60 text-gray-500 italic')}>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
            {m.side === 'admin' ? `Markaz${m.userName ? ` · ${m.userName}` : ''}` : m.side === 'branch' ? `Filial${m.userName ? ` · ${m.userName}` : ''}` : 'Tizim'} · {formatDateTime(m.createdAt)}
          </div>
          <div className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{m.text}</div>
        </div>
      ))}
    </div>
  )
}

/** Bitta yoki bir nechta savolni filialga yuborish */
export function SendModal({ findings, branches, onClose, onSent }: {
  findings: Finding[] | null
  branches: Array<{ id: string; name: string }>
  onClose: () => void
  onSent: () => void
}) {
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [fallbackBranch, setFallbackBranch] = useState('')
  const list = findings || []
  const pending = list.filter(f => !f.request)
  const withBranch = pending.filter(f => f.branchId)
  const noBranch = pending.filter(f => !f.branchId)
  const byBranch = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of withBranch) m.set(f.branchId!, (m.get(f.branchId!) || 0) + 1)
    return [...m.entries()].map(([id, n]) => ({ id, n, name: branches.find(b => b.id === id)?.name || 'Filial' }))
  }, [withBranch, branches])

  const m = useMutation({
    mutationFn: async () => {
      let created = 0, skipped = 0
      const common = { dueDate: dueDate || undefined, note: note.trim() || undefined }
      if (withBranch.length) {
        const r = await api.post('/insight-requests/send', { fingerprints: withBranch.map(f => f.fingerprint), ...common })
        created += r.data.data.created; skipped += r.data.data.skippedDuplicate + r.data.data.skippedGone + r.data.data.skippedNoBranch
      }
      if (noBranch.length && fallbackBranch) {
        const r = await api.post('/insight-requests/send', { fingerprints: noBranch.map(f => f.fingerprint), branchId: fallbackBranch, ...common })
        created += r.data.data.created; skipped += r.data.data.skippedDuplicate + r.data.data.skippedGone
      }
      return { created, skipped }
    },
    onSuccess: ({ created, skipped }) => {
      toast.success(`${created} ta savol filialga yuborildi${skipped ? ` (${skipped} tasi o'tkazib yuborildi)` : ''}`)
      setDueDate(''); setNote(''); setFallbackBranch('')
      onClose(); onSent()
    },
    onError: (e) => toast.error(errText(e)),
  })

  if (!findings) return null
  const canSend = withBranch.length > 0 || (noBranch.length > 0 && !!fallbackBranch)
  return (
    <Modal open={!!findings} onClose={onClose} title="Filialga so'rov yuborish" size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!canSend} icon={<Send className="w-4 h-4" />}>Yuborish</Button>
        </div>
      }>
      <div className="space-y-3">
        {pending.length === 1 ? (
          <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3">{pending[0].title}</p>
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-300">{pending.length} ta savol yuboriladi{list.length > pending.length ? ` (${list.length - pending.length} tasi allaqachon yuborilgan)` : ''}.</p>
        )}
        {byBranch.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {byBranch.map(b => (
              <span key={b.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <Building2 className="w-3 h-3" /> {b.name}: {b.n} ta
              </span>
            ))}
          </div>
        )}
        {noBranch.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {noBranch.length} ta umumiy savol (mashinaga bog'liq emas) — qaysi filialga?
            </label>
            <select value={fallbackBranch} onChange={e => setFallbackBranch(e.target.value)} className={inputCls}>
              <option value="">— yubormaslik —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Muddat</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000} className={inputCls}
            placeholder="Masalan: shu hafta ichida aniqlab, kiritib qo'ying" />
        </div>
        <p className="text-xs text-gray-500">Filial mas'uli menyudagi "Tahlil" bo'limida ko'radi va Telegram botdan xabar oladi.</p>
      </div>
    </Modal>
  )
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'Faol + oxirgi 30 kun' },
  { key: 'answered', label: 'Javob keldi' },
  { key: 'open', label: 'Javob kutilmoqda' },
  { key: 'resolved', label: "Hal bo'lgan" },
  { key: 'closed', label: 'Yopilgan' },
]

/** Admin: yuborilgan so'rovlar va javoblar */
export function RequestsTab({ onChanged }: { onChanged: () => void }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState('answered')
  const [reaskId, setReaskId] = useState<string | null>(null)
  const [reaskText, setReaskText] = useState('')
  const { data = [], isLoading } = useQuery<InsightRequestRow[]>({
    queryKey: ['insight-requests-admin', status],
    queryFn: () => api.get('/insight-requests', { params: { status: status || undefined } }).then(r => r.data.data),
  })
  const act = useMutation({
    mutationFn: (p: { id: string; action: 'close' | 'reask' | 'cancel'; text?: string }) => api.post(`/insight-requests/${p.id}/action`, p),
    onSuccess: (_, p) => {
      toast.success(p.action === 'close' ? 'Qabul qilindi' : p.action === 'reask' ? "Filialga qayta yuborildi" : 'Bekor qilindi')
      setReaskId(null); setReaskText('')
      qc.invalidateQueries({ queryKey: ['insight-requests-admin'] })
      qc.invalidateQueries({ queryKey: ['insight-badge'] })
      onChanged()
    },
    onError: (e) => toast.error(errText(e)),
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setStatus(f.key)}
            className={cn('text-xs px-2.5 py-1.5 rounded-full border', status === f.key ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700')}>
            {f.label}
          </button>
        ))}
      </div>
      {isLoading ? <p className="text-sm text-gray-500 py-6 text-center">Yuklanmoqda...</p>
        : data.length === 0 ? <p className="text-sm text-gray-500 py-8 text-center">So'rov yo'q.</p>
          : data.map(r => (
            <div key={r.id} className="glass-card rounded-xl p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full', REQ_STATUS[r.status].cls)}>{REQ_STATUS[r.status].label}</span>
                {r.plate && <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">{r.plate}</span>}
                <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Building2 className="w-3 h-3" /> {r.branchName || 'Filial'}</span>
                {r.dueDate && (
                  <span className={cn('inline-flex items-center gap-1 text-xs', isOverdue(r) ? 'text-red-600 font-semibold' : 'text-gray-500')}>
                    <Clock className="w-3 h-3" /> {formatDate(r.dueDate)}{isOverdue(r) && " — muddati o'tdi"}
                  </span>
                )}
                <span className="text-xs text-gray-400 ml-auto">Yuborilgan: {formatDate(r.createdAt)}</span>
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.title}</p>
              <Thread messages={r.messages} />
              {reaskId === r.id ? (
                <div className="space-y-2">
                  <textarea value={reaskText} onChange={e => setReaskText(e.target.value)} rows={2} className={inputCls} placeholder="Nima noaniq? Filial nimani aniqlashtirishi kerak?" />
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setReaskId(null)}>Bekor</Button>
                    <Button size="sm" loading={act.isPending} disabled={reaskText.trim().length < 3} onClick={() => act.mutate({ id: r.id, action: 'reask', text: reaskText })}>Qayta so'rash</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {r.status === 'answered' && (
                    <>
                      <Button size="sm" icon={<CheckCircle2 className="w-3.5 h-3.5" />} loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'close' })}>Qabul qilish</Button>
                      <Button size="sm" variant="outline" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={() => { setReaskId(r.id); setReaskText('') }}>Qayta so'rash</Button>
                    </>
                  )}
                  {r.status === 'open' && (
                    <Button size="sm" variant="ghost" icon={<XCircle className="w-3.5 h-3.5" />} loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'cancel' })}>So'rovni bekor qilish</Button>
                  )}
                  {(r.status === 'closed' || r.status === 'resolved') && (
                    <Button size="sm" variant="outline" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={() => { setReaskId(r.id); setReaskText('') }}>Qayta ochish</Button>
                  )}
                </div>
              )}
              {r.evidence && r.evidence.rows?.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500">Dalil</summary>
                  <div className="mt-1 max-h-60 overflow-y-auto"><MiniTable columns={r.evidence.columns} rows={r.evidence.rows} /></div>
                </details>
              )}
            </div>
          ))}
    </div>
  )
}
