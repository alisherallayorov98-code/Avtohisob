import { useCallback, useEffect, useState } from 'react'
import {
  Phone, MapPin, Pencil, Wallet, MessageSquare, FileText, CalendarDays, ShieldCheck,
  AlertCircle, Scale, User, Hash, Receipt,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import ekoApi from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { invalidateEko } from '../lib/queries'
import {
  Modal, Button, LinkButton, Badge, DebtBadge, BillingBadge, Banner, Toggle, MoneyText,
  SkeletonList, STATUS_BADGE, f,
} from '../ui'
import EntityEditForm from './entities/EntityEditForm'
import VisitHistory from './entities/VisitHistory'
import PaymentList from './payments/PaymentList'
import { useCancelPayment } from './payments/useCancelPayment'
import type { Card, EntityCardActions } from './entities/cardTypes'

export type { EntityCardActions }

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-eko-subtle mt-0.5" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="eko-text-xs text-eko-muted">{label}</dt>
        <dd className={value ? 'text-eko-text break-words eko-text-base' : 'text-eko-muted eko-text-base'}>{value || '—'}</dd>
      </div>
    </div>
  )
}

/**
 * Tashkilot kartochkasi — bitta oynada: ma'lumot, qarz, to'lovlar, tashrif tarixi,
 * tezkor amallar va tahrirlash. Chala (draft) tashkilot tahrirlash rejimida ochiladi.
 */
export default function EntityCardModal({
  entityId, readOnly, isAdmin = false, actions, startEditing, onClose, onChanged,
}: {
  entityId: string
  readOnly: boolean
  isAdmin?: boolean
  actions: EntityCardActions
  startEditing?: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [optBusy, setOptBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await ekoApi.get(`/entities/${entityId}/card`)
      const data: Card = res.data.data
      setCard(data)
      setError('')
      return data
    } catch (err) {
      setError(errMsg(err))
      return null
    }
  }, [entityId])

  useEffect(() => {
    load().then(d => { if (d && startEditing && !readOnly) setEditing(true) })
  }, [load, startEditing, readOnly])

  const cancelPayment = useCancelPayment(() => { load(); onChanged() })
  const [busyId, setBusyId] = useState<string | null>(null)

  async function toggleOptOut(v: boolean) {
    setOptBusy(true)
    try {
      await ekoApi.patch(`/entities/${entityId}/sms-optout`, { smsOptOut: v })
      toast.success(v ? 'SMS yuborilmaydi' : 'SMS yana yuboriladi')
      await load()
      invalidateEko(qc, 'entity')
      onChanged()
    } catch (err) { toast.error(errMsg(err)) } finally { setOptBusy(false) }
  }

  const e = card?.entity
  const st = e ? STATUS_BADGE[e.status] : null

  return (
    <Modal
      onClose={onClose}
      size="lg"
      disableBackdropClose={editing}
      title={e?.name ?? 'Tashkilot'}
      hint={e ? [e.district?.name, e.mahalla?.name].filter(Boolean).join(' · ') || undefined : undefined}
    >
      <div className="p-5 space-y-5">
        {error && <Banner tone="danger" action={<Button size="sm" onClick={load}>Qayta urinish</Button>}>{error}</Banner>}
        {!card && !error && <SkeletonList rows={5} />}

        {card && e && !editing && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {e.status === 'active' ? <DebtBadge level={card.debt.level} /> : st && <Badge tone={st.tone}>{st.label}</Badge>}
              <BillingBadge mode={e.billingMode} />
              {e.code && <span className="eko-text-xs text-eko-muted font-mono">Kod: {e.code}</span>}
            </div>

            {card.completeness.missingRequired.length > 0 && (
              <Banner
                tone="warn"
                action={!readOnly && <Button size="sm" variant="primary" onClick={() => setEditing(true)}>To'ldirish</Button>}
              >
                <b>Ma'lumot to'liq emas ({card.completeness.percent}%).</b>{' '}
                Majburiy: {card.completeness.missingRequired.map(m => m.label).join(', ')}.
              </Banner>
            )}
            {card.completeness.missingRequired.length === 0 && card.completeness.missingOptional.length > 0 && (
              <p className="eko-text-xs text-eko-muted">
                To'liqlik {card.completeness.percent}% · yo'q: {card.completeness.missingOptional.map(m => m.label).join(', ')}
              </p>
            )}
            {e.blacklist?.status === 'active' && <Banner tone="danger">Qora ro'yxatda: {e.blacklist.reason}</Banner>}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-eko-lg border border-eko-line p-3">
                <p className="eko-text-xs text-eko-muted">{e.billingMode === 'variable' ? "Shu oy to'lovi" : 'Jami qarz'}</p>
                <p className="eko-text-lg font-semibold text-eko-text mt-0.5">
                  {e.billingMode === 'variable'
                    ? (card.debt.debtMonths > 0 ? "To'lanmagan" : "To'langan")
                    : <MoneyText value={card.debt.totalDebt} />}
                </p>
                {card.debt.debtMonths > 0 && e.billingMode !== 'variable' && (
                  <p className="eko-text-xs text-eko-muted mt-0.5">{card.debt.debtMonths} oy</p>
                )}
              </div>
              <div className="rounded-eko-lg border border-eko-line p-3">
                <p className="eko-text-xs text-eko-muted">{e.billingMode === 'talon' ? 'Bir kub narxi' : "Oylik to'lov"}</p>
                <p className="eko-text-lg font-semibold text-eko-text mt-0.5">
                  <MoneyText value={e.billingMode === 'talon' ? e.cubicPrice : e.monthlyFee} />
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!readOnly && e.status === 'active' && (
                <Button variant="primary" icon={<Wallet className="w-4 h-4" aria-hidden />} onClick={() => actions.onPay(e)}>To'lov</Button>
              )}
              {e.phone && (
                <LinkButton href={`tel:+${e.phone.replace(/\D/g, '')}`} icon={<Phone className="w-4 h-4" aria-hidden />}>Qo'ng'iroq</LinkButton>
              )}
              {e.lat != null && e.lon != null && (
                <LinkButton href={`https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}`} target="_blank" rel="noreferrer"
                  icon={<MapPin className="w-4 h-4" aria-hidden />}>Yo'nalish</LinkButton>
              )}
              <Button icon={e.billingMode === 'talon' ? <FileText className="w-4 h-4" aria-hidden /> : <CalendarDays className="w-4 h-4" aria-hidden />}
                onClick={() => e.billingMode === 'talon' ? actions.onTalons(e) : actions.onLedger(e)}>
                {e.billingMode === 'talon' ? 'Talonlar' : "To'lovlar tasmasi"}
              </Button>
              <Button icon={<Scale className="w-4 h-4" aria-hidden />} onClick={() => actions.onAkt(e.id)}>Akt sverka</Button>
              <Button icon={<ShieldCheck className="w-4 h-4" aria-hidden />} onClick={() => actions.onProof(e)}>GPS isbot</Button>
              {!readOnly && e.status === 'active' && e.phone && !e.smsOptOut && (
                <Button icon={<MessageSquare className="w-4 h-4" aria-hidden />} onClick={() => actions.onSms(e)}>SMS</Button>
              )}
              {!readOnly && <Button icon={<Pencil className="w-4 h-4" aria-hidden />} onClick={() => setEditing(true)}>Tahrirlash</Button>}
              {!readOnly && e.status === 'active' && (
                <Button variant="danger" icon={<AlertCircle className="w-4 h-4" aria-hidden />} onClick={() => actions.onBlacklist(e)}>
                  Qora ro'yxat
                </Button>
              )}
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              <Info icon={<MapPin className="w-4 h-4" />} label="Manzil" value={e.address} />
              <Info icon={<Phone className="w-4 h-4" />} label="Telefon" value={e.phone ? f.phone(e.phone) : null} />
              <Info icon={<User className="w-4 h-4" />} label="Mas'ul shaxs" value={e.contactName} />
              <Info icon={<Hash className="w-4 h-4" />} label="STIR" value={e.stir} />
              <Info icon={<Receipt className="w-4 h-4" />} label="Shartnoma" value={e.contractNumber} />
              <Info icon={<MapPin className="w-4 h-4" />} label="Joylashuv"
                value={e.lat != null && e.lon != null ? `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}` : null} />
            </dl>

            {!readOnly && e.phone && (
              <Toggle
                checked={!!e.smsOptOut}
                disabled={optBusy}
                onChange={toggleOptOut}
                label="SMS olishni rad etgan"
                hint="Yoqilsa, bu tashkilotga avtomatik va qo'lda SMS yuborilmaydi."
              />
            )}

            <section>
              <h3 className="eko-text-base font-medium text-eko-text mb-2">Oxirgi to'lovlar</h3>
              {card.payments.length === 0 ? (
                <p className="eko-text-sm text-eko-muted">Hali to'lov yo'q</p>
              ) : (
                <PaymentList
                  busyId={busyId}
                  items={card.payments.map(p => ({
                    id: p.id, month: p.month, amount: p.amount, paidAt: p.paidAt,
                    receiverName: p.receiver?.fullName, receiptNumber: p.receipt?.receiptNumber,
                  }))}
                  onCancel={isAdmin ? async p => { setBusyId(p.id); await cancelPayment(p); setBusyId(null) } : undefined}
                />
              )}
            </section>

            <VisitHistory entityId={entityId} />

            {card.smsLogs.length > 0 && (
              <p className="eko-text-xs text-eko-muted flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4" aria-hidden />
                Oxirgi SMS: {f.dateTime(card.smsLogs[0].createdAt)}
                {card.smsLogs[0].status === 'failed' ? ' (yuborilmagan)' : ''}
              </p>
            )}
          </>
        )}

        {card && e && editing && (
          <EntityEditForm
            card={card}
            actions={actions}
            onCancel={() => setEditing(false)}
            onSaved={async () => { await load(); invalidateEko(qc, 'entity'); onChanged(); setEditing(false) }}
          />
        )}
      </div>
    </Modal>
  )
}
