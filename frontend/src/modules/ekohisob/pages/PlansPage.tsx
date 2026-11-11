import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { ekoKeys } from '../lib/queries'
import { errMsg } from '../lib/ekoErrors'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import {
  Page, PageHeader, Card, Field, Input, DateInput, Button, Banner, EmptyState, ErrorState,
  SkeletonList, Menu, IconButton, useConfirm, cx, f,
} from '../ui'
import { MoreHorizontal } from 'lucide-react'

interface InspectorPlan {
  inspectorId: string
  fullName: string
  target: number | null
  done: number
  note: string | null
  planId?: string | null
}

/** Bugungi sana, O'zbekiston vaqti (UTC+5) bo'yicha — ISO. */
function todayUz(): string {
  return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10)
}

export default function PlansPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const isAdmin = useEkoAuthStore(s => s.user?.role === 'admin')
  const [date, setDate] = useState(todayUz)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const today = todayUz()
  const isToday = date === today
  const isPast = !!date && date < today
  // O'tgan sanani faqat admin sabab bilan o'zgartira oladi
  const locked = isPast && !isAdmin

  const q = useQuery<InspectorPlan[]>({
    queryKey: [...ekoKeys.plans, date],
    queryFn: async () => (await ekoApi.get(`/plans?date=${date}`)).data.data?.inspectors ?? [],
    enabled: !!date,
    staleTime: 15_000,
  })
  const inspectors = q.data ?? []

  useEffect(() => {
    const d: Record<string, string> = {}
    inspectors.forEach(i => { d[i.inspectorId] = i.target != null ? String(i.target) : '' })
    setDrafts(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data])

  async function savePlan(insp: InspectorPlan) {
    const raw = (drafts[insp.inspectorId] ?? '').trim()
    const target = Number(raw)
    if (raw === '' || !Number.isInteger(target) || target < 0) { toast.error("To'g'ri butun son kiriting"); return }
    let reason: string | undefined
    if (isPast) {
      const r = await confirm.ask({
        title: "O'tgan sana planini o'zgartirish",
        message: <>{f.date(date)} sanasidagi <b>{insp.fullName}</b> plani o'zgartiriladi. Bu amal jurnalga yoziladi.</>,
        confirmLabel: "O'zgartirish",
        reasonRequired: true,
        reasonMinLength: 5,
      })
      if (!r.confirmed) return
      reason = r.reason
    }
    setSavingId(insp.inspectorId)
    try {
      await ekoApi.post('/plans', { inspectorId: insp.inspectorId, date, targetCount: target, ...(reason ? { reason } : {}) })
      toast.success('Plan saqlandi')
      await qc.invalidateQueries({ queryKey: ekoKeys.plans })
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setSavingId(null) }
  }

  async function removePlan(insp: InspectorPlan) {
    if (!insp.planId) return
    let reason: string | undefined
    if (isPast) {
      const r = await confirm.ask({
        title: "O'tgan sana planini o'chirish",
        message: <>{f.date(date)} sanasidagi <b>{insp.fullName}</b> plani o'chiriladi.</>,
        confirmLabel: "O'chirish", danger: true, reasonRequired: true, reasonMinLength: 5,
      })
      if (!r.confirmed) return
      reason = r.reason
    } else {
      const ok = await confirm({
        title: "Planni o'chirish", message: <><b>{insp.fullName}</b> uchun {f.date(date)} plani o'chiriladi.</>,
        confirmLabel: "O'chirish", danger: true,
      })
      if (!ok) return
    }
    try {
      await ekoApi.delete(`/plans/${insp.planId}`, reason ? { data: { reason } } : undefined)
      toast.success("Plan o'chirildi")
      await qc.invalidateQueries({ queryKey: ekoKeys.plans })
    } catch (e) { toast.error(errMsg(e)) }
  }

  return (
    <Page>
      <PageHeader
        title="Kunlik planlar"
        subtitle="Inspektorlarga topshiriq bering — kuniga nechta tashkilot kiritsin"
      />

      <div className="max-w-xs">
        <Field label="Sana">
          <DateInput value={date} onChange={setDate} />
        </Field>
      </div>

      {!isToday && date && (
        <Banner tone="warn">
          Tanlangan sana bugun emas — progress o'sha kunda kiritilgan tashkilotlar bo'yicha.
          {isPast && (isAdmin
            ? " O'tgan sanani o'zgartirish uchun sabab yozish talab qilinadi."
            : " O'tgan sanani faqat admin o'zgartira oladi.")}
        </Banner>
      )}

      <Card flush>
        {q.isLoading ? (
          <SkeletonList rows={4} />
        ) : q.isError ? (
          <ErrorState title={errMsg(q.error)} onRetry={() => q.refetch()} />
        ) : inspectors.length === 0 ? (
          <EmptyState title="Inspektor topilmadi" hint="Avval Foydalanuvchilar bo'limidan inspektor qo'shing." />
        ) : (
          inspectors.map(insp => {
            const target = insp.target ?? 0
            const pct = target > 0 ? Math.min(100, Math.round(insp.done * 100 / target)) : 0
            const reached = target > 0 && insp.done >= target
            const draft = drafts[insp.inspectorId] ?? ''
            const original = insp.target != null ? String(insp.target) : ''
            const dirty = draft.trim() !== original
            return (
              <div key={insp.inspectorId} className="px-4 sm:px-5 py-3.5 border-b border-eko-line last:border-b-0 space-y-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="eko-text-base font-medium text-eko-text">{insp.fullName}</p>
                  {insp.target == null ? (
                    <span className="eko-text-sm text-eko-muted">Reja belgilanmagan</span>
                  ) : (
                    <span className="eko-text-base font-semibold eko-num">
                      {f.num(insp.done)} / {f.num(insp.target)}
                      {reached && <span className="ml-2 eko-text-xs font-normal text-eko-success">bajarildi</span>}
                    </span>
                  )}
                </div>
                {target > 0 && (
                  <div className="h-1.5 rounded-full bg-eko-surface-2 overflow-hidden" role="img" aria-label={`Bajarilish ${pct}%`}>
                    <div className={cx('h-full rounded-full', reached ? 'bg-eko-accent' : 'bg-eko-text-2')} style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    aria-label={`${insp.fullName}: maqsad`}
                    disabled={locked}
                    value={draft}
                    onChange={(e) => setDrafts(d => ({ ...d, [insp.inspectorId]: e.target.value }))}
                    placeholder="Maqsad (nechta tashkilot)"
                    className="flex-1 eko-num"
                  />
                  <Button
                    size="sm"
                    loading={savingId === insp.inspectorId}
                    disabled={locked || !dirty || draft.trim() === ''}
                    onClick={() => savePlan(insp)}
                  >
                    Saqlash
                  </Button>
                  {insp.planId && !locked && (
                    <Menu
                      items={[{ key: 'del', label: "Planni o'chirish", icon: <Trash2 className="w-4 h-4" />, danger: true, onSelect: () => removePlan(insp) }]}
                      trigger={(p) => <IconButton {...p} variant="ghost" size="sm" label="Boshqa amallar" icon={<MoreHorizontal className="w-4 h-4" />} />}
                    />
                  )}
                </div>
              </div>
            )
          })
        )}
      </Card>
    </Page>
  )
}
