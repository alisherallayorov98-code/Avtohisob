import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Send, Search } from 'lucide-react'
import ekoApi from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { useDistricts } from '../lib/queries'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import { useAuthStore } from '../../../stores/authStore'
import {
  Banner, Button, Card, EmptyState, ErrorState, InputWithIcon, Page, PageHeader, Select, SkeletonList,
  StatRow, StatTile, Tabs, f as fmt,
} from '../ui'
import FindingCard from '../components/robot/FindingCard'
import { VerdictModal, DismissModal, AssignModal } from '../components/robot/RobotModals'
import TasksPanel from '../components/robot/TasksPanel'
import { VerdictsPanel, DismissalsPanel } from '../components/robot/JournalPanel'
import type { Category, Finding, InsightsData, Severity, Confidence } from '../components/robot/types'
import { CATEGORY_LABEL } from '../components/robot/types'
import EntityCardModal from '../components/EntityCardModal'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'
import EntityLedgerModal from '../components/EntityLedgerModal'
import TalonModal from '../components/TalonModal'
import ServiceProofModal from '../components/ServiceProofModal'

type Tab = 'questions' | 'tasks' | 'verdicts' | 'hidden'
const CAT_ORDER: Category[] = ['money', 'collection', 'data', 'system', 'staff']

/**
 * Robot yordamchi: tizim o'zi tahlil qilib kamchiliklarni savol ko'rinishida ko'rsatadi.
 * Har savol — nima, nega (manba) va nima qilish kerak. Admin hukm chiqaradi va yashiradi;
 * robot "auto" savollarni tuman inspektoriga o'zi yuboradi va natijani tekshiradi.
 */
export default function RobotPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ekoUser = useEkoAuthStore(s => s.user)
  const mainUser = useAuthStore(s => s.user)
  const isAdmin = ekoUser?.role === 'admin' || mainUser?.role === 'admin' || mainUser?.role === 'super_admin'
  const isSupervisor = !isAdmin && ekoUser?.role === 'supervisor'
  const isInspector = !isAdmin && !isSupervisor
  const readOnly = isSupervisor

  const [tab, setTab] = useState<Tab>('questions')
  const [cat, setCat] = useState<Category | ''>('')
  const [sev, setSev] = useState<Severity | ''>('')
  const [conf, setConf] = useState<Confidence | ''>('')
  const [districtId, setDistrictId] = useState('')
  const [search, setSearch] = useState('')
  const freshRef = useRef(false)
  const [running, setRunning] = useState(false)

  const [verdictFor, setVerdictFor] = useState<Finding | null>(null)
  const [dismissFor, setDismissFor] = useState<{ f: Finding; mode: 'one30' | 'one' | 'rule' } | null>(null)
  const [assignFor, setAssignFor] = useState<Finding | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  const [payEntity, setPayEntity] = useState<EntityBasic | null>(null)
  const [ledger, setLedger] = useState<{ id: string; name: string } | null>(null)
  const [talons, setTalons] = useState<{ id: string; name: string; cubicPrice?: number } | null>(null)
  const [proof, setProof] = useState<{ id: string; name: string; hasLocation: boolean } | null>(null)

  const districts = useDistricts()
  const q = useQuery<InsightsData>({
    queryKey: ['eko', 'insights', 'list'],
    queryFn: async () => {
      const params = freshRef.current ? { fresh: 1 } : undefined
      freshRef.current = false
      return (await ekoApi.get('/insights', { params })).data.data
    },
    staleTime: 60_000,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['eko', 'insights'] })
  const refetchFresh = () => { freshRef.current = true; q.refetch() }

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data?.findings ?? []).filter(x =>
      (!cat || x.category === cat) && (!sev || x.severity === sev) && (!conf || (x.confidence ?? 'fact') === conf) &&
      (!districtId || x.districtId === districtId) &&
      (!s || x.title.toLowerCase().includes(s) || (x.entityName ?? '').toLowerCase().includes(s)))
  }, [q.data, cat, sev, conf, districtId, search])

  const impact = list.reduce((sum, x) => sum + (x.impactUzs || 0), 0)
  const counts = q.data?.counts
  const visibleCats = CAT_ORDER.filter(c => (counts?.byCategory[c] ?? 0) > 0)

  async function runTriage() {
    setRunning(true)
    try {
      const r = (await ekoApi.post('/insights/run-triage')).data.data
      toast.success(`${r.created} ta yangi topshiriq, ${r.verified} tasi tekshirildi${r.notified ? `, ${r.notified} xodimga xabar` : ''}` +
        (r.skippedNoInspector ? ` · ${r.skippedNoInspector} ta savol uchun inspektor topilmadi/limit` : ''))
      refetchFresh()
      refresh()
    } catch (e) { toast.error(errMsg(e)) } finally { setRunning(false) }
  }

  const tabs = [
    { value: 'questions' as Tab, label: 'Savollar', count: counts?.total },
    { value: 'tasks' as Tab, label: isInspector ? 'Menga berilgan' : 'Topshiriqlar' },
    ...(isAdmin ? [{ value: 'verdicts' as Tab, label: 'Hukmlar' }, { value: 'hidden' as Tab, label: 'Yashirilgan', count: q.data?.hidden || undefined }] : []),
  ]

  return (
    <Page>
      <PageHeader
        title="Robot yordamchi"
        subtitle={isInspector
          ? "Sizning tumaningizdagi qarzdorlar va to'ldirilmagan ma'lumotlar bo'yicha savollar"
          : "Tizim o'zi tahlil qilib, kamchiliklarni savol ko'rinishida ko'rsatadi"}
        meta={{ updatedAt: q.data?.generatedAt, onRefresh: refetchFresh, refreshing: q.isFetching }}
        actions={isAdmin && (
          <Button variant="primary" loading={running} onClick={runTriage} icon={<Send className="w-4 h-4" aria-hidden />}>
            Inspektorlarga hozir yuborish
          </Button>
        )}
      />

      <Tabs value={tab} onChange={setTab} items={tabs} idPrefix="robot" ariaLabel="Robot bo'limlari" />

      {tab === 'questions' && (
        <div role="tabpanel" aria-labelledby={`robot-${tab}`} className="space-y-4">
          {isAdmin && (
            <Banner tone="info">
              Robot har kuni 10:20 da qarz undirish va ma'lumot savollarini tuman inspektorlariga o'zi yuboradi (kuniga 10 tagacha, muddat 3 kun).
              Pul nazorati va xodimlar bo'yicha savollar faqat sizga — qarorni siz chiqarasiz.
            </Banner>
          )}

          <Card flush>
            <StatRow cols={4}>
              <StatTile label="Muhim" value={fmt.num(counts?.critical)} tone={counts?.critical ? 'danger' : 'neutral'} loading={q.isLoading}
                onClick={() => setSev(sev === 'critical' ? '' : 'critical')} active={sev === 'critical'} />
              <StatTile label="Diqqat" value={fmt.num(counts?.warning)} tone={counts?.warning ? 'warn' : 'neutral'} loading={q.isLoading}
                onClick={() => setSev(sev === 'warning' ? '' : 'warning')} active={sev === 'warning'} />
              <StatTile label="Ma'lumot" value={fmt.num(counts?.info)} loading={q.isLoading}
                onClick={() => setSev(sev === 'info' ? '' : 'info')} active={sev === 'info'} />
              <StatTile label="Pul ta'siri (tanlangan)" value={fmt.moneyShort(impact)} loading={q.isLoading} />
            </StatRow>
          </Card>

          <div className="flex flex-wrap gap-2 items-center">
            <InputWithIcon
              icon={<Search className="w-4 h-4" />}
              placeholder="Tashkilot yoki savol bo'yicha qidirish"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-72"
              aria-label="Qidirish"
            />
            <Select value={cat} onChange={e => setCat(e.target.value as Category | '')} aria-label="Mavzu" className="w-full sm:w-auto">
              <option value="">Barcha mavzular</option>
              {visibleCats.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]} ({counts?.byCategory[c]})</option>)}
            </Select>
            <Select value={conf} onChange={e => setConf(e.target.value as Confidence | '')} aria-label="Ishonch" className="w-full sm:w-auto">
              <option value="">Har qanday ishonch</option>
              <option value="fact">Fakt</option>
              <option value="strong">Kuchli dalil</option>
              <option value="guess">Taxmin</option>
            </Select>
            {(districts.data?.length ?? 0) > 1 && (
              <Select value={districtId} onChange={e => setDistrictId(e.target.value)} aria-label="Tuman" className="w-full sm:w-auto">
                <option value="">Barcha tumanlar</option>
                {districts.data!.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
          </div>

          {q.data?.ruleErrors?.length ? (
            <Banner tone="warn">{q.data.ruleErrors.length} ta tekshiruv xato bilan tugadi — qolganlari ko'rsatilmoqda.</Banner>
          ) : null}

          {q.isLoading ? <SkeletonList rows={5} /> : q.isError ? (
            <Card><ErrorState hint={errMsg(q.error)} onRetry={() => q.refetch()} /></Card>
          ) : list.length === 0 ? (
            <Card>
              <EmptyState
                tone="success"
                title={(q.data?.findings.length ?? 0) === 0 ? "Hammasi joyida — savol yo'q" : "Tanlangan filtr bo'yicha savol yo'q"}
                hint={(q.data?.findings.length ?? 0) === 0 ? 'Robot yangi kamchilik topsa, shu yerda ko\'rsatadi.' : undefined}
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {list.map(x => (
                <FindingCard
                  key={x.fingerprint}
                  finding={x}
                  isAdmin={isAdmin}
                  onOpenEntity={setCardId}
                  onNavigate={path => navigate(path)}
                  onVerdict={setVerdictFor}
                  onDismiss={(f, mode) => setDismissFor({ f, mode })}
                  onAssign={setAssignFor}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div role="tabpanel" aria-labelledby={`robot-${tab}`}>
          <TasksPanel isAdmin={isAdmin} isInspector={isInspector} onOpenEntity={setCardId} />
        </div>
      )}
      {tab === 'verdicts' && isAdmin && <div role="tabpanel" aria-labelledby={`robot-${tab}`}><VerdictsPanel /></div>}
      {tab === 'hidden' && isAdmin && <div role="tabpanel" aria-labelledby={`robot-${tab}`}><DismissalsPanel /></div>}

      {verdictFor && <VerdictModal finding={verdictFor} onClose={() => setVerdictFor(null)} onDone={() => { setVerdictFor(null); refresh() }} />}
      {dismissFor && <DismissModal finding={dismissFor.f} mode={dismissFor.mode} onClose={() => setDismissFor(null)} onDone={() => { setDismissFor(null); refresh() }} />}
      {assignFor && <AssignModal finding={assignFor} onClose={() => setAssignFor(null)} onDone={() => { setAssignFor(null); refresh() }} />}

      {cardId && (
        <EntityCardModal
          key={cardId}
          entityId={cardId}
          readOnly={readOnly}
          isAdmin={isAdmin}
          onClose={() => setCardId(null)}
          onChanged={refresh}
          actions={{
            onPay: e => { setCardId(null); setPayEntity({ id: e.id, name: e.name, address: e.address ?? '', monthlyFee: e.monthlyFee, billingMode: e.billingMode }) },
            onLedger: e => { setCardId(null); setLedger({ id: e.id, name: e.name }) },
            onTalons: e => { setCardId(null); setTalons({ id: e.id, name: e.name, cubicPrice: (e as { cubicPrice?: number }).cubicPrice }) },
            onProof: e => { setCardId(null); setProof({ id: e.id, name: e.name, hasLocation: Boolean(e.lat && e.lon) }) },
            onSms: () => { setCardId(null); toast("SMS yuborish — Tashkilotlar bo'limidan"); navigate('/ekohisob/entities') },
            onBlacklist: () => { setCardId(null); navigate('/ekohisob/entities') },
            onPickLocation: () => { setCardId(null); navigate('/ekohisob/map') },
            onAkt: id => navigate(`/ekohisob/akt/${id}`),
          }}
        />
      )}
      {payEntity && <PaymentModal entity={payEntity} onClose={() => setPayEntity(null)} onSuccess={refresh} />}
      {ledger && (
        <EntityLedgerModal entityId={ledger.id} entityName={ledger.name} isAdmin={isAdmin} readOnly={readOnly}
          onClose={() => setLedger(null)} onAddPayment={() => setLedger(null)} />
      )}
      {talons && <TalonModal entity={talons} readOnly={readOnly} onClose={() => setTalons(null)} />}
      {proof && <ServiceProofModal entityId={proof.id} entityName={proof.name} hasLocation={proof.hasLocation} onClose={() => setProof(null)} />}
    </Page>
  )
}
