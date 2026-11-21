import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Bot, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { Badge, Button, Card, EmptyState, ErrorState, SegmentedControl, SkeletonList, Textarea, useConfirm, f as fmt, cx } from '../../ui'
import { EvidenceTable } from './FindingCard'
import type { TaskRow } from './types'
import { TASK_STATUS_META } from './types'

type Filter = 'active' | 'suspicious' | 'done'

function TaskItem({ t, isAdmin, canAnswer, onOpenEntity, onChanged }: {
  t: TaskRow; isAdmin: boolean; canAnswer: boolean; onOpenEntity: (id: string) => void; onChanged: () => void
}) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const meta = TASK_STATUS_META[t.status]

  async function sendAnswer() {
    setBusy(true)
    try {
      await ekoApi.post(`/insights/tasks/${t.id}/answer`, { answer })
      toast.success('Javob yuborildi')
      setAnswer('')
      onChanged()
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  async function act(kind: 'close' | 'reopen') {
    const r = await confirm.ask({
      title: kind === 'close' ? 'Topshiriqni yopish' : 'Topshiriqni qayta ochish',
      message: kind === 'close' ? "Javob qabul qilindi — topshiriq yopiladi." : 'Topshiriq qayta ochiladi, muddat 3 kunga uzaytiriladi.',
      confirmLabel: kind === 'close' ? 'Yopish' : 'Qayta ochish',
      reasonRequired: kind === 'reopen', reasonMinLength: 3, reasonLabel: 'Izoh',
    })
    if (!r.confirmed) return
    try {
      await ekoApi.post(`/insights/tasks/${t.id}/${kind}`, { note: r.reason || undefined })
      onChanged()
    } catch (e) { toast.error(errMsg(e)) }
  }

  const active = t.status === 'open' || t.status === 'answered'

  return (
    <article className={cx('bg-eko-surface border border-eko-line rounded-eko-lg p-4 space-y-2.5', t.status === 'suspicious' && 'border-eko-danger-line')}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge tone={t.overdue ? 'danger' : meta.tone}>{t.overdue ? "Muddati o'tdi" : meta.label}</Badge>
        <span className="eko-text-xs text-eko-muted inline-flex items-center gap-1">
          {t.autoSent && <Bot className="w-3.5 h-3.5" aria-hidden />}
          {t.assignedByName ?? 'Robot'} → {t.assigneeName ?? 'xodim'} · {fmt.date(t.createdAt)}
          {t.dueDate && active && <> · muddat {fmt.date(t.dueDate)}</>}
        </span>
      </div>
      <h3 className="eko-text-md font-semibold text-eko-text leading-snug">{t.title}</h3>
      <p className="eko-text-sm text-eko-text-2 whitespace-pre-line">{t.detail}</p>
      {t.answer && (
        <div className="eko-text-sm bg-eko-surface-2 border border-eko-line rounded-eko px-3 py-2">
          <p className="text-eko-muted eko-text-xs">Javob · {fmt.dateTime(t.answeredAt)}</p>
          <p className="text-eko-text">{t.answer}</p>
        </div>
      )}
      {t.verifyNote && (
        <p className={cx('eko-text-sm', t.status === 'suspicious' ? 'text-eko-danger' : 'text-eko-muted')}>
          Robot tekshiruvi: {t.verifyNote}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {t.evidence && t.evidence.rows.length > 0 && (
          <Button size="sm" onClick={() => setOpen(v => !v)} aria-expanded={open}
            icon={open ? <ChevronUp className="w-4 h-4" aria-hidden /> : <ChevronDown className="w-4 h-4" aria-hidden />}>Manba</Button>
        )}
        {t.entityId && (
          <Button size="sm" variant="ghost" onClick={() => onOpenEntity(t.entityId!)} icon={<ExternalLink className="w-4 h-4" aria-hidden />}>
            {t.entityName ?? 'Tashkilot'}
          </Button>
        )}
        {isAdmin && (t.status === 'answered' || t.status === 'suspicious' || t.status === 'open') && (
          <Button size="sm" variant="ghost" onClick={() => act('close')}>Yopish</Button>
        )}
        {isAdmin && (t.status === 'answered' || t.status === 'suspicious' || t.status === 'closed' || t.status === 'resolved') && (
          <Button size="sm" variant="ghost" onClick={() => act('reopen')}>Qayta ochish</Button>
        )}
      </div>
      {open && t.evidence && <EvidenceTable ev={t.evidence} onOpenEntity={onOpenEntity} />}
      {canAnswer && active && (
        <div className="space-y-2 pt-1">
          <Textarea rows={2} placeholder="Javobingiz: nima qildingiz, nima bo'ldi?" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={1000} aria-label="Javob" />
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="primary" loading={busy} disabled={answer.trim().length < 3} onClick={sendAnswer}>Javob yuborish</Button>
            <span className="eko-text-xs text-eko-muted">Ma'lumotni kiritsangiz (to'lov, tashrif, telefon) — savol o'zi yopiladi.</span>
          </div>
        </div>
      )}
    </article>
  )
}

export default function TasksPanel({ isAdmin, isInspector, onOpenEntity }: {
  isAdmin: boolean; isInspector: boolean; onOpenEntity: (id: string) => void
}) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('active')
  const q = useQuery<TaskRow[]>({
    queryKey: ['eko', 'insights', 'tasks', filter],
    queryFn: async () => (await ekoApi.get('/insights/tasks', { params: { status: filter } })).data.data,
    staleTime: 30_000,
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['eko', 'insights'] }) }

  return (
    <div className="space-y-4">
      <SegmentedControl<Filter>
        ariaLabel="Topshiriqlar holati"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: 'Ochiq' },
          { value: 'suspicious', label: 'Shubhali' },
          { value: 'done', label: 'Yopilgan' },
        ]}
      />
      {q.isLoading ? <SkeletonList rows={4} /> : q.isError ? (
        <Card><ErrorState hint={errMsg(q.error)} onRetry={() => q.refetch()} /></Card>
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            tone={filter === 'done' ? 'neutral' : 'success'}
            title={filter === 'active' ? (isInspector ? "Sizga ochiq savol yo'q" : "Ochiq topshiriq yo'q") : filter === 'suspicious' ? "Shubhali natija yo'q" : "Yopilgan topshiriq yo'q"}
            hint={filter === 'suspicious' ? "Savol yo'qolgan, lekin robot buni haqiqiy ish bilan tasdiqlay olmagan holatlar shu yerda chiqadi." : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {q.data!.map(t => (
            <TaskItem key={t.id} t={t} isAdmin={isAdmin} canAnswer={isInspector || isAdmin} onOpenEntity={onOpenEntity} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}
