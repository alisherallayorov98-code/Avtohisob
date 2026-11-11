import { Layers, Flame, Tag, Download, Crosshair } from 'lucide-react'
import { IconButton, cx } from '../../ui'
import { LEVEL_LABEL, levelColor, DebtLevel } from './mapIcons'

interface ToggleDef {
  key: string
  label: string
  icon: React.ReactNode
  pressed?: boolean
  loading?: boolean
  onClick: () => void
}

/**
 * Xarita ustidagi 44px IconButton guruhi. Faol holat — neytral (surface-3),
 * rangning ma'nosi yo'q. Har tugmada aria-label + tooltip (title).
 */
export function MapToolbar({
  satellite, onSatellite, heatmap, onHeatmap, labels, onLabels, onExport, onLocate, locating, className,
}: {
  satellite: boolean; onSatellite: () => void
  heatmap: boolean; onHeatmap: () => void
  labels: boolean; onLabels: () => void
  onExport: () => void
  onLocate: () => void; locating: boolean
  className?: string
}) {
  const items: ToggleDef[] = [
    { key: 'sat', label: "Sun'iy yo'ldosh qatlami", icon: <Layers className="w-5 h-5" />, pressed: satellite, onClick: onSatellite },
    { key: 'heat', label: 'Qarz zonalari', icon: <Flame className="w-5 h-5" />, pressed: heatmap, onClick: onHeatmap },
    { key: 'labels', label: "Nomlarni ko'rsatish", icon: <Tag className="w-5 h-5" />, pressed: labels, onClick: onLabels },
    { key: 'export', label: 'Qarzdorlarni yuklab olish', icon: <Download className="w-5 h-5" />, onClick: onExport },
    { key: 'locate', label: 'Joylashuvim', icon: <Crosshair className="w-5 h-5" />, loading: locating, onClick: onLocate },
  ]
  return (
    <div className={cx('flex flex-col gap-1.5', className)} role="group" aria-label="Xarita qatlamlari va amallar">
      {items.map(it => (
        <IconButton
          key={it.key}
          label={it.label}
          variant="secondary"
          size="lg"
          aria-pressed={it.pressed}
          loading={it.loading}
          className={cx('!w-11 !h-11 shadow-eko-lg', it.pressed && '!bg-eko-surface-3 !border-eko-line-strong')}
          onClick={it.onClick}
          icon={it.icon}
        />
      ))}
    </div>
  )
}

/** Ixcham afsona (token ranglari). */
export function MapLegend({ className }: { className?: string }) {
  const levels: DebtLevel[] = ['current', 'warning', 'overdue', 'critical']
  return (
    <ul
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 bg-eko-surface/95 border border-eko-line rounded-eko px-2.5 py-1.5 eko-text-xs text-eko-text-2',
        className,
      )}
      aria-label="Xarita belgilari"
    >
      {levels.map(lv => (
        <li key={lv} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: levelColor(lv) }} aria-hidden />
          {LEVEL_LABEL[lv]}
        </li>
      ))}
      <li className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="w-2.5 h-2.5 rounded-[3px] bg-eko-muted" aria-hidden /> Talon
      </li>
      <li className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="w-2.5 h-2.5 rounded-full bg-eko-warn" aria-hidden /> Chala
      </li>
    </ul>
  )
}
