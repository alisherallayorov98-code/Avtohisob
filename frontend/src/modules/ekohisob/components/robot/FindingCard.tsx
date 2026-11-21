import { useState } from 'react'
import {
  ChevronDown, ChevronUp, ExternalLink, MoreHorizontal, EyeOff, Gavel, UserPlus, CheckCircle2, Clock, Bot,
} from 'lucide-react'
import { Badge, Button, IconButton, Menu, Tooltip, cx, f as fmt } from '../../ui'
import type { Evidence, Finding } from './types'
import { CATEGORY_LABEL, CONFIDENCE_META, TASK_STATUS_META } from './types'

const SEV_BAR: Record<Finding['severity'], string> = {
  critical: 'border-l-eko-danger',
  warning: 'border-l-eko-warn',
  info: 'border-l-eko-line-strong',
}
const SEV_LABEL: Record<Finding['severity'], { label: string; tone: 'danger' | 'warn' | 'neutral' }> = {
  critical: { label: 'Muhim', tone: 'danger' },
  warning: { label: 'Diqqat', tone: 'warn' },
  info: { label: "Ma'lumot", tone: 'neutral' },
}

export function EvidenceTable({ ev, onOpenEntity }: { ev: Evidence; onOpenEntity?: (id: string) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-eko border border-eko-line">
        <table className="w-full eko-text-sm">
          <thead className="bg-eko-surface-2">
            <tr>
              {ev.columns.map((c, i) => (
                <th key={i} scope="col" className="text-left font-medium text-eko-muted px-3 py-2 whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ev.rows.map((r, i) => {
              const id = ev.entityIds?.[i]
              return (
                <tr
                  key={i}
                  className={cx('border-t border-eko-line', id && onOpenEntity && 'cursor-pointer hover:bg-eko-surface-2')}
                  onClick={id && onOpenEntity ? () => onOpenEntity(id) : undefined}
                >
                  {r.map((v, j) => (
                    <td key={j} className="px-3 py-2 text-eko-text align-top">
                      {j === 0 && id && onOpenEntity ? <span className="underline decoration-eko-line-strong underline-offset-2">{v}</span> : v}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {ev.note && <p className="eko-text-xs text-eko-muted">{ev.note}</p>}
    </div>
  )
}

export default function FindingCard({
  finding: x, isAdmin, onOpenEntity, onNavigate, onVerdict, onDismiss, onAssign,
}: {
  finding: Finding
  isAdmin: boolean
  onOpenEntity: (id: string) => void
  onNavigate: (path: string) => void
  onVerdict: (f: Finding) => void
  onDismiss: (f: Finding, mode: 'one30' | 'one' | 'rule') => void
  onAssign: (f: Finding) => void
}) {
  const [open, setOpen] = useState(false)
  const conf = CONFIDENCE_META[x.confidence ?? 'fact']
  const sev = SEV_LABEL[x.severity]
  const collapsed = x.subjectKey === 'collapsed'
  const hasEvidence = !!x.evidence && x.evidence.rows.length > 0

  function runAction() {
    if (!x.action) return
    if (x.action.path.startsWith('entity:')) onOpenEntity(x.action.path.slice(7))
    else onNavigate(x.action.path)
  }

  const adminItems = [
    ...(!collapsed && x.entityId && !x.task ? [{ key: 'assign', label: 'Xodimga topshirish', icon: <UserPlus className="w-4 h-4" />, onSelect: () => onAssign(x) }] : []),
    ...(!collapsed ? [
      { key: 'd30', label: '30 kunga yashirish', icon: <EyeOff className="w-4 h-4" />, onSelect: () => onDismiss(x, 'one30') },
      { key: 'd', label: 'Doimiy yashirish', icon: <EyeOff className="w-4 h-4" />, onSelect: () => onDismiss(x, 'one') },
    ] : []),
    { key: 'rule', label: "Bu turdagi barcha savollarni o'chirish", icon: <EyeOff className="w-4 h-4" />, danger: true, divider: !collapsed, onSelect: () => onDismiss(x, 'rule') },
  ]

  return (
    <article className={cx('bg-eko-surface border border-eko-line border-l-4 rounded-eko-lg', SEV_BAR[x.severity])}>
      <div className="p-4 space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge tone={sev.tone}>{sev.label}</Badge>
              <Badge tone="neutral">{CATEGORY_LABEL[x.category]}</Badge>
              <Tooltip content={x.basis || conf.hint}>
                <span><Badge tone={conf.tone}>{conf.label}</Badge></span>
              </Tooltip>
              {x.districtName && <span className="eko-text-xs text-eko-muted">{x.districtName}</span>}
              {x.ruleAccuracy?.pct != null && (
                <Tooltip content={`Hukmlar: ${x.ruleAccuracy.confirmed} to'g'ri, ${x.ruleAccuracy.wrong} noto'g'ri, ${x.ruleAccuracy.normal} normal`}>
                  <span className={cx('eko-text-xs', x.lowAccuracy ? 'text-eko-warn' : 'text-eko-muted')}>aniqlik {x.ruleAccuracy.pct}%</span>
                </Tooltip>
              )}
            </div>
            <h3 className="eko-text-md font-semibold text-eko-text leading-snug">{x.title}</h3>
            <p className="eko-text-sm text-eko-text-2 leading-relaxed whitespace-pre-line">{x.detail}</p>
          </div>
          {x.impactUzs ? (
            <div className="text-right shrink-0 hidden sm:block">
              <p className="eko-text-xs text-eko-muted">Pul ta'siri</p>
              <p className="eko-text-md font-semibold text-eko-text tabular-nums">{fmt.moneyShort(x.impactUzs)}</p>
            </div>
          ) : null}
        </div>

        {x.confidence === 'guess' && x.staffUserId && (
          <p className="eko-text-xs text-eko-warn">
            Bu taxmin. Xodimni ayblashdan oldin manbani ko'ring va undan tushuntirish so'rang.
          </p>
        )}

        {x.verdict && (
          <div className="flex items-start gap-2 eko-text-sm bg-eko-success-soft border border-eko-success-line rounded-eko px-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-eko-success mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-eko-text"><b>Tasdiqlangan</b> — {x.verdict.by ?? 'admin'}, {fmt.date(x.verdict.at)}: {x.verdict.reason}</p>
              {x.verdict.resolution && <p className="text-eko-text-2">Yechim: {x.verdict.resolution}</p>}
            </div>
          </div>
        )}

        {x.task && (
          <div className="flex items-start gap-2 eko-text-sm bg-eko-surface-2 border border-eko-line rounded-eko px-3 py-2">
            {x.task.autoSent ? <Bot className="w-4 h-4 text-eko-muted mt-0.5 shrink-0" aria-hidden /> : <Clock className="w-4 h-4 text-eko-muted mt-0.5 shrink-0" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="text-eko-text">
                {x.task.autoSent ? 'Robot yubordi' : 'Topshirildi'}: <b>{x.task.assigneeName ?? 'xodim'}</b>
                {x.task.dueDate && <> · muddat {fmt.date(x.task.dueDate)}</>}
                {' '}<Badge tone={x.task.overdue ? 'danger' : TASK_STATUS_META[x.task.status].tone}>{x.task.overdue ? "Muddati o'tdi" : TASK_STATUS_META[x.task.status].label}</Badge>
              </p>
              {x.task.answer && <p className="text-eko-text-2 mt-0.5">Javob: {x.task.answer}</p>}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          {hasEvidence && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(v => !v)} aria-expanded={open}
              icon={open ? <ChevronUp className="w-4 h-4" aria-hidden /> : <ChevronDown className="w-4 h-4" aria-hidden />}>
              Manba{x.evidence!.rows.length > 1 ? ` (${x.evidence!.rows.length})` : ''}
            </Button>
          )}
          {x.action && (
            <Button size="sm" variant="ghost" onClick={runAction} icon={<ExternalLink className="w-4 h-4" aria-hidden />}>
              {x.action.label}
            </Button>
          )}
          {isAdmin && (
            <>
              {!x.verdict && (
                <Button size="sm" variant="ghost" onClick={() => onVerdict(x)} icon={<Gavel className="w-4 h-4" aria-hidden />}>Hukm</Button>
              )}
              <Menu
                items={adminItems}
                trigger={(p) => <IconButton {...p} size="sm" variant="ghost" label="Boshqa amallar" icon={<MoreHorizontal className="w-4 h-4" />} />}
              />
            </>
          )}
          {x.impactUzs ? <span className="sm:hidden ml-auto eko-text-xs text-eko-muted tabular-nums">{fmt.moneyShort(x.impactUzs)}</span> : null}
        </div>

        {open && hasEvidence && <EvidenceTable ev={x.evidence!} onOpenEntity={onOpenEntity} />}
      </div>
    </article>
  )
}
