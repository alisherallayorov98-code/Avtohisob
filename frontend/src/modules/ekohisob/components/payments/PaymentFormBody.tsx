import { RotateCcw } from 'lucide-react'
import {
  Banner, Button, Field, Input, MoneyText, Select, SegmentedControl, Skeleton, f,
} from '../../ui'
import { PAYMENT_METHODS } from './paymentMath'
import type { usePaymentFlow } from './usePaymentFlow'
import type { EntityBasic } from './types'

type Flow = ReturnType<typeof usePaymentFlow>

/** To'lov formasi tanasi (tezkor yo'l: summa oldindan to'ldirilgan). */
export default function PaymentFormBody({ entity, flow }: { entity: EntityBasic; flow: Flow }) {
  const s = flow.status
  const debtMonths = flow.openDebts.length + (flow.monthRemaining > 0 ? 1 : 0)
  const showForm = !flow.fullyPaid || flow.allowAdvance
  const monthly = entity.billingMode !== 'talon' && entity.monthlyFee > 0

  return (
    <div className="p-5 space-y-4">
      <div>
        <p className="eko-text-base font-medium text-eko-text">{entity.name}</p>
        {entity.address && <p className="eko-text-sm text-eko-muted">{entity.address}</p>}
      </div>

      {s.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : s.isError ? (
        <Banner tone="warn" action={<Button size="sm" onClick={() => s.refetch()}>Qayta urinish</Button>}>
          Qarz holatini yuklab bo'lmadi. Summani qo'lda kiritib yozishingiz mumkin.
        </Banner>
      ) : (
        <div className="flex items-end justify-between gap-3 border border-eko-line rounded-eko-lg p-3">
          <div>
            <p className="eko-text-xs text-eko-muted">Jami qarz</p>
            <MoneyText value={flow.total} className="eko-text-lg font-semibold text-eko-text" />
          </div>
          {debtMonths > 0 && <p className="eko-text-sm text-eko-muted">{debtMonths} oy</p>}
        </div>
      )}

      {flow.fullyPaid && (
        <Banner
          tone="success"
          action={!flow.allowAdvance && (
            <Button size="sm" onClick={() => flow.setAllowAdvance(true)}>Avans yozish</Button>
          )}
        >
          {f.monthLabel(flow.month)} oyi to'liq to'langan.
        </Banner>
      )}

      {showForm && (
        <>
          {flow.openDebts.length > 0 && (
            <Field label="Oy">
              {id => (
                <Select id={id} value={flow.month} onChange={e => flow.setMonth(e.target.value)}>
                  {flow.knownMonths.map(m => {
                    const d = flow.openDebts.find(x => x.month === m)
                    return <option key={m} value={m}>{f.monthLabel(m)}{d ? ` — qarz ${f.num(d.debt)}` : ''}</option>
                  })}
                </Select>
              )}
            </Field>
          )}

          <Field label="Summa (so'm)" error={flow.error}>
            {id => (
              <Input
                id={id}
                data-autofocus
                inputMode="numeric"
                autoComplete="off"
                value={flow.amount > 0 ? f.num(flow.amount) : ''}
                onChange={e => flow.setAmount(e.target.value)}
                onFocus={e => e.currentTarget.select()}
                placeholder="0"
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-2">
            {flow.total > 0 && (
              <Button onClick={() => flow.setAmount(flow.total)}>To'liq</Button>
            )}
            {flow.total > 1 && (
              <Button onClick={() => flow.setAmount(Math.round(flow.total / 2))}>Yarmi</Button>
            )}
            {monthly && flow.total !== entity.monthlyFee && (
              <Button onClick={() => flow.setAmount(entity.monthlyFee)}>Oylik</Button>
            )}
          </div>

          {flow.plan.length > 0 && (
            <div className="eko-text-sm text-eko-text-2">
              <p>
                {flow.plan.length > 1
                  ? `${flow.plan.length} oyga taqsimlanadi`
                  : `${f.monthLabel(flow.plan[0].month)} hisobiga`}
              </p>
              {flow.plan.length > 1 && (
                <ul className="mt-1 space-y-0.5 eko-text-xs text-eko-muted">
                  {flow.plan.map(a => (
                    <li key={a.month} className="flex justify-between">
                      <span>{f.monthLabel(a.month)}</span><span className="eko-num">{f.num(a.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {flow.amount > 0 && flow.total > 0 && flow.amount < flow.total && (
            <Banner tone="warn">Qisman to'lov — yana <b>{f.money(flow.total - flow.amount)}</b> qarz qoladi.</Banner>
          )}
          {flow.advance > 0 && flow.total > 0 && (
            <Banner tone="info">Barcha qarz yopiladi, <b>{f.money(flow.advance)}</b> avans bo'lib qoladi.</Banner>
          )}

          <Field label="To'lov usuli">
            {() => (
              <SegmentedControl
                ariaLabel="To'lov usuli"
                value={flow.method}
                onChange={flow.setMethod}
                options={PAYMENT_METHODS.map(m => ({ value: m.value, label: m.label }))}
              />
            )}
          </Field>

          <Field label="Izoh (ixtiyoriy)">
            {id => <Input id={id} value={flow.note} onChange={e => flow.setNote(e.target.value)} maxLength={200} />}
          </Field>

          {flow.duplicate && (
            <Banner
              tone="warn"
              action={
                <Button size="sm" icon={<RotateCcw className="w-4 h-4" aria-hidden />}
                  loading={flow.submitting} onClick={() => flow.submit(true)}>
                  Baribir yozish
                </Button>
              }
            >
              Xuddi shu summa yaqinda yozilgan
              {flow.duplicate.paidAt ? ` (${f.dateTime(flow.duplicate.paidAt)})` : ''}
              {flow.duplicate.receiptNumber ? `, kvitansiya ${flow.duplicate.receiptNumber}` : ''}.
              Tugma ikki marta bosilgan bo'lsa — yozmang.
            </Banner>
          )}
        </>
      )}
    </div>
  )
}
