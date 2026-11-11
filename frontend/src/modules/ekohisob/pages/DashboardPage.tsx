import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { CalendarPlus, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { ekoKeys, invalidateEko, useDistricts, useMahallas } from '../lib/queries'
import { errMsg } from '../lib/ekoErrors'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'
import EntityCardModal from '../components/EntityCardModal'
import DebtorRow, { DashEntity, PromiseInfo, Urgency, urgencyOf } from '../components/dashboard/DebtorRow'
import OnboardingBanner from '../components/dashboard/OnboardingBanner'
import {
  Page, PageHeader, SegmentedControl, Card, Button, StatRow, StatTile, EmptyState, ErrorState,
  Skeleton, SkeletonList, Banner, FilterBar, MonthInput, useConfirm, f,
} from '../ui'

function currentMonth(): string {
  const d = new Date(Date.now() + 5 * 3600e3) // UZT
  return d.toISOString().slice(0, 7)
}

interface Stats {
  month?: string
  totalEntities: number
  paidThisMonth: number
  unpaidThisMonth: number
  collectedAmount: number
  collectedCash?: number
  totalDebt?: number
  blacklistedDebt?: number
  unbilledDebt?: number
  totalDebtWithUnbilled?: number
}

interface MahallaGroup { mahallId: string; mahallName: string; entities: DashEntity[] }

interface Daily {
  groups: MahallaGroup[]
  paidToday: { id: string; name: string; address: string; monthlyFee: number }[]
  totalDebtors?: number
  totalDebtAmount?: number
  totalUnbilledDebt?: number
  meta?: { truncated?: boolean; shown?: number }
}

interface PromiseRow { entityId: string; promisedDate: string; daysOverdue: number }

const URGENCY_META: Record<Urgency, { title: string; hint: string }> = {
  critical: { title: 'Kritik', hint: "3 oy va undan ko'p" },
  overdue: { title: "Muddati o'tgan", hint: '2 oy' },
  warning: { title: 'Yangi qarz', hint: '1 oy' },
}

type GroupBy = 'urgency' | 'mahalla'

export default function DashboardPage({ readOnly = false, isAdmin = false }: { readOnly?: boolean; isAdmin?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()

  const [district, setDistrict] = useState('')
  const [mahalla, setMahalla] = useState('')
  const [month, setMonth] = useState(currentMonth())
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'unpaid' | 'paid'>('unpaid')
  const [groupBy, setGroupBy] = useState<GroupBy>('urgency')
  const [generating, setGenerating] = useState(false)
  const [payFor, setPayFor] = useState<EntityBasic | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const districts = useDistricts()
  const mahallas = useMahallas(district || '')

  const stats = useQuery<Stats>({
    queryKey: [...ekoKeys.dashboard, 'stats'],
    queryFn: async () => (await ekoApi.get('/dashboard/stats')).data.data,
    staleTime: 30_000,
  })

  const daily = useQuery<Daily>({
    queryKey: [...ekoKeys.dashboard, 'daily', district, mahalla, month],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (district) params.set('districtId', district)
      if (mahalla) params.set('mahallId', mahalla)
      params.set('month', month)
      const res = await ekoApi.get(`/dashboard/daily?${params}`)
      return { ...(res.data.data ?? {}), meta: res.data.meta }
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  // Va'dasi bugun muddati kelgan/o'tgan tashkilotlar. Xato bo'lsa ro'yxatni to'smaydi.
  const promises = useQuery<Record<string, PromiseInfo>>({
    queryKey: [...ekoKeys.dashboard, 'promises'],
    queryFn: async () => {
      const rows: PromiseRow[] = (await ekoApi.get('/visits/promises')).data.data ?? []
      return Object.fromEntries(rows.map(r => [r.entityId, { promisedDate: r.promisedDate, daysOverdue: r.daysOverdue }]))
    },
    staleTime: 60_000,
    retry: false,
  })

  const q = search.trim().toLowerCase()
  const allEntities = useMemo(() => {
    const out: DashEntity[] = []
    for (const g of daily.data?.groups ?? []) {
      for (const e of g.entities) {
        if (q && !e.name.toLowerCase().includes(q) && !(e.address ?? '').toLowerCase().includes(q)) continue
        out.push({ ...e, mahallName: g.mahallName })
      }
    }
    return out
  }, [daily.data, q])

  const sections = useMemo(() => {
    const byDebt = (a: DashEntity, b: DashEntity) => b.debtAmount - a.debtAmount
    if (groupBy === 'mahalla') {
      const m = new Map<string, DashEntity[]>()
      for (const e of allEntities) {
        const key = e.mahallName ?? 'Mahallasiz'
        m.set(key, [...(m.get(key) ?? []), e])
      }
      return Array.from(m.entries())
        .map(([key, items]) => ({ key, title: key, hint: undefined as string | undefined, items: items.sort(byDebt) }))
        .sort((a, b) => sum(b.items) - sum(a.items))
    }
    return (['critical', 'overdue', 'warning'] as Urgency[])
      .map(u => ({
        key: u,
        title: URGENCY_META[u].title,
        hint: URGENCY_META[u].hint as string | undefined,
        items: allEntities.filter(e => urgencyOf(e) === u).sort(byDebt),
      }))
      .filter(s => s.items.length > 0)
  }, [allEntities, groupBy])

  const criticalCount = allEntities.filter(e => urgencyOf(e) === 'critical').length
  const truncated = !!daily.data?.meta?.truncated
  const totalDebt = daily.data?.totalDebtAmount ?? stats.data?.totalDebtWithUnbilled ?? stats.data?.totalDebt ?? 0
  const unbilled = daily.data?.totalUnbilledDebt ?? 0
  const scoped = !!district || !!mahalla

  function refetchAll() {
    invalidateEko(qc, 'payment')
  }

  async function generateCharges() {
    const ok = await confirm({
      title: 'Hisoblarni yaratish',
      message: <><b>{f.monthLabel(month)}</b> uchun barcha belgilangan-oylik tashkilotlarga avtomatik hisob yaratiladi.</>,
      consequences: ['Allaqachon hisob bor tashkilotlarga takror yaratilmaydi'],
      confirmLabel: 'Yaratish',
    })
    if (!ok) return
    setGenerating(true)
    try {
      const res = await ekoApi.post('/charges/generate', { month })
      toast.success(`${res.data.data?.created ?? 0} ta hisob yaratildi`)
      refetchAll()
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setGenerating(false) }
  }

  function openPay(e: DashEntity) {
    setPayFor({ id: e.id, name: e.name, address: e.address, monthlyFee: e.monthlyFee, unpaidMonths: e.unpaidMonths })
  }

  const statsLoading = stats.isLoading
  const statsMonth = stats.data?.month ?? currentMonth()
  const listError = daily.isError && !daily.data

  return (
    <Page>
      <PageHeader
        title="Bugungi ish"
        subtitle={`${f.monthLabel(month)} · qarzdorlar ro'yxati`}
        meta={{
          updatedAt: daily.dataUpdatedAt || null,
          onRefresh: () => { stats.refetch(); daily.refetch() },
          refreshing: daily.isFetching,
        }}
        actions={isAdmin && (
          <Button size="sm" loading={generating} icon={<CalendarPlus className="w-4 h-4" />} onClick={generateCharges}>
            Hisoblarni yarat
          </Button>
        )}
      />

      {isAdmin && <OnboardingBanner paidAny={(stats.data?.paidThisMonth ?? 0) > 0 || (stats.data?.collectedAmount ?? 0) > 0} />}

      {/* Asosiy javob: jami qarz + bitta topilma */}
      <section aria-label="Jami qarz" className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <div>
          <p className="eko-text-sm text-eko-muted">Jami qarz{scoped ? ' · tanlangan hudud' : ''}</p>
          {daily.isLoading ? (
            <Skeleton className="h-9 w-56 mt-1.5" />
          ) : listError ? (
            <p className="eko-text-lead font-semibold text-eko-muted mt-0.5">—</p>
          ) : (
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="eko-text-lead font-semibold eko-num text-eko-text">{f.num(totalDebt)}</span>
              <span className="eko-text-base text-eko-muted">so'm</span>
            </p>
          )}
          {unbilled > 0 && !listError && (
            <p className="eko-text-xs text-eko-muted mt-1 eko-num">shundan {f.num(unbilled)} so'm — hisobi hali yaratilmagan</p>
          )}
        </div>
        {!daily.isLoading && !listError && (
          <p className="eko-text-base text-eko-text-2">
            {criticalCount > 0
              ? <><b className="font-semibold text-eko-text">Kritik: {f.num(criticalCount)} ta qarzdor</b>, 3+ oy{truncated ? " (ro'yxat bo'yicha)" : ''}</>
              : "Kritik qarzdor yo'q (3+ oy)"}
          </p>
        )}
      </section>

      <StatRow>
        <StatTile
          loading={statsLoading}
          label={`To'lagan, ${f.monthLabel(statsMonth)}`}
          value={f.num(stats.data?.paidThisMonth ?? 0)}
          unit={`/ ${f.num(stats.data?.totalEntities ?? 0)} ta`}
        />
        <StatTile
          loading={statsLoading}
          label="Kassaga tushdi"
          value={f.num(stats.data?.collectedCash ?? 0)}
          unit="so'm"
        />
        <StatTile
          loading={statsLoading}
          label="Qora ro'yxat qarzi"
          value={f.num(stats.data?.blacklistedDebt ?? 0)}
          unit="so'm"
        />
      </StatRow>
      {stats.isError && (
        <Banner tone="danger" action={<Button size="sm" onClick={() => stats.refetch()}>Qayta urinish</Button>}>
          Ko'rsatkichlarni yuklab bo'lmadi: {errMsg(stats.error)}
        </Banner>
      )}

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Nom yoki manzil…' }}
        filters={[
          {
            key: 'district', label: 'Tuman', value: district,
            onChange: (v) => { setDistrict(v); setMahalla('') },
            options: (districts.data ?? []).map(d => ({ value: d.id, label: d.name })),
            allLabel: 'Barcha tumanlar',
          },
          ...(district && (mahallas.data ?? []).length > 0 ? [{
            key: 'mahalla', label: 'Mahalla', value: mahalla, onChange: setMahalla,
            options: (mahallas.data ?? []).map(m => ({ value: m.id, label: m.name })),
            allLabel: 'Barcha mahallalar',
          }] : []),
        ]}
        onClear={() => { setDistrict(''); setMahalla('') }}
        actions={
          <>
            <SegmentedControl
              ariaLabel="Ko'rinish"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'unpaid' as const, label: "To'lanmagan", count: allEntities.length },
                { value: 'paid' as const, label: "Bugun to'langan", count: daily.data?.paidToday?.length ?? 0 },
              ]}
            />
            {tab === 'unpaid' && (
              <SegmentedControl
                ariaLabel="Guruhlash"
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { value: 'urgency' as const, label: 'Muhimlik' },
                  { value: 'mahalla' as const, label: 'Mahalla' },
                ]}
              />
            )}
          </>
        }
      >
        <MonthInput value={month} onChange={setMonth} />
      </FilterBar>

      {tab === 'unpaid' && truncated && !daily.isLoading && (
        <Banner tone="warn">
          {f.num(daily.data?.totalDebtors ?? 0)} ta qarzdordan {f.num(daily.data?.meta?.shown ?? 0)} tasi (eng katta qarzlilar) ko'rsatilmoqda.
          To'liq ro'yxat uchun <b>tuman va mahalla</b> tanlang.
        </Banner>
      )}

      {tab === 'unpaid' && (
        <Card flush>
          {daily.isLoading ? (
            <SkeletonList rows={8} />
          ) : listError ? (
            <ErrorState title={errMsg(daily.error)} onRetry={() => daily.refetch()} />
          ) : sections.length === 0 ? (
            <EmptyState
              tone="success"
              icon={<CheckCircle2 className="w-6 h-6" />}
              title={q ? 'Qidiruvga mos tashkilot topilmadi' : `${f.monthLabel(month)} uchun qarzdor yo'q`}
              hint={q ? "Boshqa nom yoki manzil bilan urinib ko'ring." : "Ro'yxat muvaffaqiyatli yuklandi va qarzdor tashkilot topilmadi."}
              action={q ? <Button onClick={() => setSearch('')}>Qidiruvni tozalash</Button> : undefined}
            />
          ) : (
            <>
              {sections.map(sec => (
                <div key={sec.key}>
                  <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2 bg-eko-surface-2 border-b border-eko-line eko-text-xs text-eko-muted">
                    <span>
                      <span className="font-medium text-eko-text-2">{sec.title}</span>
                      {sec.hint && <> · {sec.hint}</>} · {f.num(sec.items.length)} ta
                    </span>
                    <span className="eko-num">{f.num(sum(sec.items))} so'm</span>
                  </div>
                  {sec.items.map(e => (
                    <DebtorRow
                      key={e.id}
                      entity={e}
                      level={urgencyOf(e)}
                      showMahalla={groupBy === 'urgency'}
                      readOnly={readOnly}
                      promise={promises.data?.[e.id]}
                      onPay={() => openPay(e)}
                      onPreview={() => setPreviewId(e.id)}
                      onAkt={() => navigate(`/ekohisob/akt/${e.id}`)}
                    />
                  ))}
                </div>
              ))}
              <div className="flex items-center justify-between px-4 sm:px-5 py-2.5 border-t border-eko-line eko-text-xs text-eko-muted">
                <span>{f.num(allEntities.length)} ta tashkilot</span>
                <span className="eko-num">Ro'yxat bo'yicha qarz: {f.num(sum(allEntities))} so'm</span>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === 'paid' && (
        <Card flush>
          {daily.isLoading ? (
            <SkeletonList rows={4} />
          ) : listError ? (
            <ErrorState title={errMsg(daily.error)} onRetry={() => daily.refetch()} />
          ) : (daily.data?.paidToday ?? []).length === 0 ? (
            <EmptyState title="Bugun hali to'lov qayd etilmagan" hint="To'lov qabul qilinganda shu yerda ko'rinadi." />
          ) : (
            (daily.data?.paidToday ?? []).map((e, i) => (
              <div key={`${e.id}-${i}`} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-eko-line last:border-b-0">
                <CheckCircle2 className="w-4 h-4 text-eko-success shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="eko-text-base font-medium text-eko-text truncate">{e.name}</p>
                  <p className="eko-text-xs text-eko-muted truncate">{e.address}</p>
                </div>
                <span className="eko-text-base font-semibold eko-num text-eko-text shrink-0">{f.num(e.monthlyFee)} <span className="text-eko-muted font-normal">so'm</span></span>
              </div>
            ))
          )}
        </Card>
      )}

      {payFor && (
        <PaymentModal
          entity={payFor}
          onClose={() => setPayFor(null)}
          onSuccess={refetchAll}
        />
      )}

      {previewId && (
        <EntityCardModal
          entityId={previewId}
          readOnly={readOnly}
          onClose={() => setPreviewId(null)}
          onChanged={refetchAll}
          actions={{
            onPay: (e: any) => { setPreviewId(null); openPay({ ...e, unpaidMonths: allEntities.find(x => x.id === e.id)?.unpaidMonths ?? [] }) },
            onAkt: (id: string) => navigate(`/ekohisob/akt/${id}`),
            // Qolgan amallar Tashkilotlar sahifasida (u yerda tegishli oynalar bor)
            onLedger: () => navigate('/ekohisob/entities'),
            onTalons: () => navigate('/ekohisob/entities'),
            onProof: () => navigate('/ekohisob/entities'),
            onSms: () => navigate('/ekohisob/entities'),
            onBlacklist: () => navigate('/ekohisob/entities'),
            onPickLocation: () => navigate('/ekohisob/entities'),
          }}
        />
      )}
    </Page>
  )
}

function sum(list: { debtAmount: number }[]): number {
  return list.reduce((s, e) => s + (e.debtAmount || 0), 0)
}
