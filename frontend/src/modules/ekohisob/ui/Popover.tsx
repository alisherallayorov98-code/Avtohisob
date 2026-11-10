import {
  ReactNode, Ref, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'
import { useOutsideClick } from './hooks'
import { portalProps } from './theme'

export interface PopoverTriggerProps {
  ref: Ref<any>
  onClick: () => void
  'aria-expanded': boolean
  'aria-haspopup': 'menu' | 'dialog'
  'aria-controls'?: string
}

export interface PopoverProps {
  /** Render-prop: berilgan propsni tugmaga yoyib yuboring `<Button {...p}>` */
  trigger: (p: PopoverTriggerProps) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  /** Panel kengligi (px). Berilmasa — kontentga qarab, min 180 */
  width?: number
  /** `menu` yoki `dialog` (aria) */
  role?: 'menu' | 'dialog'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  panelClassName?: string
}

/**
 * Suzuvchi panel. Trigger ostida (joy yetmasa tepasida) `position: fixed` bilan
 * portalda chiqadi — `overflow: hidden` konteynerlar (jadval) kesmaydi.
 * Esc yopadi va fokusni triggerga qaytaradi; tashqariga bosish yopadi.
 */
export function Popover({
  trigger, children, align = 'start', width, role = 'dialog', open: openProp, onOpenChange, panelClassName,
}: PopoverProps) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = useCallback((v: boolean) => {
    if (openProp === undefined) setOpenState(v)
    onOpenChange?.(v)
  }, [openProp, onOpenChange])

  const id = useId()
  const triggerRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const place = useCallback(() => {
    const t = triggerRef.current
    const p = panelRef.current
    if (!t) return
    const r = t.getBoundingClientRect()
    const pw = width ?? Math.max(180, p?.offsetWidth ?? 180)
    const ph = p?.offsetHeight ?? 0
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = align === 'end' ? r.right - pw : r.left
    left = Math.max(8, Math.min(left, vw - pw - 8))
    let top = r.bottom + 4
    if (ph && top + ph > vh - 8 && r.top - ph - 4 > 8) top = r.top - ph - 4
    setPos({ top, left })
  }, [align, width])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const re = () => place()
    window.addEventListener('resize', re)
    window.addEventListener('scroll', re, true)
    const raf = requestAnimationFrame(re)
    return () => {
      window.removeEventListener('resize', re)
      window.removeEventListener('scroll', re, true)
      cancelAnimationFrame(raf)
    }
  }, [open, place])

  useOutsideClick([triggerRef as React.RefObject<HTMLElement>, panelRef], () => setOpen(false), open)

  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus() }, [setOpen])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab' && role === 'menu') {
      setOpen(false)
    }
  }

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen(!open),
        'aria-expanded': open,
        'aria-haspopup': role,
        'aria-controls': open ? id : undefined,
      })}
      {open && createPortal(
        <div className="eko-scope" {...portalProps()}>
          <div
            ref={panelRef}
            id={id}
            role={role}
            onKeyDown={onKeyDown}
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width,
              minWidth: width ? undefined : 180,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className={cx(
              'eko-z-dropdown bg-eko-surface text-eko-text border border-eko-line rounded-eko-lg shadow-eko-lg',
              'max-h-[70dvh] overflow-auto',
              panelClassName,
            )}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// ── Menu ─────────────────────────────────────────────────────────────────────

export interface MenuItem {
  key?: string
  label: ReactNode
  icon?: ReactNode
  onSelect?: () => void
  /** Xavfli amal — qizil */
  danger?: boolean
  disabled?: boolean
  /** Yuqorida ajratuvchi chiziq */
  divider?: boolean
}

export interface MenuProps {
  trigger: PopoverProps['trigger']
  items: MenuItem[]
  align?: 'start' | 'end'
  width?: number
}

/**
 * Menyu (kebab / "Yana"). Klaviatura: ↑/↓/Home/End, Enter tanlaydi, Esc yopadi.
 * Element balandligi mobilda 44px.
 */
export function Menu({ trigger, items, align = 'end', width }: MenuProps) {
  return (
    <Popover trigger={trigger} align={align} width={width} role="menu">
      {(close) => <MenuList items={items} close={close} />}
    </Popover>
  )
}

function MenuList({ items, close }: { items: MenuItem[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const enabled = () =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])

  useEffect(() => { enabled()[0]?.focus() }, [])

  function onKey(e: KeyboardEvent) {
    const els = enabled()
    if (!els.length) return
    const i = els.indexOf(document.activeElement as HTMLElement)
    let n = -1
    if (e.key === 'ArrowDown') n = (i + 1) % els.length
    else if (e.key === 'ArrowUp') n = (i - 1 + els.length) % els.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = els.length - 1
    if (n >= 0) { e.preventDefault(); els[n]?.focus() }
  }

  return (
    <div ref={ref} onKeyDown={onKey} className="py-1">
      {items.map((it, idx) => (
        <div key={it.key ?? idx}>
          {it.divider && idx > 0 && <div className="my-1 h-px bg-eko-line" role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => { close(); it.onSelect?.() }}
            className={cx(
              'w-full flex items-center gap-2.5 px-3 h-11 md:h-9 text-left eko-text-base',
              'hover:bg-eko-surface-2 focus:bg-eko-surface-2 focus:outline-none disabled:text-eko-muted disabled:cursor-not-allowed',
              it.danger ? 'text-eko-danger' : 'text-eko-text',
            )}
          >
            {it.icon && <span className="shrink-0 text-eko-muted" aria-hidden>{it.icon}</span>}
            <span className="min-w-0 truncate">{it.label}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
