import { ReactNode, KeyboardEvent } from 'react'
import { cx } from './cx'

export interface TabItem<T extends string = string> {
  value: T
  label: ReactNode
  count?: number
  disabled?: boolean
}

/**
 * Underline tablar (bo'limlar orasida: Umumiy / To'lovlar / Tarix).
 * Ikki-uch rejim almashtirgich uchun `SegmentedControl` ishlating.
 * Klaviatura: ←/→/Home/End. Mobilda 44px, o'ralmaydi — gorizontal skroll.
 * Panel `role="tabpanel"` va `aria-labelledby={`${idPrefix}-${value}`}` ni sahifa o'zi qo'yadi.
 */
export function Tabs<T extends string>({
  value, onChange, items, idPrefix = 'tab', ariaLabel, className,
}: {
  value: T
  onChange: (v: T) => void
  items: TabItem<T>[]
  idPrefix?: string
  ariaLabel?: string
  className?: string
}) {
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const enabled = items.filter(i => !i.disabled)
    const idx = enabled.findIndex(i => i.value === value)
    let n = -1
    if (e.key === 'ArrowRight') n = (idx + 1) % enabled.length
    else if (e.key === 'ArrowLeft') n = (idx - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = enabled.length - 1
    if (n < 0) return
    e.preventDefault()
    onChange(enabled[n].value)
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-${enabled[n].value}`)?.focus())
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className={cx('flex gap-5 border-b border-eko-line overflow-x-auto', className)}>
      {items.map(it => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            id={`${idPrefix}-${it.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={it.disabled}
            onClick={() => onChange(it.value)}
            onKeyDown={onKey}
            className={cx(
              'relative -mb-px inline-flex items-center gap-1.5 h-11 md:h-10 border-b-2 whitespace-nowrap eko-text-base transition-colors',
              active
                ? 'border-eko-text text-eko-text font-medium'
                : 'border-transparent text-eko-muted hover:text-eko-text disabled:text-eko-subtle',
            )}
          >
            {it.label}
            {it.count != null && <span className="eko-text-xs eko-num text-eko-muted">{it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
