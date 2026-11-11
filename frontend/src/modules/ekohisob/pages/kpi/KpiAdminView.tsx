import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import {
  Page, PageHeader, Toolbar, SegmentedControl, MonthInput, Button, Badge, Banner, Modal, Field, Textarea,
  SkeletonList, StatTile, StatRow, ErrorState, f, useConfirm,
} from '../../ui'
import KpiResultsTab from './KpiResultsTab'
import KpiSchemeTab from './KpiSchemeTab'
import { MonthResults, MissingEntry, errMsg, errBody } from './types'

/** Joriy oy, O'zbekiston vaqti bo'yicha ("2026-11"). */
function currentMonth(): string {
  return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7)
}

export default function KpiAdminView() {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [month, setMonth] = useState(currentMonth)
  const [tab, setTab] = useState<'results' | 'scheme'>('results')
  const [data, setData] = useState<MonthResults | null>(null)
  const [error, setError] = useState('')
  const [reopenOpen, setReopenOpen] = useState(false)
  const [missing, setMissing] = useState<MissingEntry[] | null>(null)
  const [closing, setClosing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await ekoApi.get('/kpi/results', { params: { month } })
      setData(res.data.data)
      setError('')
      qc.invalidateQueries({ queryKey: ekoKeys.kpi })
    } catch (e) { setError(errMsg(e, "Natijalarni yuklab bo'lmadi")) }
  }, [month, qc])

  useEffect(() => { setData(null); load() }, [load])

  async function doClose(force: boolean) {
    setClosing(true)
    try {
      await ekoApi.post(`/kpi/periods/${month}/close`, force ? { force: true } : {})
      toast.success(force ? "Oy yopildi (kiritilmagan qiymatlar bilan)" : 'Oy yopildi')
      setMissing(null)
      load()
    } catch (e) {
      const body = errBody(e)
      if (body.code === 'MISSING_VALUES' && Array.isArray(body.missing)) {
        setMissing(body.missing)
      } else {
        toast.error(errMsg(e))
      }
    } finally { setClosing(false) }
  }

  async function closeMonth() {
    if (!data) return
    const ok = await confirm({
      title: `${f.monthLabel(month)} oyini yopish`,
      message: "Natijalar qotiriladi: keyin ko'rsatkich, maqsad yoki tuzatish o'zgarsa ham bu oy bonusi o'zgarmaydi. Faqat o'tgan oyni yopish mumkin.",
      consequences: [
        `Jami bonus: ${f.money(data.totalBonus)}`,
        `${data.rows.length} ta xodim`,
        "Kerak bo'lsa sabab ko'rsatib qayta ochish mumkin (jurnalga yoziladi)",
      ],
      confirmLabel: 'Yopish',
    })
    if (ok) doClose(false)
  }

  async function exportXlsx() {
    try {
      const res = await ekoApi.get('/kpi/export.xlsx', { params: { month }, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url; a.download = `ekohisob_kpi_${month}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(errMsg(e, 'Excel yuklab olishda xato')) }
  }

  const closed = data?.status === 'closed'
  const avg = data && data.rows.length ? Math.round((data.rows.reduce((s, r) => s + r.score, 0) / data.rows.length) * 10) / 10 : 0

  return (
    <Page>
      <PageHeader
        title="KPI va bonus"
        subtitle={tab === 'results' ? `${f.monthLabel(month)} · inspektorlar ko'rsatkichlari va bonus` : "Ko'rsatkichlar va bonus qoidasi"}
        actions={
          <>
            <Button icon={<Download className="w-4 h-4" />} onClick={exportXlsx}>Excel</Button>
            {tab === 'results' && data && (closed
              ? <Button icon={<Unlock className="w-4 h-4" />} onClick={() => setReopenOpen(true)}>Qayta ochish</Button>
              : <Button variant="primary" loading={closing} icon={<Lock className="w-4 h-4" />} onClick={closeMonth}>Oyni yopish</Button>)}
          </>
        }
      />

      <Toolbar>
        <SegmentedControl
          ariaLabel="Bo'lim"
          value={tab}
          onChange={setTab}
          options={[{ value: 'results', label: 'Natijalar' }, { value: 'scheme', label: 'Sozlash' }]}
        />
        {tab === 'results' && (
          <>
            <MonthInput value={month} onChange={setMonth} />
            {data && <Badge tone={closed ? 'success' : 'info'}>{closed ? 'Yopilgan' : 'Ochiq'}</Badge>}
          </>
        )}
      </Toolbar>

      {tab === 'scheme' && <KpiSchemeTab onChanged={load} />}

      {tab === 'results' && (
        <>
          {error && <ErrorState title={error} onRetry={load} />}
          {!data && !error && <SkeletonList rows={5} />}
          {data && (
            <>
              <StatRow cols={3}>
                <StatTile lead label="Jami bonus" value={f.num(data.totalBonus)} unit="so'm" />
                <StatTile label="O'rtacha ball" value={avg} />
                <StatTile label="Xodimlar" value={data.rows.length} unit="ta" />
              </StatRow>
              {data.scheme.bonusMax === 0 && (
                <Banner tone="warn">Eng yuqori bonus summasi belgilanmagan — «Sozlash» bo'limida kiriting, aks holda bonus 0 bo'ladi.</Banner>
              )}
              {closed && (
                <Banner tone="success">Oy yopilgan — natijalar qotirilgan{data.closedAt ? ` (${f.dateTime(data.closedAt)})` : ''}.</Banner>
              )}
              <KpiResultsTab data={data} reload={load} />
            </>
          )}
        </>
      )}

      {reopenOpen && (
        <ReopenModal month={month} onClose={() => setReopenOpen(false)} onDone={() => { setReopenOpen(false); load() }} />
      )}

      {missing && (
        <Modal
          onClose={() => setMissing(null)}
          title="Ba'zi qiymatlar kiritilmagan"
          hint={f.monthLabel(month)}
          footer={
            <>
              <Button onClick={() => setMissing(null)} disabled={closing}>Qaytib kiritish</Button>
              <Button variant="danger" loading={closing} onClick={() => doClose(true)}>Baribir yopish</Button>
            </>
          }
        >
          <div className="p-5 space-y-3">
            <Banner tone="warn">
              Kiritilmagan ko'rsatkich hisobga olinmaydi — bonus shu holda qotiriladi. Oldin qiymatlarni kiriting yoki baribir yoping (jurnalga yoziladi).
            </Banner>
            <ul className="border border-eko-line rounded-eko-lg">
              {missing.map(m => (
                <li key={m.userId} className="px-3 py-2.5 border-b border-eko-line last:border-b-0">
                  <p className="eko-text-base font-medium text-eko-text">
                    {m.fullName} <span className="eko-text-xs font-normal text-eko-muted">· {m.missingCount} ta</span>
                  </p>
                  <p className="eko-text-xs text-eko-muted">{m.indicators.join(', ')}</p>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}
    </Page>
  )
}

function ReopenModal({ month, onClose, onDone }: { month: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const len = reason.trim().length

  async function submit() {
    setBusy(true)
    try {
      await ekoApi.post(`/kpi/periods/${month}/reopen`, { reason: reason.trim() })
      toast.success('Oy qayta ochildi')
      onDone()
    } catch (e) { toast.error(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal
      onClose={onClose}
      title={`${f.monthLabel(month)} oyini qayta ochish`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Bekor</Button>
          <Button variant="danger" loading={busy} disabled={len < 10} onClick={submit}>Qayta ochish</Button>
        </>
      }
    >
      <div className="p-5 space-y-3">
        <Banner tone="warn">Qotirilgan natija bekor bo'ladi va joriy sxema bo'yicha qayta hisoblanadi. Sabab va oldingi jami bonus jurnalga yoziladi.</Banner>
        <Field label="Sabab" required hint={`Kamida 10 belgi (hozir ${len})`}>
          {id => <Textarea id={id} rows={3} value={reason} onChange={e => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
