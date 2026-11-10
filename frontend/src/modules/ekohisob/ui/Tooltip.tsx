import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsTouch } from './hooks'
import { portalProps } from './theme'

/**
 * Tooltip. Sichqoncha/fokus bilan chiqadi (Esc yopadi). Sensorli qurilmada
 * (hover yo'q) popup o'rniga `title` atributi — tasodifiy chiqib qolmaydi.
 * MUHIM matn tooltip'ga yashirilmasin: u faqat qo'shimcha izoh.
 */
export function Tooltip({
  content, children, side = 'top', delay = 300, className,
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'right'
  delay?: number
  className?: string
}) {
  const touch = useIsTouch()
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number>()
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (touch || content == null || content === '') {
    return (
      <span className={className ?? 'inline-flex'} title={typeof content === 'string' ? content : undefined}>
        {children}
      </span>
    )
  }

  function show() {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      if (side === 'right') setPos({ x: r.right + 8, y: r.top + r.height / 2 })
      else setPos({ x: r.left + r.width / 2, y: side === 'top' ? r.top - 6 : r.bottom + 6 })
    }, delay)
  }
  function hide() { window.clearTimeout(timer.current); setPos(null) }

  const transform =
    side === 'top' ? 'translate(-50%, -100%)' : side === 'bottom' ? 'translate(-50%, 0)' : 'translate(0, -50%)'

  return (
    <span
      ref={ref}
      className={className ?? 'inline-flex'}
      aria-describedby={pos ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => { if (e.key === 'Escape') hide() }}
    >
      {children}
      {pos && createPortal(
        <div className="eko-scope" {...portalProps()}>
          <div
            id={id}
            role="tooltip"
            style={{ position: 'fixed', left: pos.x, top: pos.y, transform, pointerEvents: 'none' }}
            className="eko-z-tooltip max-w-[260px] px-2 py-1 rounded-[var(--eko-radius-sm)] bg-eko-text text-eko-canvas eko-text-xs"
          >
            {content}
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}
