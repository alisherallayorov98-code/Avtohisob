import { ReactNode } from 'react'
import { AlertTriangle, Info, CheckCircle2, XCircle, RotateCcw, Inbox } from 'lucide-react'
import { cx } from './cx'
import { Button } from './Button'

// ── Bo'sh holat ──────────────────────────────────────────────────────────────

/**
 * Bo'sh holat.
 *
 * Qoida: "Ma'lumot yo'q" deb qo'yish yetarli emas — foydalanuvchi NIMA
 * qilishini bilishi kerak. Shuning uchun har bo'sh holatda amal taklif qilinadi
 * (yoki nega bo'shligi tushuntiriladi).
 */
export function EmptyState({
  icon, title, hint, action, tone = 'neutral', className,
}: {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
  /** `success` — bo'sh bo'lishi YAXSHI holat (masalan: qarzdor yo'q) */
  tone?: 'neutral' | 'success'
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center text-center px-6 py-12', className)}>
      <div
        className={cx(
          'w-12 h-12 rounded-full flex items-center justify-center mb-3',
          tone === 'success' ? 'bg-eko-success-soft text-eko-success' : 'bg-eko-surface-2 text-eko-subtle',
        )}
      >
        {icon ?? (tone === 'success' ? <CheckCircle2 className="w-6 h-6" /> : <Inbox className="w-6 h-6" />)}
      </div>
      <p className="text-sm font-medium text-eko-text">{title}</p>
      {hint && <p className="text-xs text-eko-muted mt-1 max-w-xs leading-relaxed">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Xato holati ──────────────────────────────────────────────────────────────

/** Xato + qayta urinish. Ilgari xatolar faqat toast'da chiqib yo'qolardi. */
export function ErrorState({
  title = 'Ma\'lumotni yuklab bo\'lmadi', hint, onRetry,
}: {
  title?: string
  hint?: string
  onRetry?: () => void
}) {
  return (
    <EmptyState
      icon={<XCircle className="w-6 h-6 text-eko-danger" />}
      title={title}
      hint={hint ?? 'Internet aloqasini tekshiring va qayta urinib ko\'ring.'}
      action={onRetry && (
        <Button variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={onRetry}>
          Qayta urinish
        </Button>
      )}
    />
  )
}

// ── Skeleton (yuklanish) ─────────────────────────────────────────────────────

/**
 * Yuklanish skeleti.
 *
 * Nega markazdagi spinner emas: skeleton kontent qayerda paydo bo'lishini
 * oldindan ko'rsatadi — sahifa "sakramaydi" va kutish qisqaroq tuyuladi.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('eko-shimmer rounded', className)} />
}

/** Ro'yxat skeleti — n ta qator. */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('divide-y divide-eko-line', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-20 rounded-eko" />
        </div>
      ))}
    </div>
  )
}

// ── Banner (sahifa darajasidagi xabar) ───────────────────────────────────────

export type BannerTone = 'info' | 'warn' | 'danger' | 'success'

const BANNER_TONES: Record<BannerTone, { box: string; icon: ReactNode }> = {
  info:    { box: 'bg-eko-info-soft border-eko-info-line text-eko-info',       icon: <Info className="w-4 h-4" /> },
  warn:    { box: 'bg-eko-warn-soft border-eko-warn-line text-eko-warn',       icon: <AlertTriangle className="w-4 h-4" /> },
  danger:  { box: 'bg-eko-danger-soft border-eko-danger-line text-eko-danger', icon: <XCircle className="w-4 h-4" /> },
  success: { box: 'bg-eko-success-soft border-eko-success-line text-eko-success', icon: <CheckCircle2 className="w-4 h-4" /> },
}

export function Banner({
  tone = 'info', children, action, className,
}: {
  tone?: BannerTone
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  const cfg = BANNER_TONES[tone]
  return (
    <div className={cx('flex items-start gap-2.5 px-4 py-3 rounded-eko-lg border text-sm', cfg.box, className)}>
      <span className="mt-0.5 shrink-0">{cfg.icon}</span>
      <div className="flex-1 min-w-0 leading-relaxed">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
