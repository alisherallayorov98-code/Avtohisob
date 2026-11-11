import { Navigation, Trash2, X } from 'lucide-react'
import {
  RoutePoint, LatLng, totalKm, estimateMinutes, yandexRouteUrl, googleRouteUrl,
} from '../../lib/routePlanner'
import { Banner, Button, EmptyState, IconButton, LinkButton, SegmentedControl, f } from '../../ui'

/**
 * Marshrut — xaritada tanlangan tashkilotlarning yurish tartibi. Chap paneldagi
 * "Marshrut" tabining mazmuni (alohida suzuvchi panel emas).
 *
 * Saqlanmaydi (sessiya ichida): marshrut odatda bir martalik. Tayyor tartib
 * Yandex/Google navigatorga bir bosishda uzatiladi.
 */
export default function RoutePanel({
  ordered, mode, onModeChange, onRemove, onClear, onFocus, userLoc,
}: {
  /** Tartiblangan nuqtalar (orderNearest yoki orderByDebt natijasi) */
  ordered: RoutePoint[]
  mode: 'nearest' | 'debt'
  onModeChange: (m: 'nearest' | 'debt') => void
  onRemove: (id: string) => void
  onClear: () => void
  /** Nuqta nomiga bosilganda xarita o'sha yerga uchadi */
  onFocus: (p: RoutePoint) => void
  userLoc: LatLng | null
}) {
  const km = totalKm(ordered, userLoc)
  const min = estimateMinutes(km, ordered.length)

  return (
    <div className="flex flex-col min-h-0">
      <div className="p-3 border-b border-eko-line shrink-0">
        <SegmentedControl
          ariaLabel="Tartib usuli"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'nearest', label: "Eng yaqin yo'l" },
            { value: 'debt', label: "Qarz bo'yicha" },
          ]}
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
        />
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          compact
          title="Marshrut bo'sh"
          hint="Ro'yxatdan yoki tashkilot kartasidan «Marshrutga qo'shish» tugmasini bosing."
        />
      ) : (
        <>
          <ol className="divide-y divide-eko-line overflow-y-auto">
            {ordered.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2 pl-3 pr-1 min-h-[56px]">
                <span className="w-6 h-6 rounded-full bg-eko-surface-3 text-eko-text eko-text-xs font-semibold flex items-center justify-center shrink-0 eko-num">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onFocus(p)}
                  className="flex-1 min-w-0 text-left py-2 min-h-[44px]"
                  aria-label={`${p.name} — xaritada ko'rsatish`}
                >
                  <span className="block eko-text-base font-medium text-eko-text truncate">{p.name}</span>
                  {(p.debtAmount ?? 0) > 0 && (
                    <span className="block eko-text-xs text-eko-muted eko-num">{f.money(p.debtAmount!)} so'm qarz</span>
                  )}
                </button>
                <IconButton
                  label="Marshrutdan olib tashlash"
                  variant="ghost"
                  onClick={() => onRemove(p.id)}
                  icon={<X className="w-4 h-4" aria-hidden />}
                />
              </li>
            ))}
          </ol>

          <div className="px-3 py-3 border-t border-eko-line shrink-0 space-y-3">
            <p className="eko-text-sm text-eko-text-2">
              ≈ <b className="text-eko-text eko-num">{km.toFixed(1)} km</b> · ~{min} daqiqa
              <span className="text-eko-muted"> (yo'l + to'xtashlar)</span>
            </p>
            {!userLoc && (
              <Banner tone="info">Joylashuvni yoqsangiz, tartib o'zingizdan boshlanadi.</Banner>
            )}
            <div className="flex gap-2">
              <LinkButton
                href={yandexRouteUrl(ordered, userLoc)}
                target="_blank" rel="noopener noreferrer"
                variant="secondary" className="flex-1"
                icon={<Navigation className="w-4 h-4" aria-hidden />}
              >
                Yandex
              </LinkButton>
              <LinkButton
                href={googleRouteUrl(ordered, userLoc)}
                target="_blank" rel="noopener noreferrer"
                variant="secondary" className="flex-1"
                icon={<Navigation className="w-4 h-4" aria-hidden />}
              >
                Google
              </LinkButton>
            </div>
            <Button variant="ghost" block icon={<Trash2 className="w-4 h-4" aria-hidden />} onClick={onClear}>
              Marshrutni tozalash
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
