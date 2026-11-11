import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import { errMsg } from '../../lib/ekoErrors'
import {
  Modal, Button, Badge, Banner, ErrorState, SkeletonList, StatRow, StatTile, DataTable, chart, f,
} from '../../ui'

interface InspectorReport {
  inspector: {
    id: string; fullName: string; login: string; role: string
    isActive: boolean; botLinked: boolean; districts: string[]
  }
  period: { from: string; to: string; months: number; focusMonth: string }
  kpi: {
    collected: number; collectedCash?: number; paymentsCount: number; avgPayment: number
    entitiesCreated: number; activeDays: number; smsSent: number
    prevCollected: number; collectedDelta: number | null; collectedCashDelta?: number | null
  }
  plan: {
    daysWithPlan: number; targetTotal: number; doneOnPlanDays: number
    daysMet: number; fulfillRate: number | null
  }
  monthlyTrend: { month: string; label: string; collected: number; collectedCash?: number }[]
  byDistrict: { name: string; collected: number; count: number }[]
  recentPayments: {
    id: string; entityName: string; district: string | null
    month: string; amount: number; paidAt: string; receiptNumber: string | null
  }[]
}

const axisTick = { fontSize: 12, fill: chart.axis }

/**
 * Bitta inspektor bo'yicha batafsil hisobot. Kirish huquqi backendda:
 * admin — hammasi, boshliq — o'z tumanlari, inspektor — faqat o'zi.
 */
export default function InspectorReportModal({
  inspectorId, inspectorName, query, onClose,
}: {
  inspectorId: string
  inspectorName: string
  query: string
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const q = useQuery<InspectorReport>({
    queryKey: [...ekoKeys.reports, 'inspector', inspectorId, query],
    queryFn: async () => (await ekoApi.get(`/reports/inspector/${inspectorId}?${query}`)).data.data,
    staleTime: 60_000,
  })
  const data = q.data

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
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setBusy(false) }
  }

  const cash = data?.kpi.collectedCash ?? data?.kpi.collected ?? 0
  const delta = data ? (data.kpi.collectedCashDelta !== undefined ? data.kpi.collectedCashDelta : data.kpi.collectedDelta) : null
  const rate = data?.plan.fulfillRate ?? null

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={inspectorName}
      hint={data ? `${f.monthLabel(data.period.from)} — ${f.monthLabel(data.period.to)}` : 'Inspektor hisoboti'}
      footer={
        <Button variant="secondary" className="flex-1" loading={busy} disabled={!data} onClick={exportXlsx}>
          Excel yuklab olish
        </Button>
      }
    >
      <div className="px-5 py-4 space-y-5">
        {q.isLoading ? (
          <SkeletonList rows={5} />
        ) : q.isError || !data ? (
          <ErrorState title={errMsg(q.error)} onRetry={() => q.refetch()} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {data.inspector.districts.map(d => <Badge key={d} tone="neutral">{d}</Badge>)}
              {!data.inspector.isActive && <Badge tone="inactive">Nofaol</Badge>}
              <Badge tone={data.inspector.botLinked ? 'success' : 'neutral'}>
                {data.inspector.botLinked ? 'Bot ulangan' : 'Bot ulanmagan'}
              </Badge>
            </div>

            <StatRow cols={4}>
              <StatTile lead label="Kassaga tushdi" value={f.num(cash)} unit="so'm" delta={delta} deltaLabel="oldingi davrga nisbatan" />
              <StatTile label="To'lovlar" value={f.num(data.kpi.paymentsCount)} unit="ta" />
              <StatTile label="Faol kunlar" value={f.num(data.kpi.activeDays)} unit="kun" />
              <StatTile label="Kiritgan tashkilot" value={f.num(data.kpi.entitiesCreated)} unit="ta" />
            </StatRow>
            <p className="eko-text-sm text-eko-muted">
              O'rtacha to'lov: <span className="eko-num text-eko-text-2">{f.money(data.kpi.avgPayment)}</span>
              {data.kpi.smsSent > 0 && <> · {f.num(data.kpi.smsSent)} ta SMS yuborgan</>}
            </p>

            {data.plan.daysWithPlan > 0 ? (
              <section>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="eko-text-base font-medium text-eko-text">Plan bajarilishi</h3>
                  <span className="eko-text-base font-semibold eko-num">{rate == null ? '—' : `${rate}%`}</span>
                </div>
                <div className="h-1.5 mt-2 rounded-full bg-eko-surface-2 overflow-hidden">
                  <div className="h-full rounded-full bg-eko-text" style={{ width: `${Math.min(100, rate ?? 0)}%` }} />
                </div>
                <p className="eko-text-xs text-eko-muted mt-1.5">
                  {data.plan.daysWithPlan} kun plan berilgan · maqsad {f.num(data.plan.targetTotal)} ta ·
                  kiritilgan {f.num(data.plan.doneOnPlanDays)} ta · {data.plan.daysMet} kun maqsadga yetgan
                </p>
              </section>
            ) : (
              <Banner tone="info">Bu davrda plan berilmagan — bajarilish foizini hisoblab bo'lmaydi.</Banner>
            )}

            {data.monthlyTrend.length > 1 && (
              <section>
                <h3 className="eko-text-base font-medium text-eko-text mb-2">Oylik yig'im</h3>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={data.monthlyTrend.map(m => ({ ...m, v: m.collectedCash ?? m.collected }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} tickCount={4} width={56}
                      tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)} mln` : v >= 1e3 ? `${Math.round(v / 1e3)} ming` : String(v)} />
                    <Tooltip
                      cursor={{ fill: 'rgb(var(--eko-surface-2))' }}
                      formatter={(v: any) => [`${f.num(Number(v))} so'm`, 'Kassaga tushdi']}
                      contentStyle={{ background: 'rgb(var(--eko-surface))', border: '1px solid rgb(var(--eko-line))', borderRadius: 8, fontSize: 13 }}
                    />
                    <Bar dataKey="v" fill={chart.main} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>
            )}

            {data.byDistrict.length > 0 && (
              <section>
                <h3 className="eko-text-base font-medium text-eko-text mb-2">Qayerda ishlagan</h3>
                <DataTable
                  aria-label="Tuman kesimi"
                  rows={data.byDistrict}
                  rowKey={(r) => r.name}
                  columns={[
                    { key: 'name', title: 'Tuman' },
                    { key: 'count', title: "To'lovlar", align: 'right' },
                    { key: 'collected', title: "Summa, so'm", align: 'right' },
                  ]}
                />
              </section>
            )}

            {data.recentPayments.length > 0 && (
              <section>
                <h3 className="eko-text-base font-medium text-eko-text mb-2">Oxirgi to'lovlar</h3>
                <DataTable
                  aria-label="Oxirgi to'lovlar"
                  rows={data.recentPayments}
                  rowKey={(r) => r.id}
                  columns={[
                    {
                      key: 'entityName', title: 'Tashkilot',
                      render: (r) => (
                        <>
                          {r.entityName}
                          <span className="block eko-text-xs text-eko-muted">
                            {f.date(r.paidAt)} · {f.monthLabel(r.month)}{r.receiptNumber ? ` · ${r.receiptNumber}` : ''}
                          </span>
                        </>
                      ),
                    },
                    { key: 'amount', title: "Summa, so'm", align: 'right' },
                  ]}
                />
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
