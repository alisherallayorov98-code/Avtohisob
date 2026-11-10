import { ReactNode, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { cx } from './cx'
import { Button } from './Button'
import { Modal } from './Modal'
import { Select, InputWithIcon } from './Field'
import { useIsMobile } from './hooks'

/** Faol filtr chipi: "Tuman: Chilonzor ×" */
export function FilterChip({ label, onRemove, className }: { label: ReactNode; onRemove?: () => void; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 pl-2.5 pr-1 min-h-[28px] rounded-full border border-eko-line-strong',
        'bg-eko-surface eko-text-xs text-eko-text',
        !onRemove && 'pr-2.5',
        className,
      )}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Filtrni olib tashlash"
          className="relative inline-flex items-center justify-center w-6 h-6 rounded-full text-eko-muted hover:text-eko-text hover:bg-eko-surface-2 before:absolute before:-inset-2.5 before:content-['']"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      )}
    </span>
  )
}

export interface FilterDef {
  key: string
  /** Chip va yorliq uchun: "Tuman" */
  label: string
  /** '' = filtr yo'q */
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  /** "Hamma" varianti yorlig'i (default: label bilan "Barcha …") */
  allLabel?: string
}

export interface FilterBarProps {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  filters?: FilterDef[]
  /** Qo'shimcha chiplar (masalan sana oralig'i) */
  chips?: { key: string; label: ReactNode; onRemove: () => void }[]
  /** Qo'shimcha boshqaruvlar (DateRange, MonthInput) — desktopda qatorda, mobilda "Filtrlar" varag'ida */
  children?: ReactNode
  /** "Tozalash" bosilganda. Berilmasa — barcha `filters` ni '' ga qaytaradi. */
  onClear?: () => void
  /** O'ng chetdagi amallar (Eksport) */
  actions?: ReactNode
  className?: string
}

/**
 * Filtr qatori: qidiruv + Select'lar + faol chiplar + "Tozalash".
 * Mobilda qidiruv va "Filtrlar (n)" tugmasi; Select'lar pastki varaqda.
 */
export function FilterBar({ search, filters = [], chips = [], children, onClear, actions, className }: FilterBarProps) {
  const mobile = useIsMobile()
  const [sheet, setSheet] = useState(false)

  const active = filters.filter(f => f.value !== '')
  const count = active.length + chips.length
  const clear = () => {
    if (onClear) onClear()
    else filters.forEach(f => f.value !== '' && f.onChange(''))
    chips.forEach(c => c.onRemove())
  }

  const selects = (stack: boolean) =>
    filters.map(f => (
      <div key={f.key} className={stack ? 'space-y-1.5' : undefined}>
        {stack && <label className="block eko-text-base font-medium text-eko-text">{f.label}</label>}
        <Select
          aria-label={f.label}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          className={stack ? undefined : 'w-auto min-w-[140px]'}
        >
          <option value="">{f.allLabel ?? `Barcha: ${f.label.toLowerCase()}`}</option>
          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>
    ))

  return (
    <div className={cx('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <div className="flex-1 min-w-[180px] max-w-md">
            <InputWithIcon
              icon={<Search className="w-4 h-4" />}
              aria-label={search.placeholder ?? 'Qidirish'}
              placeholder={search.placeholder ?? 'Qidirish…'}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
            />
          </div>
        )}
        {mobile ? (
          (filters.length > 0 || children) && (
            <Button icon={<SlidersHorizontal className="w-4 h-4" aria-hidden />} onClick={() => setSheet(true)}>
              Filtrlar{count > 0 ? ` (${count})` : ''}
            </Button>
          )
        ) : (
          <>
            {selects(false)}
            {children}
          </>
        )}
        {count > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>Tozalash</Button>
        )}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {count > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Faol filtrlar">
          {active.map(f => (
            <FilterChip
              key={f.key}
              label={<><span className="text-eko-muted">{f.label}:</span> {f.options.find(o => o.value === f.value)?.label ?? f.value}</>}
              onRemove={() => f.onChange('')}
            />
          ))}
          {chips.map(c => <FilterChip key={c.key} label={c.label} onRemove={c.onRemove} />)}
        </div>
      )}

      {mobile && (
        <Modal
          open={sheet}
          onClose={() => setSheet(false)}
          title="Filtrlar"
          footer={
            <>
              <Button variant="ghost" className="flex-1" onClick={() => { clear(); setSheet(false) }}>Tozalash</Button>
              <Button variant="primary" className="flex-1" onClick={() => setSheet(false)}>Tayyor</Button>
            </>
          }
        >
          <div className="p-5 space-y-4">
            {selects(true)}
            {children}
          </div>
        </Modal>
      )}
    </div>
  )
}
