import { useCallback, useEffect, useState } from 'react'
import { Phone, Navigation, Wallet, MoreHorizontal, LocateFixed, CircleSlash } from 'lucide-react'
import { tgApi, tgErrorMessage } from './tgApi'
import {
  Modal, Button, IconButton, LinkButton, Menu, Badge, DebtBadge, BillingBadge, Banner, SkeletonList, useConfirm, f,
} from '../ui'
import { TgPayForm, TgPaySuccess } from './TgPayForm'
import { TgVisitForm } from './TgVisitForm'
import { nativeConfirm, openExternal, useBackButton, useMainButton, hapticSuccess } from './tgTelegram'
import { GeoError, geoErrorText, requestFix } from './tgUtil'
import type { CardData, PayResult, VisitMark, VisitRow } from './tgTypes'

type View = 'info' | 'pay' | 'visit' | 'success'

const KIND_LABEL: Record<VisitRow['kind'], string> = {
  not_paid: "To'lamadi", promised: "Va'da berdi", visited: 'Tashrif',
}

/** To'lov yozilmasligining sababi (tugma o'rniga bir qatorli matn). `null` — yozish mumkin. */
function payBlockReason(canWrite: boolean, status: string | undefined): string | null {
  if (!canWrite) return "Faqat ko'rish huquqi — to'lov yozib bo'lmaydi"
  if (status === 'draft') return "Ma'lumot to'liq emas — to'lov yozilmaydi"
  if (status === 'blacklisted') return "Qora ro'yxatda — to'lov yozilmaydi"
  if (status && status !== 'active') return "Tashkilot faol emas — to'lov yozilmaydi"
  return null
}

/**
 * Tashkilot varag'i (mini ilova): qarz, to'lov, to'lamadi/va'da, joyni yangilash.
 * Pastki sticky panel: [Qo'ng'iroq] [Yo'nalish] [To'lov yozish] [...]. Telegramda
 * asosiy amal MainButton'da, BackButton orqaga qaytaradi.
 */
export default function TgEntitySheet({
  entityId, canWrite, initialPay, getNext, onOpenNext, onClose, onPaid, onVisit,
}: {
  entityId: string
  canWrite: boolean
  initialPay: boolean
  getNext: () => string | null
  onOpenNext: () => void
  onClose: () => void
  onPaid: (entityId: string, r: PayResult) => void
  onVisit: (entityId: string, mark: VisitMark) => void
}) {
  const confirm = useConfirm()
  const [data, setData] = useState<CardData | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('info')
  const [result, setResult] = useState<PayResult | null>(null)
  const [lastVisit, setLastVisit] = useState<VisitRow | null>(null)
  const [visitMsg, setVisitMsg] = useState('')
  const [autoPay, setAutoPay] = useState(initialPay)

  const load = useCallback(async () => {
    try {
      const res = await tgApi.get(`/entities/${entityId}/card`)
      setData(res.data.data)
      setError('')
    } catch (e) { setError(tgErrorMessage(e, "Ma'lumotni yuklab bo'lmadi")) }
  }, [entityId])

  const loadVisit = useCallback(async () => {
    try {
      const res = await tgApi.get('/visits', { params: { entityId, limit: 1 } })
      setLastVisit((res.data.data ?? [])[0] ?? null)
    } catch (e) {
      // Tashrif tarixi qo'shimcha ma'lumot — varaqni to'sib qo'ymaydi
      console.warn('visits', tgErrorMessage(e))
    }
  }, [entityId])

  useEffect(() => { load(); loadVisit() }, [load, loadVisit])

  const e = data?.entity
  const blocked = payBlockReason(canWrite, e?.status)
  const canPay = Boolean(data && !blocked)

  // Ro'yxatdagi "To'lov" tugmasidan kelgan bo'lsa — karta yuklangach forma darrov ochiladi
  useEffect(() => {
    if (autoPay && data) {
      setAutoPay(false)
      if (canPay) setView('pay')
    }
  }, [autoPay, data, canPay])

  useBackButton(view === 'pay' || view === 'visit' ? () => setView('info') : onClose)

  const native = useMainButton({
    text: "To'lov yozish", onClick: () => setView('pay'), visible: view === 'info' && canPay,
  })

  function paid(r: PayResult) {
    setResult(r)
    setView('success')
    hapticSuccess()
    onPaid(entityId, r)
  }

  const phoneHref = e?.phone ? `tel:+${e.phone.replace(/\D/g, '')}` : undefined
  const routeHref = e && e.lat != null && e.lon != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}` : undefined

  const footer = view === 'info' && data && e ? (
    <>
      <LinkButton
        size="lg" href={phoneHref} disabled={!phoneHref} aria-label="Qo'ng'iroq"
        className={`!w-12 !px-0 shrink-0 ${phoneHref ? '' : 'opacity-40'}`} icon={<Phone className="w-5 h-5" />}
      />
      <LinkButton
        size="lg" href={routeHref} disabled={!routeHref} aria-label="Yo'nalish" target="_blank" rel="noreferrer"
        onClick={ev => routeHref && openExternal(routeHref, ev)}
        className={`!w-12 !px-0 shrink-0 ${routeHref ? '' : 'opacity-40'}`} icon={<Navigation className="w-5 h-5" />}
      />
      {canPay && !native && (
        <Button variant="primary" size="lg" block icon={<Wallet className="w-5 h-5" />} onClick={() => setView('pay')}>
          To'lov yozish
        </Button>
      )}
      {blocked && <p className="flex-1 min-w-0 eko-text-sm text-eko-text-2 leading-snug">{blocked}</p>}
      {canPay && native && <span className="flex-1" />}
      {canWrite && (
        <Menu
          items={[{ key: 'loc', label: e.lat != null ? 'Joyni yangilash' : 'Joyni belgilash', icon: <LocateFixed className="w-4 h-4" />, onSelect: () => setLocOpen(true) }]}
          trigger={p => <IconButton {...p} size="lg" label="Yana" icon={<MoreHorizontal className="w-5 h-5" />} />}
        />
      )}
    </>
  ) : undefined

  // Joyni yangilash: o'lchash -> (aniqlik past bo'lsa ogohlantirish) -> saqlash
  const [locOpen, setLocOpen] = useState(false)
  const [locBusy, setLocBusy] = useState(false)
  const [locMsg, setLocMsg] = useState('')
  const [pending, setPending] = useState<{ lat: number; lon: number; acc: number } | null>(null)

  async function save(p: { lat: number; lon: number }) {
    setLocBusy(true)
    try {
      await tgApi.put(`/entities/${entityId}/location`, { lat: p.lat, lon: p.lon })
      setLocMsg('Joylashuv saqlandi'); setPending(null)
      await load()
    } catch (err) { setLocMsg(tgErrorMessage(err, 'Saqlanmadi')) }
    finally { setLocBusy(false) }
  }

  async function measure() {
    setLocBusy(true); setLocMsg(''); setPending(null)
    try {
      const fix = await requestFix({ timeout: 15000 })
      if (fix.accuracy > 50) { setPending({ lat: fix.lat, lon: fix.lon, acc: Math.round(fix.accuracy) }); return }
      await save(fix)
    } catch (err) {
      setLocMsg(err instanceof GeoError ? geoErrorText(err) : tgErrorMessage(err, 'Saqlanmadi'))
    } finally { setLocBusy(false) }
  }

  useEffect(() => {
    if (!locOpen || !e) return
    setLocOpen(false)
    ;(async () => {
      if (e.lat != null) {
        const msg = "Joylashuv allaqachon belgilangan. Hozirgi joyingizga o'zgartiraymi?"
        const ok = await (nativeConfirm(msg) ?? confirm({ title: 'Joyni yangilash', message: msg, confirmLabel: "O'zgartirish" }))
        if (!ok) return
      }
      await measure()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locOpen])

  const title = view === 'success' ? "To'lov yozildi" : view === 'pay' ? "To'lov yozish" : view === 'visit' ? "To'lamadi / Va'da" : (e?.name ?? 'Tashkilot')

  return (
    <Modal
      onClose={onClose}
      title={title}
      hint={view === 'info' && e ? [e.district?.name, e.mahalla?.name].filter(Boolean).join(' · ') || undefined : e?.name}
      footer={footer}
      disableBackdropClose={view !== 'info'}
    >
      {view === 'success' && result && (
        <TgPaySuccess
          result={result}
          hasNext={getNext() != null}
          onNext={onOpenNext}
          onClose={onClose}
        />
      )}

      {view === 'pay' && data && (
        <TgPayForm card={data} onBack={() => setView('info')} onSuccess={paid} />
      )}

      {view === 'visit' && (
        <TgVisitForm
          entityId={entityId}
          onBack={() => setView('info')}
          onDone={mark => {
            setView('info'); setVisitMsg("Qayd etildi")
            onVisit(entityId, mark)
            loadVisit()
          }}
        />
      )}

      {view === 'info' && (
        <div className="p-5 space-y-4">
          {error && <Banner tone="danger" action={<Button size="sm" onClick={load}>Qayta urinish</Button>}>{error}</Banner>}
          {!data && !error && <SkeletonList rows={4} />}
          {visitMsg && <Banner tone="success">{visitMsg}</Banner>}

          {data && e && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {e.status === 'draft' ? <Badge tone="warn">Chala</Badge> : <DebtBadge level={data.debt.level} />}
                <BillingBadge mode={e.billingMode} />
              </div>

              {e.status === 'draft' && (
                <Banner tone="warn">
                  Ma'lumot to'liq emas: {data.completeness.missingRequired.map(m => m.label).join(', ')}. Saytda to'ldiring.
                </Banner>
              )}

              {e.address && <p className="eko-text-md text-eko-text-2">{e.address}</p>}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-eko-lg border border-eko-line p-3">
                  <p className="eko-text-sm text-eko-muted">{e.billingMode === 'variable' ? 'Shu oy' : 'Qarz'}</p>
                  <p className="eko-text-lg font-semibold text-eko-text mt-0.5 eko-num">
                    {e.billingMode === 'variable'
                      ? (data.debt.debtMonths > 0 ? "To'lanmagan" : "To'langan")
                      : f.money(data.debt.totalDebt)}
                  </p>
                  {e.billingMode !== 'variable' && data.debt.debtMonths > 0 && (
                    <p className="eko-text-sm text-eko-muted">{data.debt.debtMonths} oy</p>
                  )}
                </div>
                <div className="rounded-eko-lg border border-eko-line p-3">
                  <p className="eko-text-sm text-eko-muted">{e.billingMode === 'talon' ? 'Kub narxi' : 'Oylik'}</p>
                  <p className="eko-text-lg font-semibold text-eko-text mt-0.5 eko-num">
                    {f.money(e.billingMode === 'talon' ? e.cubicPrice : e.monthlyFee)}
                  </p>
                  {data.payments[0] && <p className="eko-text-sm text-eko-muted">Oxirgi: {f.date(data.payments[0].paidAt)}</p>}
                </div>
              </div>

              {lastVisit && (
                <p className="eko-text-base text-eko-text-2">
                  Oxirgi tashrif: <b className="text-eko-text">{f.date(lastVisit.createdAt)}</b> · {KIND_LABEL[lastVisit.kind]}
                  {lastVisit.reason ? ` — ${lastVisit.reason}` : ''}
                  {lastVisit.promisedDate ? ` · va'da ${f.date(lastVisit.promisedDate)}` : ''}
                </p>
              )}

              {canWrite && e.status === 'active' && (
                <Button size="lg" block icon={<CircleSlash className="w-5 h-5" />} onClick={() => { setVisitMsg(''); setView('visit') }}>
                  To'lamadi / Va'da
                </Button>
              )}

              {locBusy && <p className="eko-text-base text-eko-muted">Joylashuv aniqlanmoqda…</p>}
              {pending && (
                <Banner
                  tone="warn"
                  action={
                    <div className="flex flex-col gap-2">
                      <Button size="sm" onClick={measure}>Qayta o'lchash</Button>
                      <Button size="sm" variant="danger" onClick={() => save(pending)}>Baribir saqlash</Button>
                    </div>
                  }
                >
                  GPS aniqligi past: ±{pending.acc} m. Ochiq joyda qayta o'lchang.
                </Banner>
              )}
              {locMsg && !pending && <p className="eko-text-base text-eko-text-2">{locMsg}</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
