import { ArrowLeft, CheckCircle2, AlertCircle, Navigation, Plus, Check, FileText, Pencil, Ban } from 'lucide-react'
import { Banner, Button, LinkButton, Skeleton, f } from '../../ui'
import { MapEntity, debtOf } from './useMapEntities'

/**
 * Tashkilotning to'liq pasporti — marker bosilganda alohida so'rov bilan olinadi
 * (GET /entities/:id). Xarita ro'yxati (getMapData) buni bermaydi.
 */
export interface EntityDetail {
  id: string
  stir: string | null
  phone: string | null
  contactName: string | null
  contractNumber: string | null
  district: { name: string } | null
  mahalla: { name: string } | null
  blacklist: { reason: string; addedAt: string } | null
  payments: { month: string; amount: number; paidAt: string }[]
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2 min-h-[36px] items-center">
      <dt className="text-eko-muted shrink-0">{label}</dt>
      <dd className="text-eko-text text-right min-w-0 truncate">{children}</dd>
    </div>
  )
}

/** Tanlangan tashkilot kartasi — chap panelda (popup emas). */
export default function EntityPanelCard({
  entity, detail, detailLoading, detailError, readOnly, inRoute,
  onBack, onPay, onComplete, onToggleRoute, onOpenAkt,
}: {
  entity: MapEntity
  detail: EntityDetail | null
  detailLoading: boolean
  detailError: boolean
  readOnly: boolean
  inRoute: boolean
  onBack: () => void
  onPay: () => void
  onComplete: () => void
  onToggleRoute: () => void
  onOpenAkt: () => void
}) {
  const debt = debtOf(entity)
  const hasCoords = !!(entity.lat && entity.lng)
  return (
    <div>
      <div className="px-2 pt-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" aria-hidden />} onClick={onBack}>
          Ro'yxatga qaytish
        </Button>
      </div>
      <div className="px-4 pb-4 space-y-3">
        <div>
          <h2 className="eko-text-lg font-semibold text-eko-text leading-snug">{entity.name}</h2>
          {entity.address && <p className="eko-text-sm text-eko-muted mt-0.5">{entity.address}</p>}
        </div>

        <p className="flex items-center gap-1.5 eko-text-base font-medium text-eko-text">
          {entity.status === 'draft' ? (
            <><AlertCircle className="w-4 h-4 text-eko-warn" aria-hidden /> Chala — to'ldirilmagan</>
          ) : entity.status === 'blacklisted' ? (
            <><Ban className="w-4 h-4" aria-hidden /> Qora ro'yxatda</>
          ) : entity.paid ? (
            <><CheckCircle2 className="w-4 h-4 text-eko-success" aria-hidden /> Bu oy to'lagan</>
          ) : (
            <><AlertCircle className="w-4 h-4 text-eko-danger" aria-hidden />
              To'lamagan{entity.debtMonths > 1 && ` · ${entity.debtMonths} oy`}</>
          )}
        </p>

        {detail?.blacklist && (
          <Banner tone="danger" icon={<Ban className="w-4 h-4" />}>
            <b>Qora ro'yxatda.</b> {detail.blacklist.reason}
          </Banner>
        )}

        {debt > 0 && (
          <div className="border border-eko-line rounded-eko px-3 py-2.5 flex items-baseline justify-between gap-2">
            <span className="eko-text-sm text-eko-muted">Qarz</span>
            <span className="eko-text-lg font-semibold text-eko-text eko-num">{f.money(debt)} <span className="eko-text-sm font-normal text-eko-muted">so'm</span></span>
          </div>
        )}

        <dl className="eko-text-sm divide-y divide-eko-line border-y border-eko-line">
          <Row label="To'lov rejimi">
            {entity.billingMode === 'talon'
              ? `Talon · ${f.money(entity.cubicPrice)}/kub`
              : entity.billingMode === 'variable'
                ? "O'zgaruvchan"
                : `Oylik · ${f.money(entity.monthlyFee)}`}
          </Row>
          {detailLoading ? (
            <div className="py-3 space-y-2" aria-busy="true"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3.5 w-1/2" /></div>
          ) : detail ? (
            <>
              {(detail.district || detail.mahalla) && (
                <Row label="Hudud">{[detail.district?.name, detail.mahalla?.name].filter(Boolean).join(' / ')}</Row>
              )}
              {detail.stir && <Row label="STIR"><span className="eko-num">{detail.stir}</span></Row>}
              {detail.contractNumber && <Row label="Shartnoma">{detail.contractNumber}</Row>}
              {detail.phone && (
                <Row label="Telefon">
                  <a href={`tel:${detail.phone}`} className="underline underline-offset-2 inline-flex items-center min-h-[44px] md:min-h-0">{f.phone(detail.phone)}</a>
                </Row>
              )}
              {detail.payments[0] && (
                <Row label="Oxirgi to'lov">{f.date(detail.payments[0].paidAt)} · {f.money(detail.payments[0].amount)}</Row>
              )}
            </>
          ) : detailError ? (
            <p className="py-3 eko-text-sm text-eko-muted">Qo'shimcha ma'lumot yuklanmadi.</p>
          ) : null}
          {entity.creatorName && <Row label="Kiritgan">{entity.creatorName}</Row>}
        </dl>

        <div className="space-y-2">
          {!readOnly && entity.status === 'draft' && (
            <Button variant="primary" block icon={<Pencil className="w-4 h-4" aria-hidden />} onClick={onComplete}>
              Ma'lumotlarni to'ldirish
            </Button>
          )}
          {!readOnly && !entity.paid && entity.status === 'active' && (
            <Button variant="primary" block icon={<CheckCircle2 className="w-4 h-4" aria-hidden />} onClick={onPay}>
              To'lovni qayd etish
            </Button>
          )}
          {hasCoords && (
            <Button
              variant="secondary" block aria-pressed={inRoute}
              icon={inRoute ? <Check className="w-4 h-4" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
              onClick={onToggleRoute}
            >
              {inRoute ? 'Marshrutdan olib tashlash' : "Marshrutga qo'shish"}
            </Button>
          )}
          {hasCoords && (
            <LinkButton
              href={`https://maps.google.com/?q=${entity.lat},${entity.lng}`}
              target="_blank" rel="noopener noreferrer"
              variant="secondary" block icon={<Navigation className="w-4 h-4" aria-hidden />}
            >
              Navigator bilan borish
            </LinkButton>
          )}
          <Button variant="ghost" block icon={<FileText className="w-4 h-4" aria-hidden />} onClick={onOpenAkt}>
            To'liq hisob-kitob (akt sverka)
          </Button>
        </div>
      </div>
    </div>
  )
}
