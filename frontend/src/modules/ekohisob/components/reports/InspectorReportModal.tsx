import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { FileSpreadsheet, UserRound, Target, Wallet, Building2, CalendarCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import {
  Modal, Button, Badge, Banner, EmptyState, SkeletonList, cx, f,
} from '../../ui'

interface InspectorReport {
  inspector: {
    id: string; fullName: string; login: string; role: string
    isActive: boolean; botLinked: boolean; districts: string[]
  }
  period: { from: string; to: string; months: number; focusMonth: string }
  kpi: {
    collected: number; paymentsCount: number; avgPayment: number
    entitiesCreated: number; activeDays: number; smsSent: number
    prevCollected: number; collectedDelta: number | null
  }
  plan: {
    daysWithPlan: number; targetTotal: number; doneOnPlanDays: number
    daysMet: number; fulfillRate: number | null
  }
  monthlyTrend: { month: string; label: string; collected: number }[]
  byDistrict: { name: string; collected: number; count: number }[]
  recentPayments: {
    id: string; entityName: string; district: string | null
    month: string; amount: number; paidAt: string; receiptNumber: string | null
  }[]
}

/**
 * Bitta inspektor bo'yicha batafsil hisobot.
 *
 * Kirish huquqi backendda: admin — hammasi, boshliq — o'z tumanlari,
 * inspektor — faqat o'zi. Bu "ochiq shaxsiy reyting yo'q" qoidasining
 * davomi: inspektor boshqa inspektorning natijasini ko'ra olmaydi.
 */
export default function InspectorReportModal({
  inspectorId, inspectorName, query, onClose,
}: {
  inspectorId: string
  inspectorName: string
  /** Hisobot davri query satri (`from=...&to=...`) */
  query: string
  onClose: () => void
}) {
  const [data, setData] = useState<InspectorReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    ekoApi.get(`/reports/inspector/${inspectorId}?${query}`)
      .then(res => setData(res.data.data))
      .catch(e => { setData(null); setError(e.response?.data?.error || 'Hisobotni yuklab bo\'lmadi') })
      .finally(() => setLoading(false))
  }, [inspectorId, query])

  async function exportXlsx() {
    setBusy(true)
    try {
      const res = await ekoApi.get(`/reports/inspector/${inspectorId}/export.xlsx?${query}`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `inspektor_${inspectorName.slice(0, 30)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Excel yuklab olishda xato')
    } finally { setBusy(false) }
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      icon={<UserRound className="w-5 h-5" />}
      title={inspectorName}
      hint={data
        ? `${f.monthLabel(data.period.from)} — ${f.monthLabel(data.period.to)}`
        : 'Inspektor hisoboti'}
      footer={
        <Button
          variant="secondary" className="flex-1" loading={busy} disabled={!data}
          icon={<FileSpreadsheet className="w-4 h-4" />} onClick={exportXlsx}
        >
          Excel yuklab olish
        </Button>
      }
    >
      <div className="px-5 py-4 space-y-4">
        {loading ? (
          <SkeletonList rows={5} />
        ) : error || !data ? (
          <EmptyState title="Hisobot ochilmadi" hint={error ?? undefined} />
        ) : (
          <>
            {/* Xodim pasporti */}
            <div className="flex flex-wrap items-center gap-2">
              {data.inspector.districts.map(d => (
                <Badge key={d} tone="neutral">{d}</Badge>
              ))}
              {!data.inspector.isActive && <Badge tone="danger">Nofaol</Badge>}
              <Badge tone={data.inspector.botLinked ? 'success' : 'neutral'}>
                {data.inspector.botLinked ? 'Bot ulangan' : 'Bot ulanmagan'}
              </Badge>
            </div>

            {/* KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric
                label="Yig'ilgan" value={f.moneyShort(data.kpi.collected)} unit="so'm"
                tone="accent" icon={<Wallet className="w-3.5 h-3.5" />}
                delta={data.kpi.collectedDelta}
              />
              <Metric label="To'lovlar" value={f.num(data.kpi.paymentsCount)} unit="ta" />
              <Metric
                label="Faol kunlar" value={f.num(data.kpi.activeDays)} unit="kun"
                icon={<CalendarCheck className="w-3.5 h-3.5" />}
              />
              <Metric
                label="Kiritgan" value={f.num(data.kpi.entitiesCreated)} unit="ta"
                icon={<Building2 className="w-3.5 h-3.5" />}
              />
            </div>

            <p className="text-xs text-eko-muted">
              O'rtacha to'lov: <b className="text-eko-text-2 eko-num">{f.money(data.kpi.avgPayment)}</b>
              {data.kpi.smsSent > 0 && <> · {data.kpi.smsSent} ta SMS yuborgan</>}
            </p>

            {/* Plan bajarilishi */}
            {data.plan.daysWithPlan > 0 ? (
              <div className="rounded-eko-lg border border-eko-line p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-eko-text flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-eko-muted" /> Plan bajarilishi
                  </span>
                  <span className={cx('text-sm font-semibold eko-num',
                    (data.plan.fulfillRate ?? 0) >= 100 ? 'text-eko-success'
                      : (data.plan.fulfillRate ?? 0) >= 70 ? 'text-eko-warn' : 'text-eko-danger')}>
                    {data.plan.fulfillRate == null ? '—' : `${data.plan.fulfillRate}%`}
                  </span>
                </div>
                <div className="w-full bg-eko-surface-2 rounded-full h-2">
                  <div
                    className={cx('h-2 rounded-full',
                      (data.plan.fulfillRate ?? 0) >= 100 ? 'bg-eko-success'
                        : (data.plan.fulfillRate ?? 0) >= 70 ? 'bg-eko-warn' : 'bg-eko-danger')}
                    style={{ width: `${Math.min(100, data.plan.fulfillRate ?? 0)}%` }}
                  />
                </div>
                <p className="text-[11px] text-eko-muted mt-1.5">
                  {data.plan.daysWithPlan} kun plan berilgan · maqsad {f.num(data.plan.targetTotal)} ta ·
                  kiritilgan {f.num(data.plan.doneOnPlanDays)} ta · {data.plan.daysMet} kun maqsadga yetgan
                </p>
              </div>
            ) : (
              <Banner tone="info">
                Bu davrda plan berilmagan — bajarilish foizini hisoblab bo'lmaydi.
              </Banner>
            )}

            {/* Oylik dinamika */}
            {data.monthlyTrend.length > 1 && (
              <div>
                <p className="text-xs font-medium text-eko-muted uppercase tracking-wide mb-2">
                  Oylik yig'im
                </p>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={data.monthlyTrend} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v)}
                    />
                    <Tooltip
                      cursor={{ fill: '#f1f5f9' }}
                      formatter={(v: any) => [f.money(Number(v)), "Yig'ilgan"]}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                    />
                    <Bar dataKey="collected" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Tuman kesimi */}
            {data.byDistrict.length > 0 && (
              <div>
                <p className="text-xs font-medium text-eko-muted uppercase tracking-wide mb-2">
                  Qayerda ishlagan
                </p>
                <div className="space-y-1.5">
                  {data.byDistrict.map(d => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <span className="text-eko-text-2 truncate">{d.name}</span>
                      <span className="text-eko-muted shrink-0 eko-num">
                        {d.count} to'lov · <b className="text-eko-text">{f.moneyShort(d.collected)}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Oxirgi to'lovlar */}
            {data.recentPayments.length > 0 && (
              <div>
                <p className="text-xs font-medium text-eko-muted uppercase tracking-wide mb-2">
                  Oxirgi to'lovlar
                </p>
                <div className="divide-y divide-eko-line border-t border-eko-line">
                  {data.recentPayments.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[13px] text-eko-text truncate">{p.entityName}</p>
                        <p className="text-[11px] text-eko-muted truncate">
                          {f.date(p.paidAt)} · {f.monthLabel(p.month)}
                          {p.receiptNumber && ` · ${p.receiptNumber}`}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-eko-success eko-num shrink-0">
                        {f.num(p.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function Metric({
  label, value, unit, tone = 'neutral', icon, delta,
}: {
  label: string
  value: string
  unit?: string
  tone?: 'neutral' | 'accent'
  icon?: React.ReactNode
  delta?: number | null
}) {
  return (
    <div className="rounded-eko border border-eko-line px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-eko-muted flex items-center gap-1 truncate">
        {icon}{label}
      </p>
      <p className={cx('text-base font-semibold eko-num mt-0.5',
        tone === 'accent' ? 'text-eko-accent-text' : 'text-eko-text')}>
        {value}
        {unit && <span className="text-[11px] font-normal text-eko-muted ml-1">{unit}</span>}
      </p>
      {delta != null && (
        <p className={cx('text-[11px] font-medium', delta >= 0 ? 'text-eko-success' : 'text-eko-danger')}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% oldingi davrga nisbatan
        </p>
      )}
    </div>
  )
}
