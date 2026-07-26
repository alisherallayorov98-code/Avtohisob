import { ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from './cx'
import { IconButton } from './Button'

export type ModalSize = 'sm' | 'md' | 'lg'

const SIZES: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
}

export interface ModalProps {
  open?: boolean
  onClose: () => void
  title: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  size?: ModalSize
  /** Pastdagi amallar qatori */
  footer?: ReactNode
  children: ReactNode
  /** Fon bosilganda yopilmasin (ma'lumot kiritilayotgan formalar uchun) */
  disableBackdropClose?: boolean
}

/**
 * Modal oyna.
 *
 * Mobilda pastdan chiqadigan varaq (bottom sheet) sifatida ko'rinadi —
 * inspektor telefonni bir qo'lda ushlab turadi, oynaning pastki qismi
 * bosh barmoqqa yaqin bo'lishi kerak. Kengroq ekranda markazda.
 *
 * A11y: Esc bilan yopiladi, ochilganda fon aylanmaydi, fokus ichkariga
 * ko'chadi va yopilganda avvalgi elementga qaytadi.
 */
export function Modal({
  open = true, onClose, title, hint, icon, size = 'md', footer, children, disableBackdropClose,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey)

    // Fon aylanmasin — modal ustida skroll qilganda sahifa siljib ketmasligi uchun
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Fokusni ichkariga ko'chiramiz
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    )
    first?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="eko-scope fixed inset-0 z-[1000] flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={disableBackdropClose ? undefined : (e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" aria-hidden />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative w-full bg-eko-surface shadow-eko-lg flex flex-col',
          'rounded-t-2xl sm:rounded-eko-lg',
          'max-h-[92vh] sm:max-h-[85vh]',
          SIZES[size],
          // Mobilda pastdan sirg'alib chiqadi
          'animate-[eko-sheet_.18s_ease-out]',
        )}
      >
        {/* Mobil "tortish" chizig'i — pastdan chiqqan varaq ekanini bildiradi */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <span className="w-9 h-1 rounded-full bg-eko-surface-3" />
        </div>

        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-eko-line shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            {icon && <span className="text-eko-muted mt-0.5 shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-eko-text leading-tight truncate">{title}</h3>
              {hint && <p className="text-xs text-eko-muted mt-0.5">{hint}</p>}
            </div>
          </div>
          <IconButton label="Yopish" variant="ghost" size="sm" onClick={onClose} icon={<X className="w-4 h-4" />} />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-eko-line shrink-0 flex items-center gap-2 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
