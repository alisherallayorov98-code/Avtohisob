import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import ekoApi from '../lib/ekoApi'
import { ekoKeys } from '../lib/queries'
import { errMsg } from '../lib/ekoErrors'
import {
  Page, PageHeader, Card, CardHeader, DataTable, FilterBar, DateRange, Modal, Badge, ErrorState, f,
} from '../ui'

interface AuditLog {
  id: string
  userId: string | null
  userName: string
  action: string
  actionLabel: string
  targetType: string
  targetId: string | null
  targetName: string | null
  amount: number | null
  details: Record<string, any> | null
  createdAt: string
}

interface Summary {
  days: number
  total: number
  byAction: { action: string; label: string; count: number }[]
  byUser: { name: string; count: number; deletedAmount: number }[]
}

// Bekor qilish amallari alohida belgilanadi — nazorat uchun eng muhimi shu
const DESTRUCTIVE = new Set(['payment.delete', 'talon.delete', 'talon.unpaid', 'entity.deactivate'])

/** Amal nomlari (backend `actionLabel` bermasa zaxira). */
const ACTION_LABELS: Record<string, string> = {
  'payment.create': "To'lov qabul qilindi",
  'payment.delete': "To'lov bekor qilindi",
  'talon.create': "Talon qo'shildi",
  'talon.update': "Talon o'zgartirildi",
  'talon.paid': "Talon to'landi",
  'talon.unpaid': "Talon to'lovi bekor qilindi",
  'talon.delete': "Talon o'chirildi",
  'entity.create': "Tashkilot qo'shildi",
  'entity.update': "Tashkilot o'zgartirildi",
  'entity.location': "Tashkilot joylashuvi o'zgartirildi",
  'entity.deactivate': 'Tashkilot deaktiv qilindi',
  'charge.recalc': 'Hisoblar qayta hisoblandi',
  'charge.generate': 'Oylik hisoblar yaratildi',
  'user.create': "Xodim qo'shildi",
  'user.update': "Xodim o'zgartirildi",
  'user.role_change': "Xodim roli o'zgartirildi",
  'user.deactivate': 'Xodim deaktiv qilindi',
  'user.activate': 'Xodim faollashtirildi',
  'user.password_reset': 'Parol admin tomonidan almashtirildi',
  'soliq.lookup': "Soliq ma'lumoti so'raldi",
  'receipt.view': 'Kvitansiya ochildi',
  'receipt.print': 'Kvitansiya chop etildi',
  'report.export': 'Hisobot eksport qilindi',
  'visit.create': 'Tashrif qaydi',
  'plan.set': 'Plan belgilandi',
  'plan.delete': "Plan o'chirildi",
  'kpi.close': 'KPI oyi yopildi',
  'kpi.reopen': 'KPI oyi qayta ochildi',
}

const FILTER_ACTIONS = Object.keys(ACTION_LABELS)
const PAGE_SIZE = 50
const SUMMARY_ROWS = 6

const labelOf = (l: { action: string; actionLabel?: string }) => ACTION_LABELS[l.action] ?? l.actionLabel ?? l.action

function amountText(l: AuditLog): string | null {
  if (l.amount == null) return null
  return `${DESTRUCTIVE.has(l.action) ? '−' : ''}${f.num(l.amount)}`
}

export default function AuditPage() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [open, setOpen] = useState<AuditLog | null>(null)

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
  if (action) params.set('action', action)
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  const rangeBad = !!range.from && !!range.to && range.from > range.to

  const logs = useQuery<{ rows: AuditLog[]; total: number }>({
    queryKey: [...ekoKeys.audit, 'list', params.toString()],
    queryFn: async () => {
      const res = await ekoApi.get(`/audit?${params}`)
      return { rows: res.data.data ?? [], total: res.data.meta?.total ?? 0 }
    },
    enabled: !rangeBad,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
  const summary = useQuery<Summary>({
    queryKey: [...ekoKeys.audit, 'summary'],
    queryFn: async () => (await ekoApi.get('/audit/summary')).data.data,
    staleTime: 60_000,
  })

  const total = logs.data?.total ?? 0
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(total, page * PAGE_SIZE)
  const s = summary.data

  function change<T>(set: (v: T) => void) { return (v: T) => { set(v); setPage(1) } }

  return (
    <Page>
      <PageHeader
        title="Amallar jurnali"
        subtitle="Pulga ta'sir qiluvchi va nazorat uchun muhim amallar: kim, qachon, nima"
      />

      {s && s.total > 0 && (
        <div className="grid gap-4 md:grid-cols-2 items-stretch">
          <Card flush className="flex flex-col">
            <CardHeader title={`Amallar, oxirgi ${s.days} kun`} hint={`Jami ${f.num(s.total)} ta`} />
            <ul className="px-4 sm:px-5 py-2 flex-1">
              {s.byAction.slice(0, SUMMARY_ROWS).map(a => (
                <li key={a.action} className="flex items-center justify-between gap-3 py-1.5 eko-text-base">
                  <span className="text-eko-text truncate">{ACTION_LABELS[a.action] ?? a.label}</span>
                  <span className="eko-num font-medium text-eko-text">{f.num(a.count)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card flush className="flex flex-col">
            <CardHeader title="Xodimlar bo'yicha" hint="Bekor qilingan summa bo'yicha, keyin amallar soni bo'yicha" />
            <ul className="px-4 sm:px-5 py-2 flex-1">
              {s.byUser.slice(0, SUMMARY_ROWS).map(u => (
                <li key={u.name} className="flex items-center justify-between gap-3 py-1.5 eko-text-base">
                  <span className="text-eko-text truncate">{u.name}</span>
                  <span className="eko-num text-eko-muted shrink-0">
                    {f.num(u.count)} amal
                    {u.deletedAmount > 0 && <span className="text-eko-text font-medium"> · bekor: −{f.num(u.deletedAmount)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <FilterBar
        filters={[{
          key: 'action', label: 'Amal', value: action, onChange: change(setAction),
          options: FILTER_ACTIONS.map(a => ({ value: a, label: ACTION_LABELS[a] })),
          allLabel: 'Barcha amallar',
        }]}
        chips={range.from || range.to ? [{
          key: 'range',
          label: `${f.date(range.from) || '…'} – ${f.date(range.to) || '…'}`,
          onRemove: () => { setRange({ from: '', to: '' }); setPage(1) },
        }] : []}
        onClear={() => { setAction(''); setRange({ from: '', to: '' }); setPage(1) }}
        actions={<span className="eko-text-sm text-eko-muted eko-num">{total > 0 ? `${f.num(from)}–${f.num(to)} / ${f.num(total)} yozuv` : '0 yozuv'}</span>}
      >
        <DateRange from={range.from} to={range.to} onChange={(r) => { setRange(r); setPage(1) }} />
      </FilterBar>
      {rangeBad && <ErrorState title="Boshlanish sanasi tugash sanasidan keyin" hint="Sana oralig'ini tuzating." compact />}

      <Card flush>
        <DataTable
          aria-label="Amallar jurnali"
          rows={logs.data?.rows ?? []}
          rowKey={(r) => r.id}
          loading={logs.isLoading}
          error={logs.isError ? errMsg(logs.error) : null}
          onRetry={() => logs.refetch()}
          onRowClick={setOpen}
          empty={{ title: 'Yozuv topilmadi', hint: "Filtrlarni o'zgartirib ko'ring." }}
          pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: setPage }}
          columns={[
            { key: 'createdAt', title: 'Vaqt', width: 150, render: (r) => <span className="eko-num whitespace-nowrap">{f.dateTime(r.createdAt)}</span> },
            { key: 'userName', title: 'Xodim', mobile: 'secondary' },
            {
              key: 'action', title: 'Amal', mobile: 'primary',
              render: (r) => (
                <>
                  <span className={DESTRUCTIVE.has(r.action) ? 'font-semibold' : 'font-medium'}>{labelOf(r)}</span>
                  {r.targetName && <span className="block eko-text-xs text-eko-muted truncate">{r.targetName}</span>}
                  {r.details?.reason && <span className="block eko-text-xs text-eko-muted">Sabab: {r.details.reason}</span>}
                </>
              ),
            },
            { key: 'amount', title: "Summa, so'm", align: 'right', render: (r) => amountText(r) },
          ]}
        />
      </Card>

      {open && (
        <Modal
          onClose={() => setOpen(null)}
          size="md"
          title={labelOf(open)}
          hint={`${f.dateTime(open.createdAt)} · ${open.userName}`}
        >
          <div className="p-5 space-y-4">
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 eko-text-base">
              <dt className="text-eko-muted">Obyekt</dt>
              <dd>{open.targetName ?? '—'} {open.targetType && <Badge tone="neutral">{open.targetType}</Badge>}</dd>
              <dt className="text-eko-muted">Summa</dt>
              <dd className="eko-num">{open.amount == null ? '—' : `${amountText(open)} so'm`}</dd>
              <dt className="text-eko-muted">Amal kodi</dt>
              <dd className="eko-num">{open.action}</dd>
            </dl>
            {open.details && Object.keys(open.details).length > 0 ? (
              <div>
                <p className="eko-text-base font-medium text-eko-text mb-2">Tafsilotlar</p>
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 eko-text-sm border-t border-eko-line pt-2">
                  {Object.entries(open.details).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-eko-muted break-words">{k}</dt>
                      <dd className="text-eko-text break-words whitespace-pre-wrap eko-num">
                        {v != null && typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v ?? '—')}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <p className="eko-text-sm text-eko-muted">Qo'shimcha tafsilot yo'q.</p>
            )}
          </div>
        </Modal>
      )}
    </Page>
  )
}
