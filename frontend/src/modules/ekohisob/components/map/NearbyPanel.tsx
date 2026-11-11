import { MapPin, Navigation, Plus, Check } from 'lucide-react'
import { Banner, Button, DebtDot, EmptyState, IconButton, LinkButton, f } from '../../ui'
import { MapEntity, debtOf } from './useMapEntities'
import { levelOf } from './mapIcons'
import { fmtDist } from './geo'

export type NearbyItem = MapEntity & { dist?: number }

/**
 * "Eng yaqin qarzdorlar" ro'yxati (joylashuv bo'lsa — masofa bo'yicha; bo'lmasa
 * qarz miqdori bo'yicha). Har qatorda "Marshrutga qo'shish".
 */
export default function NearbyPanel({
  items, hasLocation, locating, onLocate, onOpen, inRoute, onToggleRoute,
}: {
  items: NearbyItem[]
  hasLocation: boolean
  locating: boolean
  onLocate: () => void
  onOpen: (e: MapEntity) => void
  inRoute: (id: string) => boolean
  onToggleRoute: (e: MapEntity) => void
}) {
  return (
    <div>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <h2 className="eko-text-base font-semibold text-eko-text">
          {hasLocation ? 'Eng yaqin qarzdorlar' : 'Eng katta qarzdorlar'}
        </h2>
        {!hasLocation && (
          <Button size="sm" variant="secondary" loading={locating} onClick={onLocate}>Joylashuvim</Button>
        )}
      </div>
      {!hasLocation && (
        <div className="px-3 pb-2">
          <Banner tone="info">Joylashuvni yoqing — qarzdorlar sizdan masofa bo'yicha tartiblanadi.</Banner>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState compact tone="success" title="Qarzdor topilmadi" hint="Ko'rinayotgan hududda to'lamagan tashkilot yo'q." />
      ) : (
        <ul className="divide-y divide-eko-line border-t border-eko-line">
          {items.map((e, i) => {
            const added = inRoute(e.id)
            return (
              <li key={e.id} className="flex items-center gap-1 pl-3 pr-1 min-h-[64px]">
                <span className="w-6 text-eko-muted eko-text-xs eko-num shrink-0">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => onOpen(e)}
                  className="flex-1 min-w-0 text-left py-2 min-h-[44px]"
                >
                  <span className="flex items-center gap-1.5 eko-text-base font-medium text-eko-text">
                    <DebtDot level={levelOf(e.debtMonths)} />
                    <span className="truncate">{e.name}</span>
                  </span>
                  <span className="block eko-text-xs text-eko-muted truncate">{e.address || 'Manzil yo\'q'}</span>
                  <span className="block eko-text-xs text-eko-text-2 eko-num">
                    {e.dist != null && <><b>{fmtDist(e.dist)}</b> · </>}
                    {f.money(debtOf(e))} so'm
                    {e.debtMonths > 0 && <> · {e.debtMonths} oy</>}
                  </span>
                </button>
                <IconButton
                  label={added ? 'Marshrutdan olib tashlash' : "Marshrutga qo'shish"}
                  aria-pressed={added}
                  variant={added ? 'secondary' : 'ghost'}
                  className={added ? '!bg-eko-surface-3' : ''}
                  onClick={() => onToggleRoute(e)}
                  icon={added ? <Check className="w-4 h-4" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                />
                <LinkButton
                  href={`https://maps.google.com/?q=${e.lat},${e.lng}`}
                  target="_blank" rel="noopener noreferrer"
                  variant="ghost" aria-label="Navigator bilan borish" title="Navigator bilan borish"
                  className="!px-0 w-11 md:w-10 shrink-0"
                  icon={<Navigation className="w-4 h-4" aria-hidden />}
                />
              </li>
            )
          })}
        </ul>
      )}
      {items.length > 0 && (
        <p className="px-3 py-2 eko-text-xs text-eko-muted flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" aria-hidden /> Tashkilot nomini bossangiz, xaritada ochiladi.
        </p>
      )}
    </div>
  )
}
