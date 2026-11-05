import { useCallback, useEffect, useState } from 'react'
import { Download, Lock, Unlock, Trophy } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import {
  Page, PageHeader, Toolbar, SegmentedControl, MonthInput, Button, Badge, Banner, Modal, Field, Textarea,
  SkeletonList, StatTile, StatRow, f, useConfirm,
} from '../../ui'
import KpiResultsTab from './KpiResultsTab'
import KpiSchemeTab from './KpiSchemeTab'
import { MonthResults, errMsg } from './types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function KpiAdminView() {
  const confirm = useConfirm()
  const [month, setMonth] = useState(currentMonth)
  const [tab, setTab] = useState<'results' | 'scheme'>('results')
  const [data, setData] = useState<MonthResults | null>(null)
  const [error, setError] = useState('')
  const [reopenOpen, setReopenOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await ekoApi.get('/kpi/results', { params: { month } })
      setData(res.data.data)
      setError('')
    } catch (e) { setError(errMsg(e, "Natijalarni yuklab bo'lmadi")) }
  }, [month])

  useEffect(() => { setData(null); load() }, [load])

  async function closeMonth() {
    if (!data) return
    const ok = await confirm({
      title: `${month} oyini yopish`,
      message: "Natijalar qotiriladi: keyin ko'rsatkich, maqsad yoki tuzatish o'zgarsa ham bu oy bonusi o'zgarmaydi.",
      consequences: [`Jami bonus: ${f.money(data.totalBonus)}`, `${data.rows.length} ta xodim`, 'Kerak bo\'lsa sabab ko\'rsatib qayta ochish mumkin (jurnalga yoziladi)'],
      confirmLabel: 'Yopish',
    })
    if (!ok) return
    try { await ekoApi.post(`/kpi/periods/${month}/close`); toast.success('Oy yopildi'); load() }
    catch (e) { toast.error(errMsg(e)) }
  }

  async function exportXlsx() {
    try {
      const res = await ekoApi.get('/kpi/export.xlsx', { params: { month }, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url; a.download = `ekohisob_kpi_${month}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Excel yuklab olishda xato') }
  }

  const closed = data?.status === 'closed'
  const avg = data && data.rows.length ? Math.round((data.rows.reduce((s, r) => s + r.score, 0) / data.rows.length) * 10) / 10 : 0

  return (
    <Page>
      <PageHeader
        icon={<Trophy className="w-5 h-5" />}
        title="KPI va bonus"
        subtitle="Inspektorlar ko'rsatkichlari, oylik bonus hisobi"
        actions={
          <>
            <Button icon={<Download className="w-4 h-4" />} onClick={exportXlsx}>Excel</Button>
            {tab === 'results' && data && (closed
              ? <Button icon={<Unlock className="w-4 h-4" />} onClick={() => setReopenOpen(true)}>Qayta ochish</Button>
              : <Button variant="primary" icon={<Lock className="w-4 h-4" />} onClick={closeMonth}>Oyni yopish</Button>)}
          </>
        }
      />

      <Toolbar>
        <SegmentedControl
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
          {error && <Banner tone="danger">{error}</Banner>}
          {!data && !error && <SkeletonList rows={5} />}
          {data && (
            <>
              <StatRow cols={3}>
                <StatTile label="Jami bonus" value={f.money(data.totalBonus)} tone="accent" />
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
    </Page>
  )
}

function ReopenModal({ month, onClose, onDone }: { month: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await ekoApi.post(`/kpi/periods/${month}/reopen`, { reason })
      toast.success('Oy qayta ochildi')
      onDone()
    } catch (e) { toast.error(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal
      onClose={onClose}
      title={`${month} oyini qayta ochish`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Bekor</Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={submit}>Qayta ochish</Button>
        </>
      }
    >
      <div className="p-5 space-y-3">
        <Banner tone="warn">Qotirilgan natija bekor bo'ladi va joriy sxema bo'yicha qayta hisoblanadi. Sabab va oldingi jami bonus jurnalga yoziladi.</Banner>
        <Field label="Sabab" required>
          {id => <Textarea id={id} rows={3} value={reason} onChange={e => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
