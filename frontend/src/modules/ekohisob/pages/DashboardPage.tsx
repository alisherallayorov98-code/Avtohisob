import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, CheckCircle2, Wallet, ChevronDown, ChevronRight, RefreshCw,
  CalendarPlus, MapPin, Users, ArrowRight, Rocket, Search, TrendingDown, Coins,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'
import ReconciliationModal from '../components/ReconciliationModal'
import {
  Page, PageHeader, Toolbar, SegmentedControl, Card, Button, Badge, BillingBadge,
  DebtDot, StatRow, StatTile, EmptyState, SkeletonList, Banner, Select,
  InputWithIcon, useConfirm, cx, f,
} from '../ui'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface Stats {
  totalEntities: number
  paidThisMonth: number
  unpaidThisMonth: number
  collectedAmount: number
  totalDebt?: number
}

interface Entity {
  id: string
  name: string
  address: string
  monthlyFee: number
  cubicPrice?: number
  billingMode?: 'monthly_fixed' | 'variable' | 'talon'
  unpaidMonths: string[]
  debtAmount: number
}

interface MahallaGroup {
  mahallId: string
  mahallName: string
  entities: Entity[]
}

interface District { id: string; name: string }
interface Mahalla { id: string; name: string; districtId: string }
interface OnboardingStatus {
  districts: number; mahallas: number; inspectors: number; entities: number
}

// ── Muhimlik darajasi ────────────────────────────────────────────────────────
// Qarzdor oylar sonidan chiqariladi — backend'dagi computeDebtLevel bilan bir xil.
// Inspektorning asosiy savoli "kimga birinchi borishim kerak?" — javob shu.
type Urgency = 'critical' | 'overdue' | 'warning'

function urgencyOf(e: Entity): Urgency {
  const n = e.unpaidMonths?.length ?? 0
  if (n >= 3) return 'critical'
  if (n === 2) return 'overdue'
  return 'warning'
}

const URGENCY_META: Record<Urgency, { title: string; hint: string; level: string }> = {
  critical: { title: 'Kritik',        hint: '3 oy va undan ko\'p', level: 'critical' },
  overdue:  { title: 'Muddati o\'tgan', hint: '2 oy',              level: 'overdue' },
  warning:  { title: 'Yangi qarz',    hint: '1 oy',                level: 'warning' },
}

type GroupBy = 'urgency' | 'mahalla'

export default function DashboardPage({ readOnly = false, isAdmin = false }: { readOnly?: boolean; isAdmin?: boolean }) {
  const navigate = useNavigate()
  const confirm = useConfirm()

  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [groups, setGroups] = useState<MahallaGroup[]>([])
  const [truncated, setTruncated] = useState<{ shown: number; total: number } | null>(null)
  const [paidToday, setPaidToday] = useState<Entity[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [mahallas, setMahallas] = useState<Mahalla[]>([])
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [selectedMahalla, setSelectedMahalla] = useState('')
  const [month, setMonth] = useState(currentMonth())
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [paymentEntity, setPaymentEntity] = useState<EntityBasic | null>(null)
  // Tashkilot nomiga bosilganda akt sverka ochiladi
  const [reconEntity, setReconEntity] = useState<{ id: string; name: string } | null>(null)
  const [tab, setTab] = useState<'unpaid' | 'paid'>('unpaid')
  const [groupBy, setGroupBy] = useState<GroupBy>('urgency')
  const [generating, setGenerating] = useState(false)
  const [search, setSearch] = useState('')

  // ── Ma'lumot yuklash ───────────────────────────────────────────────────────
  useEffect(() => {
    ekoApi.get('/districts')
      .then(res => setDistricts(res.data.data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    ekoApi.get('/dashboard/onboarding')
      .then(res => setOnboarding(res.data.data ?? null))
      .catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    if (!selectedDistrict) { setMahallas([]); setSelectedMahalla(''); return }
    ekoApi.get(`/mahallas?districtId=${selectedDistrict}`)
      .then(res => { setMahallas(res.data.data ?? []); setSelectedMahalla('') })
      .catch(() => {})
  }, [selectedDistrict])

  const fetchStats = useCallback(() => {
    setStatsLoading(true)
    ekoApi.get(`/dashboard/stats?districtId=${selectedDistrict}`)
      .then(res => setStats(res.data.data ?? null))
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [selectedDistrict])

  const fetchDaily = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedDistrict) params.set('districtId', selectedDistrict)
    if (selectedMahalla) params.set('mahallId', selectedMahalla)
    params.set('month', month)
    ekoApi.get(`/dashboard/daily?${params}`)
      .then(res => {
        const data = res.data.data ?? res.data
        setGroups(data.groups ?? [])
        setPaidToday(data.paidToday ?? [])
        const meta = res.data.meta
        setTruncated(meta?.truncated
          ? { shown: meta.shown ?? 0, total: data.totalDebtors ?? meta.shown ?? 0 }
          : null)
      })
      .catch(() => { setGroups([]); setPaidToday([]); setTruncated(null) })
      .finally(() => setLoading(false))
  }, [selectedDistrict, selectedMahalla, month])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { fetchDaily() }, [fetchDaily])

  async function handleGenerateCharges() {
    const ok = await confirm({
      title: 'Hisoblarni yaratish',
      message: <>
        <b>{f.monthLabel(month)}</b> uchun barcha belgilangan-oylik tashkilotlarga
        avtomatik hisob yaratiladi.
      </>,
      consequences: ['Allaqachon hisob bor tashkilotlarga takror yaratilmaydi'],
      confirmLabel: 'Yaratish',
    })
    if (!ok) return
    setGenerating(true)
    try {
      const res = await ekoApi.post('/charges/generate', { month })
      toast.success(`${res.data.data?.created ?? 0} ta hisob yaratildi`)
      fetchStats(); fetchDaily()
    } catch {
      toast.error('Hisoblarni yaratishda xato')
    } finally { setGenerating(false) }
  }

  // ── Ro'yxatni tayyorlash ───────────────────────────────────────────────────
  // Backend mahalla bo'yicha guruhlab beradi. Bu yerda qidiruv qo'llanadi va
  // foydalanuvchi tanlagan guruhlash bo'yicha qayta yig'iladi.
  const allEntities = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out: (Entity & { mahallName: string })[] = []
    for (const g of groups) {
      for (const e of g.entities) {
        if (q && !e.name.toLowerCase().includes(q) && !(e.address ?? '').toLowerCase().includes(q)) continue
        out.push({ ...e, mahallName: g.mahallName })
      }
    }
    return out
  }, [groups, search])

  const displayGroups = useMemo(() => {
    if (groupBy === 'mahalla') {
      const byMahalla = new Map<string, (Entity & { mahallName: string })[]>()
      for (const e of allEntities) {
        const list = byMahalla.get(e.mahallName) ?? []
        list.push(e)
        byMahalla.set(e.mahallName, list)
      }
      return Array.from(byMahalla.entries())
        .map(([key, items]) => ({
          key,
          title: key,
          hint: undefined as string | undefined,
          level: undefined as string | undefined,
          // Eng katta qarzdor birinchi — inspektor kimdan boshlashini biladi
          items: items.sort((a, b) => b.debtAmount - a.debtAmount),
        }))
        // Guruhlar ham qarz og'irligi bo'yicha
        .sort((a, b) => sumDebt(b.items) - sumDebt(a.items))
    }

    const order: Urgency[] = ['critical', 'overdue', 'warning']
    return order
      .map(u => {
        const items = allEntities.filter(e => urgencyOf(e) === u).sort((a, b) => b.debtAmount - a.debtAmount)
        const meta = URGENCY_META[u]
        return { key: u, title: meta.title, hint: meta.hint, level: meta.level, items }
      })
      .filter(g => g.items.length > 0)
  }, [allEntities, groupBy])

  const shownDebt = sumDebt(allEntities)

  // ── Onboarding ─────────────────────────────────────────────────────────────
  const onboardingDone = onboarding && onboarding.districts > 0 && onboarding.inspectors > 0 && onboarding.entities > 0
  const onboardingSteps = onboarding ? [
    { done: onboarding.districts > 0,  label: 'Tuman qo\'shing',      desc: 'Xizmat ko\'rsatadigan tumanlar', to: '/ekohisob/admin/districts', icon: MapPin },
    { done: onboarding.inspectors > 0, label: 'Inspektor qo\'shing',  desc: 'To\'lov yig\'adigan dala xodimlari', to: '/ekohisob/admin/users', icon: Users },
    { done: onboarding.entities > 0,   label: 'Tashkilot qo\'shing',  desc: 'Abonentlar', to: '/ekohisob/entities', icon: Building2 },
  ] : []

  return (
    <Page>
      <PageHeader
        title="Bugungi ish"
        subtitle={`${f.monthLabel(month)} · qarzdorlar ro'yxati`}
        actions={
          <>
            <Button
              variant="secondary" size="sm"
              icon={<RefreshCw className={cx('w-4 h-4', loading && 'animate-spin')} />}
              onClick={() => { fetchStats(); fetchDaily() }}
            >
              Yangilash
            </Button>
            {isAdmin && (
              <Button
                variant="secondary" size="sm" loading={generating}
                icon={<CalendarPlus className="w-4 h-4" />}
                onClick={handleGenerateCharges}
                title="Belgilangan-oylik tashkilotlarga shu oy uchun hisob yaratadi"
              >
                Hisoblarni yarat
              </Button>
            )}
          </>
        }
      />

      {/* Sozlash cheklisti — admin, sozlash tugamaguncha */}
      {isAdmin && onboarding && !onboardingDone && (
        <Card className="border-eko-accent-line bg-eko-accent-soft">
          <div className="flex items-center gap-2 mb-1">
            <Rocket className="w-4 h-4 text-eko-accent" />
            <h3 className="text-sm font-semibold text-eko-text">EkoHisob'ni sozlash</h3>
          </div>
          <p className="text-xs text-eko-muted mb-3">Tizimni ishga tushirish uchun 3 qadam:</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {onboardingSteps.map((step, i) => (
              <button
                key={step.label}
                onClick={() => navigate(step.to)}
                className={cx(
                  'flex items-center gap-2.5 p-3 rounded-eko border text-left transition-colors',
                  step.done
                    ? 'bg-eko-surface/60 border-eko-accent-line'
                    : 'bg-eko-surface border-eko-line hover:border-eko-accent',
                )}
              >
                {step.done
                  ? <CheckCircle2 className="w-4 h-4 text-eko-accent shrink-0" />
                  : <span className="w-4 h-4 rounded-full border-2 border-eko-line-strong shrink-0 text-[10px] leading-3 text-eko-subtle flex items-center justify-center">{i + 1}</span>}
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium text-eko-text truncate">{step.label}</span>
                  <span className="block text-[11px] text-eko-muted truncate">{step.desc}</span>
                </span>
                {!step.done && <ArrowRight className="w-3.5 h-3.5 text-eko-subtle shrink-0" />}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* KPI — raqamlar to'liq bazadan (ro'yxat kesilgan bo'lsa ham to'g'ri) */}
      <StatRow>
        <StatTile
          loading={statsLoading}
          label="Qarzdor"
          value={f.num(stats?.unpaidThisMonth ?? 0)}
          unit="ta"
          tone={(stats?.unpaidThisMonth ?? 0) > 0 ? 'danger' : 'neutral'}
          icon={<TrendingDown className="w-4 h-4" />}
        />
        <StatTile
          loading={statsLoading}
          label="Jami qarz"
          value={f.moneyShort(stats?.totalDebt ?? 0)}
          unit="so'm"
          tone="warn"
          icon={<Coins className="w-4 h-4" />}
          hint={stats?.totalDebt ? f.num(stats.totalDebt) : undefined}
        />
        <StatTile
          loading={statsLoading}
          label="Bu oy yig'ildi"
          value={f.moneyShort(stats?.collectedAmount ?? 0)}
          unit="so'm"
          tone="accent"
          icon={<Wallet className="w-4 h-4" />}
        />
        <StatTile
          loading={statsLoading}
          label="To'lagan"
          value={f.num(stats?.paidThisMonth ?? 0)}
          unit={`/ ${f.num(stats?.totalEntities ?? 0)}`}
          icon={<CheckCircle2 className="w-4 h-4" />}
          hint={stats?.totalEntities
            ? `${Math.round((stats.paidThisMonth / stats.totalEntities) * 100)}% tashkilot`
            : undefined}
        />
      </StatRow>

      {/* Filtrlar */}
      <Toolbar>
        <InputWithIcon
          icon={<Search className="w-4 h-4" />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Nom yoki manzil..."
          className="flex-1 min-w-[180px]"
        />
        <Select
          value={selectedDistrict}
          onChange={e => setSelectedDistrict(e.target.value)}
          className="w-auto min-w-[140px]"
        >
          <option value="">Barcha tumanlar</option>
          {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        {selectedDistrict && mahallas.length > 0 && (
          <Select
            value={selectedMahalla}
            onChange={e => setSelectedMahalla(e.target.value)}
            className="w-auto min-w-[140px]"
          >
            <option value="">Barcha mahallalar</option>
            {mahallas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        )}
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="h-10 px-3 rounded-eko border border-eko-line bg-eko-surface text-sm text-eko-text"
        />
      </Toolbar>

      {/* Ko'rinish tanlash */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: 'unpaid' as const, label: "To'lanmagan", count: allEntities.length },
            { value: 'paid' as const, label: 'Bugun to\'langan', count: paidToday.length },
          ]}
        />
        {tab === 'unpaid' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-eko-muted hidden sm:inline">Guruhlash:</span>
            <SegmentedControl
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'urgency' as const, label: 'Muhimlik' },
                { value: 'mahalla' as const, label: 'Mahalla' },
              ]}
            />
          </div>
        )}
      </div>

      {tab === 'unpaid' && truncated && !loading && (
        <Banner tone="warn">
          {f.num(truncated.total)} ta qarzdordan {f.num(truncated.shown)} tasi ko'rsatilmoqda.
          To'liq ro'yxat uchun <b>tuman va mahalla</b> tanlang.
        </Banner>
      )}

      {/* ── To'lanmaganlar ── */}
      {tab === 'unpaid' && (
        loading ? (
          <Card flush><SkeletonList rows={6} /></Card>
        ) : displayGroups.length === 0 ? (
          <Card flush>
            <EmptyState
              tone="success"
              title={search.trim()
                ? 'Qidiruvga mos tashkilot topilmadi'
                : `${f.monthLabel(month)} uchun barcha to'lovlar amalga oshirilgan`}
              hint={search.trim()
                ? 'Boshqa nom yoki manzil bilan urinib ko\'ring.'
                : 'Qarzdor tashkilot qolmadi.'}
              action={search.trim()
                ? <Button variant="secondary" onClick={() => setSearch('')}>Qidiruvni tozalash</Button>
                : undefined}
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {displayGroups.map(group => {
              const isCollapsed = collapsed.has(group.key)
              const groupDebt = sumDebt(group.items)
              return (
                <Card key={group.key} flush className="overflow-hidden">
                  <button
                    onClick={() => setCollapsed(prev => {
                      const next = new Set(prev)
                      next.has(group.key) ? next.delete(group.key) : next.add(group.key)
                      return next
                    })}
                    className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-eko-surface-2 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isCollapsed
                        ? <ChevronRight className="w-4 h-4 text-eko-subtle shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-eko-subtle shrink-0" />}
                      {group.level && <DebtDot level={group.level} />}
                      <span className="text-sm font-semibold text-eko-text truncate">{group.title}</span>
                      {group.hint && <span className="text-xs text-eko-muted hidden sm:inline">· {group.hint}</span>}
                      <Badge tone="neutral">{group.items.length} ta</Badge>
                    </div>
                    <span className="text-sm font-semibold text-eko-warn eko-num shrink-0">
                      {f.moneyShort(groupDebt)}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="divide-y divide-eko-line border-t border-eko-line">
                      {group.items.map(entity => (
                        <DebtorRow
                          key={entity.id}
                          entity={entity}
                          showMahalla={groupBy === 'urgency'}
                          readOnly={readOnly}
                          onOpenRecon={() => setReconEntity({ id: entity.id, name: entity.name })}
                          onPay={() => setPaymentEntity({
                            id: entity.id, name: entity.name, address: entity.address,
                            monthlyFee: entity.monthlyFee, unpaidMonths: entity.unpaidMonths,
                          })}
                        />
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}

            {/* Ro'yxat yakuni — ko'rsatilgan qarz yig'indisi */}
            <div className="flex items-center justify-between px-1 text-xs text-eko-muted">
              <span>{allEntities.length} ta tashkilot ko'rsatildi</span>
              <span className="eko-num">Ro'yxat bo'yicha qarz: <b className="text-eko-text-2">{f.money(shownDebt)}</b></span>
            </div>
          </div>
        )
      )}

      {/* ── Bugun to'langanlar ── */}
      {tab === 'paid' && (
        loading ? (
          <Card flush><SkeletonList rows={4} /></Card>
        ) : paidToday.length === 0 ? (
          <Card flush>
            <EmptyState
              title="Bugun hali to'lov qayd etilmagan"
              hint="To'lov qabul qilinganda shu yerda ko'rinadi."
            />
          </Card>
        ) : (
          <Card flush>
            <div className="divide-y divide-eko-line">
              {paidToday.map((entity, i) => (
                <div key={`${entity.id}-${i}`} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                  <CheckCircle2 className="w-4 h-4 text-eko-success shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-eko-text truncate">{entity.name}</p>
                    <p className="text-xs text-eko-muted truncate">{entity.address}</p>
                  </div>
                  <span className="text-sm font-semibold text-eko-success eko-num shrink-0">
                    {f.money(entity.monthlyFee)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )
      )}

      {paymentEntity && (
        <PaymentModal
          entity={paymentEntity}
          onClose={() => setPaymentEntity(null)}
          onSuccess={() => { fetchStats(); fetchDaily() }}
        />
      )}

      {reconEntity && (
        <ReconciliationModal
          entityId={reconEntity.id}
          entityName={reconEntity.name}
          onClose={() => setReconEntity(null)}
        />
      )}
    </Page>
  )
}

function sumDebt(list: { debtAmount: number }[]): number {
  return list.reduce((s, e) => s + (e.debtAmount || 0), 0)
}

/**
 * Qarzdor qatori.
 *
 * Dizayn qarori: qarz SUMMASI eng katta va o'ngda turadi — inspektor ro'yxatni
 * ko'zdan kechirganda birinchi shu raqamga qaraydi. Ilgari summa nom ostidagi
 * kichik matn ichida, boshqa ma'lumotlar orasida yo'qolib ketardi.
 */
function DebtorRow({
  entity, showMahalla, readOnly, onPay, onOpenRecon,
}: {
  entity: Entity & { mahallName?: string }
  showMahalla?: boolean
  readOnly?: boolean
  onPay: () => void
  /** Nomga bosilganda akt sverka ochiladi */
  onOpenRecon: () => void
}) {
  const months = entity.unpaidMonths?.length ?? 0
  const meta = [
    entity.address,
    showMahalla ? entity.mahallName : null,
    months > 0 ? `${months} oy` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-eko-surface-2 transition-colors">
      <DebtDot level={URGENCY_META[urgencyOf(entity)].level} className="mt-0.5 shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Nom — akt sverkaga havola. Ilgari qatorda hech qanday tafsilotga
              o'tish yo'li yo'q edi. */}
          <button
            onClick={onOpenRecon}
            title="Akt sverkani ochish"
            className="text-sm font-medium text-eko-text truncate text-left hover:text-eko-accent-text hover:underline underline-offset-2 decoration-eko-accent-line"
          >
            {entity.name}
          </button>
          <BillingBadge mode={entity.billingMode} />
        </div>
        <p className="text-xs text-eko-muted truncate mt-0.5">{meta}</p>
      </div>

      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-eko-text eko-num leading-tight">
          {f.num(entity.debtAmount)}
        </p>
        <p className="text-[11px] text-eko-subtle">
          {entity.billingMode === 'talon'
            ? `${f.num(entity.cubicPrice ?? 0)}/kub`
            : entity.billingMode === 'variable'
              ? "o'zgaruvchan"
              : `${f.num(entity.monthlyFee)}/oy`}
        </p>
      </div>

      {!readOnly && (
        <Button size="sm" variant="primary" onClick={onPay} className="shrink-0">
          To'landi
        </Button>
      )}
    </div>
  )
}
