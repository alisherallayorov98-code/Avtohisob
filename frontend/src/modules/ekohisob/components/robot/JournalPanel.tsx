import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { RotateCcw } from 'lucide-react'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { Badge, Button, Card, CardHeader, Column, DataTable, f as fmt } from '../../ui'
import type { Category, Confidence, RuleAccuracy } from './types'
import { CATEGORY_LABEL, CONFIDENCE_META } from './types'

interface RuleRow {
  key: string; no: number; name: string; category: Category; confidence: Confidence; tier: 'auto' | 'admin'; accuracy: RuleAccuracy | null
}
interface VerdictRow {
  id: string; ruleName: string; title: string | null; verdict: 'confirmed' | 'wrong' | 'normal'; reason: string; resolution: string | null; createdByName: string; createdAt: string
}
interface DismissalRow {
  id: string; ruleName: string; title: string | null; reason: string; until: string | null; wholeRule: boolean; createdByName: string; createdAt: string
}

const VERDICT_META = {
  confirmed: { label: "To'g'ri", tone: 'success' as const },
  wrong: { label: "Noto'g'ri", tone: 'danger' as const },
  normal: { label: 'Normal', tone: 'neutral' as const },
}

/** Hukmlar jurnali + har qoidaning aniqligi. Faqat admin. */
export function VerdictsPanel() {
  const q = useQuery<{ verdicts: VerdictRow[]; rules: RuleRow[] }>({
    queryKey: ['eko', 'insights', 'verdicts'],
    queryFn: async () => (await ekoApi.get('/insights/verdicts')).data.data,
    staleTime: 30_000,
  })
  const ruleCols: Column<RuleRow>[] = [
    { key: 'name', title: 'Savol turi', render: r => (
      <div className="min-w-0">
        <p className="font-medium text-eko-text">{r.name}</p>
        <p className="eko-text-xs text-eko-muted">{CATEGORY_LABEL[r.category]} · {r.tier === 'auto' ? 'inspektorga avtomatik' : 'admin qarori'}</p>
      </div>
    ) },
    { key: 'conf', title: 'Ishonch', mobile: 'secondary', render: r => <Badge tone={CONFIDENCE_META[r.confidence].tone}>{CONFIDENCE_META[r.confidence].label}</Badge> },
    { key: 'votes', title: 'Hukmlar', align: 'right', render: r => r.accuracy ? `${r.accuracy.confirmed} / ${r.accuracy.wrong} / ${r.accuracy.normal}` : '—' },
    { key: 'pct', title: 'Aniqlik', align: 'right', render: r => r.accuracy?.pct != null
      ? <span className={r.accuracy.low ? 'text-eko-warn font-medium' : 'text-eko-text'}>{r.accuracy.pct}%</span>
      : <span className="text-eko-muted">—</span> },
  ]
  const vCols: Column<VerdictRow>[] = [
    { key: 'v', title: 'Hukm', render: r => <Badge tone={VERDICT_META[r.verdict].tone}>{VERDICT_META[r.verdict].label}</Badge> },
    { key: 't', title: 'Savol', render: r => (
      <div className="min-w-0">
        <p className="text-eko-text">{r.title ?? r.ruleName}</p>
        <p className="eko-text-xs text-eko-muted">Asos: {r.reason}{r.resolution ? ` · Yechim: ${r.resolution}` : ''}</p>
      </div>
    ) },
    { key: 'by', title: 'Kim', mobile: 'secondary', render: r => <span className="eko-text-sm">{r.createdByName}<br /><span className="text-eko-muted eko-text-xs">{fmt.dateTime(r.createdAt)}</span></span> },
  ]
  return (
    <div className="space-y-4">
      <Card flush>
        <CardHeader title="Qoidalar aniqligi" hint="To'g'ri / noto'g'ri / normal. Kamida 3 hukmdan keyin foiz chiqadi; ko'pincha noto'g'ri chiqqan tur avtomatik &quot;Taxmin&quot;ga tushadi." />
        <DataTable aria-label="Qoidalar aniqligi" columns={ruleCols} rows={q.data?.rules ?? []} rowKey={r => r.key}
          loading={q.isLoading} error={q.isError ? errMsg(q.error) : null} onRetry={() => q.refetch()} />
      </Card>
      <Card flush>
        <CardHeader title="Hukmlar jurnali" hint="Oxirgi 300 ta" />
        <DataTable aria-label="Hukmlar jurnali" columns={vCols} rows={q.data?.verdicts ?? []} rowKey={r => r.id}
          loading={q.isLoading} empty={{ title: "Hali hukm yo'q", hint: 'Savol kartochkasidagi "Hukm" tugmasi orqali qo\'shiladi.' }} />
      </Card>
    </div>
  )
}

/** Yashirilgan savollar — qaytarish mumkin. Faqat admin. */
export function DismissalsPanel() {
  const qc = useQueryClient()
  const q = useQuery<DismissalRow[]>({
    queryKey: ['eko', 'insights', 'dismissals'],
    queryFn: async () => (await ekoApi.get('/insights/dismissals')).data.data,
    staleTime: 30_000,
  })
  async function restore(id: string) {
    try {
      await ekoApi.delete(`/insights/dismissals/${id}`)
      toast.success('Savol qaytarildi')
      qc.invalidateQueries({ queryKey: ['eko', 'insights'] })
    } catch (e) { toast.error(errMsg(e)) }
  }
  const cols: Column<DismissalRow>[] = [
    { key: 't', title: 'Savol', render: r => (
      <div className="min-w-0">
        <p className="text-eko-text">{r.wholeRule ? <><Badge tone="warn">Butun tur</Badge> {r.ruleName}</> : (r.title ?? r.ruleName)}</p>
        <p className="eko-text-xs text-eko-muted">Sabab: {r.reason}</p>
      </div>
    ) },
    { key: 'u', title: 'Muddat', mobile: 'secondary', render: r => r.until ? `${fmt.date(r.until)} gacha` : 'Doimiy' },
    { key: 'by', title: 'Kim', mobile: 'hide', render: r => <span className="eko-text-sm">{r.createdByName}<br /><span className="text-eko-muted eko-text-xs">{fmt.date(r.createdAt)}</span></span> },
    { key: 'a', title: '', align: 'right', render: r => <Button size="sm" variant="ghost" onClick={() => restore(r.id)} icon={<RotateCcw className="w-4 h-4" aria-hidden />}>Qaytarish</Button> },
  ]
  return (
    <Card flush>
      <CardHeader title="Yashirilgan savollar" />
      <DataTable aria-label="Yashirilgan savollar" columns={cols} rows={q.data ?? []} rowKey={r => r.id}
        loading={q.isLoading} error={q.isError ? errMsg(q.error) : null} onRetry={() => q.refetch()}
        empty={{ title: "Yashirilgan savol yo'q" }} />
    </Card>
  )
}
