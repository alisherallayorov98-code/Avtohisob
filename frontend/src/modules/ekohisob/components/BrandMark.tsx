import { cx } from '../ui'

/** Mahsulot belgisi: tomchi-barg (EkoHisobApp sidebar'idagi bilan bir xil). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('text-eko-accent', className)} aria-hidden fill="none">
      <path d="M12 2.5c3.9 4.3 6.2 7.5 6.2 10.8a6.2 6.2 0 0 1-12.4 0C5.8 10 8.1 6.8 12 2.5z" fill="currentColor" />
      <path d="M12 21V11m0 4 2.6-2.6M12 13.2 9.6 10.8" stroke="rgb(var(--eko-canvas))" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
