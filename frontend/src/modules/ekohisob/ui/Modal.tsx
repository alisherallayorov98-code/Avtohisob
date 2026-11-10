import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from './cx'
import { FOCUSABLE } from './hooks'
import { portalProps } from './theme'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-[900px]',
}

export interface ModalProps {
  open?: boolean
  onClose: () => void
  title: ReactNode
  hint?: ReactNode
  /** @deprecated Sarlavha ikonkasi ko'rsatilmaydi. ConfirmDialog xavf belgisini o'zi ko'rsatadi. */
  icon?: ReactNode
  size?: ModalSize
  /** Pastdagi amallar qatori (doim ko'rinadi, kontent skroll qilinadi) */
  footer?: ReactNode
  children: ReactNode
  /** Fon bosilganda yopilmasin (ma'lumot kiritilayotgan formalar uchun) */
  disableBackdropClose?: boolean
}

// ── Stack: ichma-ich modallar uchun ──────────────────────────────────────────
// Faqat eng yuqori modal Esc/Tab'ga javob beradi; z-index har biriga +1.
const stack: symbol[] = []
let lockCount = 0
let prevOverflow = ''

function lockScroll() {
  if (lockCount++ === 0) {
    prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
}
function unlockScroll() {
  if (--lockCount === 0) document.body.style.overflow = prevOverflow
}

/**
 * Modal oyna. Mobilda pastdan chiqadigan varaq (safe-area, 100dvh), kengroq
 * ekranda markazda.
 *
 * A11y: role=dialog + aria-modal + aria-labelledby; Tab/Shift+Tab modal
 * ichida sikl qiladi; ochilganda fokus ichkariga (`data-autofocus` yoki
 * kontentdagi birinchi maydon), yopilganda oldingi elementga qaytadi;
 * Esc yopadi; fon skrolli qulflanadi.
 */
export function Modal({
  open = true, onClose, title, hint, size = 'md', footer, children, disableBackdropClose,
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!open) return
    const token = Symbol('modal')
    stack.push(token)
    setLevel(stack.length - 1)
    const restore = document.activeElement as HTMLElement | null
    lockScroll()

    const panel = panelRef.current
    const target =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel
    target?.focus()

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== token) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) { e.preventDefault(); panel.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.indexOf(token)
      if (i >= 0) stack.splice(i, 1)
      unlockScroll()
      restore?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="eko-scope fixed inset-0 flex items-end sm:items-center justify-center sm:p-4"
      style={{ zIndex: `calc(var(--eko-z-modal) + ${level})` as unknown as number }}
      {...portalProps()}
      onMouseDown={disableBackdropClose ? undefined : (e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 eko-overlay" aria-hidden />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative w-full bg-eko-surface text-eko-text shadow-eko-lg flex flex-col outline-none',
          'rounded-t-[16px] sm:rounded-eko-lg border border-eko-line',
          'max-h-[92dvh] sm:max-h-[85dvh]',
          SIZES[size],
          'animate-[eko-sheet_.18s_ease-out]',
        )}
      >
        {/* Mobil "tortish" chizig'i */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0" aria-hidden>
          <span className="w-9 h-1 rounded-full bg-eko-surface-3" />
        </div>

        <div className="flex items-start justify-between gap-3 pl-5 pr-2 py-2 sm:py-3 border-b border-eko-line shrink-0">
          <div className="min-w-0 py-1.5">
            <h2 id={titleId} className="eko-text-md font-semibold text-eko-text truncate">{title}</h2>
            {hint && <p className="eko-text-xs text-eko-muted mt-0.5">{hint}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Yopish"
            title="Yopish"
            className="shrink-0 w-11 h-11 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-eko text-eko-muted hover:text-eko-text hover:bg-eko-surface-2"
          >
            <X className="w-5 h-5 sm:w-4 sm:h-4" aria-hidden />
          </button>
        </div>

        <div ref={bodyRef} className="flex-1 overflow-y-auto overscroll-contain">{children}</div>

        {footer && (
          <div className="sticky bottom-0 bg-eko-surface px-5 pt-3.5 border-t border-eko-line shrink-0 flex items-center gap-2 eko-safe-bottom">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
