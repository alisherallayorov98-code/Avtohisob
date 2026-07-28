import { Route, X, Navigation, Trash2 } from 'lucide-react'
import {
  RoutePoint, LatLng, totalKm, estimateMinutes, yandexRouteUrl, googleRouteUrl,
} from '../../lib/routePlanner'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')

/**
 * Marshrut paneli — xaritada tanlangan tashkilotlarning yurish tartibi.
 *
 * Saqlanmaydi (sessiya ichida): marshrut odatda bir martalik, uni jadvalda
 * saqlash foydasiz murakkablik bo'lardi. Tayyor tartib Yandex/Google
 * navigatorga bir bosishda uzatiladi.
 */
export default function RoutePanel({
  ordered, mode, onModeChange, onRemove, onClear, onFocus, onClose, userLoc,
}: {
  /** Tartiblangan nuqtalar (orderNearest yoki orderByDebt natijasi) */
  ordered: RoutePoint[]
  mode: 'nearest' | 'debt'
  onModeChange: (m: 'nearest' | 'debt') => void
  onRemove: (id: string) => void
  onClear: () => void
  /** Nuqta nomiga bosilganda xarita o'sha yerga uchadi */
  onFocus: (p: RoutePoint) => void
  onClose: () => void
  userLoc: LatLng | null
}) {
  const km = totalKm(ordered, userLoc)
  const min = estimateMinutes(km, ordered.length)

  return (
    <div className="absolute top-16 left-3 z-[1000] bg-white rounded-xl shadow-lg border border-gray-200 w-72 max-h-[60vh] flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 shrink-0">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          <Route className="w-4 h-4 text-blue-600" /> Marshrut ({ordered.length})
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Panelni yopish">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tartib usuli */}
      <div className="flex gap-1 px-3 py-2 border-b border-gray-100 shrink-0">
        <button
          onClick={() => onModeChange('nearest')}
          className={`flex-1 px-2 py-1 text-[11px] rounded-md font-medium transition-colors ${
            mode === 'nearest' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          title={userLoc ? 'Joylashuvingizdan boshlab eng yaqin tartib' : 'Birinchi nuqtadan boshlab eng yaqin tartib'}
        >
          Eng yaqin yo'l
        </button>
        <button
          onClick={() => onModeChange('debt')}
          className={`flex-1 px-2 py-1 text-[11px] rounded-md font-medium transition-colors ${
            mode === 'debt' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          title="Eng katta qarzdor birinchi"
        >
          Qarz bo'yicha
        </button>
      </div>

      {ordered.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-gray-400">
          Markerni bosib «Marshrutga qo'shish» tugmasidan foydalaning
        </p>
      ) : (
        <>
          <div className="overflow-y-auto divide-y divide-gray-50">
            {ordered.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 group">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <button onClick={() => onFocus(p)} className="flex-1 min-w-0 text-left" title="Xaritada ko'rsatish">
                  <p className="text-xs font-medium text-gray-800 truncate">{p.name}</p>
                  {(p.debtAmount ?? 0) > 0 && (
                    <p className="text-[10px] text-red-600">{fmt(p.debtAmount!)} so'm qarz</p>
                  )}
                </button>
                <button
                  onClick={() => onRemove(p.id)}
                  className="p-1 text-gray-300 hover:text-red-500 shrink-0"
                  title="Marshrutdan olib tashlash"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Yig'ma: masofa va taxminiy vaqt */}
          <div className="px-3 py-2 border-t border-gray-100 text-[11px] text-gray-500 shrink-0">
            ≈ <b className="text-gray-800">{km.toFixed(1)} km</b> · ~{min} daqiqa
            <span className="text-gray-400"> (yo'l + to'xtashlar)</span>
            {!userLoc && (
              <span className="block text-amber-600 mt-0.5">
                «Men shu yerdaman»ni bossangiz, tartib joylashuvingizdan boshlanadi
              </span>
            )}
          </div>

          {/* Navigatorga uzatish */}
          <div className="flex gap-1.5 px-3 pb-3 pt-1 shrink-0">
            <a
              href={yandexRouteUrl(ordered, userLoc)}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1 px-2 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[11px] font-semibold"
            >
              <Navigation className="w-3 h-3" /> Yandex
            </a>
            <a
              href={googleRouteUrl(ordered, userLoc)}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1 px-2 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-semibold"
            >
              <Navigation className="w-3 h-3" /> Google
            </a>
            <button
              onClick={onClear}
              className="px-2 py-2 border border-gray-200 text-gray-400 hover:text-red-500 rounded-lg"
              title="Marshrutni tozalash"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
