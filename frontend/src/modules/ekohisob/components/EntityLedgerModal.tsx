import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Plus, Scale, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { ekoKeys } from '../lib/queries'
import {
  Badge, BadgeTone, Banner, Button, DebtAgeStrip, DebtAgeMonth, ErrorState, Menu, Modal, MoneyText,
  SkeletonList, f,
} from '../ui'
import PaymentList, { PaymentListItem } from './payments/PaymentList'
import { useCancelPayment } from './payments/useCancelPayment'

interface TimelineRow {
  month: string
  expected: number | null
  paid: number
  status: 'paid' | 'partial' | 'unpaid' | 'none'
}

interface LedgerData {
  billingMode: 'monthly_fixed' | 'variable' | 'talon'
  monthlyFee: number
  cubicPrice?: number
  totalDebt: number
  advance?: number
  unpaidMonths?: string[]
  timeline: TimelineRow[]
}

const MODE_LABEL: Record<string, string> = {
  monthly_fixed: 'Belgilangan oylik',
  variable: "O'zgaruvchan",
  talon: 'Talon (kub asosida)',
}

const STATUS: Record<TimelineRow['status'], { tone: BadgeTone; label: string }> = {
  paid: { tone: 'success', label: "To'langan" },
  partial: { tone: 'warn', label: 'Qisman' },
  unpaid: { tone: 'danger', label: "To'lanmagan" },
  none: { tone: 'neutral', label: 'Hisob yo\'q' },
}

interface Props {
  entityId: string
  entityName: string
  onClose: () => void
  onAddPayment: () => void
  /** Admin: to'lovni bekor qila oladi */
  isAdmin?: boolean
  readOnly?: boolean
}

/** Akt sverkani chop etish uchun ochadi (HTML token bilan olinib blob'da ochiladi). */
async function openReconciliation(entityId: string) {
  try {
    const res = await ekoApi.get(`/entities/${entityId}/reconciliation/print`, { responseType: 'text' })
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html;charset=utf-8' }))
    if (!window.open(url, '_blank')) toast.error("Brauzer yangi oynani blokladi — ruxsat bering")
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (err) { toast.error(errMsg(err)) }
}

/** Qarz yoshi chizig'i uchun: oylik holat -> katak holati (qarz darajasi oy yoshidan). */
function stripMonths(rows: TimelineRow[]): DebtAgeMonth[] {
  const now = new Date()
  const curIdx = now.getFullYear() * 12 + now.getMonth()
  return rows.map(r => {
    const [y, m] = r.month.split('-').map(Number)
    const age = curIdx - (y * 12 + (m - 1))
    const state = r.status === 'paid' ? 'paid' : r.status === 'unpaid' ? 'open' : r.status === 'partial' ? 'partial' : 'none'
    return { month: r.month, state, level: (age >= 2 ? 3 : age === 1 ? 2 : 1) as 1 | 2 | 3 }
  })
}

export default function EntityLedgerModal({ entityId, entityName, onClose, onAddPayment, isAdmin, readOnly }: Props) {
  const [invoiceBusy, setInvoiceBusy] = useState(false)

  const ledger = useQuery<LedgerData>({
    queryKey: [...ekoKeys.payments, 'ledger', entityId],
    queryFn: async () => (await ekoApi.get(`/charges/entity/${entityId}`)).data.data,
    staleTime: 0, gcTime: 0,
  })
  const pays = useQuery<PaymentListItem[]>({
    queryKey: [...ekoKeys.payments, 'entity-list', entityId],
    queryFn: async () => {
      const res = await ekoApi.get('/payments', { params: { entityId, limit: 30 } })
      return (res.data.data ?? []).map((p: any): PaymentListItem => ({
        id: p.id, month: p.month, amount: p.amount, paidAt: p.paidAt, method: p.method,
        receiverName: p.receiver?.fullName, receiptNumber: p.receipt?.receiptNumber,
        voided: Boolean(p.receipt?.voidedAt),
      }))
    },
    staleTime: 0, gcTime: 0,
  })

  const cancel = useCancelPayment(() => { ledger.refetch(); pays.refetch() })
  const [busyId, setBusyId] = useState<string | null>(null)

  async function downloadInvoice() {
    setInvoiceBusy(true)
    try {
      const res = await ekoApi.get(`/entities/${entityId}/invoice`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `faktura_${entityName.slice(0, 30)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) { toast.error(errMsg(err)) } finally { setInvoiceBusy(false) }
  }

  const data = ledger.data
  const paidThrough = data ? [...data.timeline].reverse().find(r => r.status === 'paid')?.month : undefined

  return (
    <Modal
      onClose={onClose}
      size="md"
      title={entityName}
      hint="To'lovlar tasmasi"
      footer={
        <>
          <Menu
            items={[
              { key: 'inv', label: invoiceBusy ? 'Yuklanmoqda...' : 'Faktura (Excel)', icon: <Download className="w-4 h-4" />, disabled: invoiceBusy, onSelect: downloadInvoice },
              { key: 'akt', label: 'Akt sverka', icon: <Scale className="w-4 h-4" />, onSelect: () => openReconciliation(entityId) },
            ]}
            trigger={p => <Button {...p} icon={<FileText className="w-4 h-4" aria-hidden />}>Hujjatlar</Button>}
          />
          {!readOnly && (
            <Button variant="primary" className="flex-1" icon={<Plus className="w-4 h-4" aria-hidden />} onClick={onAddPayment}>
              To'lov qo'shish
            </Button>
          )}
        </>
      }
    >
      <div className="p-5 space-y-5">
        {ledger.isLoading && <SkeletonList rows={5} />}
        {ledger.isError && <ErrorState hint={errMsg(ledger.error)} onRetry={() => ledger.refetch()} compact />}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="eko-text-xs text-eko-muted">To'lov rejimi</p>
                <p className="eko-text-base font-medium text-eko-text">{MODE_LABEL[data.billingMode] ?? data.billingMode}</p>
                {data.billingMode === 'talon' && !!data.cubicPrice && (
                  <p className="eko-text-xs text-eko-muted">{f.num(data.cubicPrice)} so'm / kub</p>
                )}
              </div>
              {data.billingMode !== 'variable' && (
                <div>
                  <p className="eko-text-xs text-eko-muted">Jami qarz</p>
                  <MoneyText value={data.totalDebt} className="eko-text-base font-semibold text-eko-text" />
                  {!!data.unpaidMonths?.length && (
                    <p className="eko-text-xs text-eko-muted">{data.unpaidMonths.length} oy qarzdor</p>
                  )}
                </div>
              )}
            </div>

            {!!data.advance && data.advance > 0 && (
              <Banner tone="info">Avans: <b>{f.money(data.advance)}</b></Banner>
            )}

            <div className="space-y-1.5">
              <DebtAgeStrip months={stripMonths(data.timeline)} />
              {paidThrough && (
                <p className="eko-text-sm text-eko-muted">{f.monthLabel(paidThrough)} gacha to'lagan</p>
              )}
            </div>

            <section>
              <h3 className="eko-text-base font-medium text-eko-text mb-2">Oylar bo'yicha</h3>
              <ul className="divide-y divide-eko-line border border-eko-line rounded-eko-lg">
                {[...data.timeline].reverse().map(row => {
                  const s = STATUS[row.status]
                  return (
                    <li key={row.month} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="eko-text-base text-eko-text">{f.monthLabel(row.month)}</span>
                      <span className="flex items-center gap-2 text-right">
                        {row.paid > 0 && (
                          <span className="eko-text-sm text-eko-muted eko-num">
                            {f.num(row.paid)}{row.status === 'partial' && row.expected != null ? ` / ${f.num(row.expected)}` : ''}
                          </span>
                        )}
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        )}

        <section>
          <h3 className="eko-text-base font-medium text-eko-text mb-2">To'lovlar</h3>
          {pays.isLoading && <SkeletonList rows={3} />}
          {pays.isError && <ErrorState compact hint={errMsg(pays.error)} onRetry={() => pays.refetch()} />}
          {pays.data && pays.data.length === 0 && <p className="eko-text-sm text-eko-muted">Hali to'lov yo'q</p>}
          {pays.data && pays.data.length > 0 && (
            <PaymentList
              items={pays.data}
              busyId={busyId}
              onCancel={isAdmin ? async p => { setBusyId(p.id); await cancel(p); setBusyId(null) } : undefined}
            />
          )}
        </section>
      </div>
    </Modal>
  )
}
