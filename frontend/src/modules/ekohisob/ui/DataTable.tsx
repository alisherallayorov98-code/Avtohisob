import { ReactNode, KeyboardEvent } from 'react'
import { cx } from './cx'
import { useIsMobile } from './hooks'
import { EmptyState, ErrorState, SkeletonTable, Skeleton } from './States'
import { Pagination, PaginationProps } from './Pagination'
import { num } from './format'

export interface Column<T> {
  /** Noyob kalit; `render` bo'lmasa `row[key]` ko'rsatiladi */
  key: string
  title: ReactNode
  render?: (row: T, index: number) => ReactNode
  /** `right` — raqamlar uchun: avtomatik tabular-nums va o'ngga tekislash */
  align?: 'left' | 'right' | 'center'
  /** CSS kenglik: 120 yoki '20%' */
  width?: number | string
  /**
   * Mobil (<md) kartada: `primary` — karta sarlavhasi, `secondary` — "yorliq: qiymat"
   * qatori, `hide` — ko'rsatilmaydi. Berilmasa: birinchi ustun primary, qolganlari secondary.
   */
  mobile?: 'hide' | 'primary' | 'secondary'
  /** Jadvalda ko'rinmasin (faqat mobil kartada) — kamdan-kam kerak */
  hideOnDesktop?: boolean
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string | number
  /** Qator bosilganda (klaviatura: Enter). Ichidagi tugmalar bosilishi qatorga o'tmaydi. */
  onRowClick?: (row: T) => void
  /** Tanlangan qator kaliti (rowKey qaytargan) — `--active` fon */
  selectedKey?: string | number | null
  loading?: boolean
  /** Xato matni — jadval o'rniga ErrorState */
  error?: string | null
  onRetry?: () => void
  /** Bo'sh holat. ReactNode berilsa o'zi chiqadi; obyekt — EmptyState propslari */
  empty?: ReactNode | { title: string; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }
  /** Jami qatori: `{ [column.key]: qiymat }` (masalan `{ name: 'Jami', amount: f.money(x) }`) */
  footer?: Record<string, ReactNode>
  /** Qator amallari (RowActions). Desktopda oxirgi ustun, mobilda karta pastida. */
  rowActions?: (row: T) => ReactNode
  /** Sahifalash — jadval ostida `Pagination` chiqadi */
  pagination?: PaginationProps
  /** Qatorlar balandligi cheklanadi, sarlavha yopishib turadi (px yoki CSS) */
  maxHeight?: number | string
  /** Skeleton qatorlar soni */
  skeletonRows?: number
  'aria-label'?: string
  className?: string
}

function cell(v: unknown, align?: string): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-eko-muted">—</span>
  if (typeof v === 'number') return align === 'right' ? num(v) : String(v)
  return v as ReactNode
}

function emptyNode(empty: DataTableProps<unknown>['empty']): ReactNode {
  // ReactNode (element/matn) — o'zi; oddiy obyekt {title,...} — EmptyState sozlamasi
  if (empty && typeof empty === 'object' && 'title' in (empty as object) && !('$$typeof' in (empty as object))) {
    const e = empty as { title: string; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }
    return <EmptyState title={e.title} hint={e.hint} action={e.action} icon={e.icon} />
  }
  return (empty as ReactNode) ?? <EmptyState title="Ma'lumot yo'q" />
}

/**
 * Jadval: sarlavha sentence-case 12px kulrang (uppercase va zebra YO'Q),
 * raqamlar o'ngda tabular. Skeleton / bo'sh / xato holatlari o'rnatilgan.
 * Mobilda (<md) kartalar ro'yxatiga o'tadi.
 */
export function DataTable<T>({
  columns, rows, rowKey, onRowClick, selectedKey, loading, error, onRetry, empty, footer,
  rowActions, pagination, maxHeight, skeletonRows = 6, className, ...aria
}: DataTableProps<T>) {
  const mobile = useIsMobile()
  const cols = columns.filter(c => !(mobile ? false : c.hideOnDesktop))

  let body: ReactNode
  if (error) {
    body = <ErrorState title={error} onRetry={onRetry} />
  } else if (loading) {
    body = <SkeletonTable rows={skeletonRows} cols={Math.min(cols.length, 5)} />
  } else if (rows.length === 0) {
    body = emptyNode(empty)
  } else if (mobile) {
    body = <CardList {...{ columns, rows, rowKey, onRowClick, selectedKey, rowActions, footer }} />
  } else {
    body = (
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-collapse eko-text-base" aria-label={aria['aria-label']}>
          <thead>
            <tr>
              {cols.map(c => (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width }}
                  className={cx(
                    'sticky top-0 eko-z-sticky bg-eko-surface px-4 py-2.5 eko-text-xs font-medium text-eko-muted',
                    'border-b border-eko-line whitespace-nowrap',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  )}
                >
                  {c.title}
                </th>
              ))}
              {rowActions && <th scope="col" className="sticky top-0 eko-z-sticky bg-eko-surface border-b border-eko-line w-px"><span className="sr-only">Amallar</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const k = rowKey(row, i)
              const selected = selectedKey != null && selectedKey === k
              const clickable = !!onRowClick
              return (
                <tr
                  key={k}
                  aria-selected={selectedKey != null ? selected : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onRowClick!(row) : undefined}
                  onKeyDown={clickable ? (e: KeyboardEvent) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick!(row) }
                  } : undefined}
                  className={cx(
                    'border-b border-eko-line last:border-b-0',
                    selected && 'bg-eko-surface-2',
                    clickable && 'cursor-pointer hover:bg-eko-surface-2',
                  )}
                >
                  {cols.map(c => (
                    <td
                      key={c.key}
                      className={cx(
                        'px-4 py-3 align-middle text-eko-text',
                        c.align === 'right' && 'text-right eko-num',
                        c.align === 'center' && 'text-center',
                      )}
                    >
                      {cell(c.render ? c.render(row, i) : (row as Record<string, unknown>)[c.key], c.align)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="px-2 py-1.5 align-middle text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {rowActions(row)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          {footer && (
            <tfoot>
              <tr className="border-t border-eko-line-strong">
                {cols.map(c => (
                  <td
                    key={c.key}
                    className={cx(
                      'px-4 py-3 font-semibold text-eko-text',
                      c.align === 'right' && 'text-right eko-num',
                      c.align === 'center' && 'text-center',
                    )}
                  >
                    {footer[c.key] ?? ''}
                  </td>
                ))}
                {rowActions && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    )
  }

  return (
    <div className={className}>
      {body}
      {pagination && !error && !loading && rows.length > 0 && (
        <Pagination {...pagination} className="border-t border-eko-line px-4 py-2" />
      )}
      {pagination && loading && <div className="px-4 py-3 border-t border-eko-line"><Skeleton className="h-4 w-32" /></div>}
    </div>
  )
}

// ── Mobil kartalar ──────────────────────────────────────────────────────────

function CardList<T>({
  columns, rows, rowKey, onRowClick, selectedKey, rowActions, footer,
}: Pick<DataTableProps<T>, 'columns' | 'rows' | 'rowKey' | 'onRowClick' | 'selectedKey' | 'rowActions' | 'footer'>) {
  const visible = columns.filter(c => c.mobile !== 'hide')
  const primary = visible.find(c => c.mobile === 'primary') ?? visible[0]
  const secondary = visible.filter(c => c !== primary)

  return (
    <ul className="divide-y divide-eko-line">
      {rows.map((row, i) => {
        const k = rowKey(row, i)
        const selected = selectedKey != null && selectedKey === k
        const clickable = !!onRowClick
        const val = (c: Column<T>) => cell(c.render ? c.render(row, i) : (row as Record<string, unknown>)[c.key], c.align)
        return (
          <li key={k} className={cx(selected && 'bg-eko-surface-2')}>
            <div
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onRowClick!(row) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onRowClick!(row) } : undefined}
              className={cx('px-4 py-3 min-h-[44px]', clickable && 'cursor-pointer active:bg-eko-surface-2')}
            >
              {primary && <div className="eko-text-md font-medium text-eko-text">{val(primary)}</div>}
              {secondary.length > 0 && (
                <dl className="mt-1.5 space-y-1">
                  {secondary.map(c => (
                    <div key={c.key} className="flex items-baseline justify-between gap-3 eko-text-sm">
                      <dt className="text-eko-muted shrink-0">{c.title}</dt>
                      <dd className={cx('text-eko-text text-right min-w-0', c.align === 'right' && 'eko-num')}>{val(c)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            {rowActions && <div className="px-3 pb-2 flex justify-end gap-1">{rowActions(row)}</div>}
          </li>
        )
      })}
      {footer && (
        <li className="px-4 py-3 border-t border-eko-line-strong">
          <dl className="space-y-1">
            {columns.filter(c => footer[c.key] != null && footer[c.key] !== '').map(c => (
              <div key={c.key} className="flex items-baseline justify-between gap-3 eko-text-sm font-semibold">
                <dt className="text-eko-muted font-normal">{c.title}</dt>
                <dd className="eko-num">{footer[c.key]}</dd>
              </div>
            ))}
          </dl>
        </li>
      )}
    </ul>
  )
}
