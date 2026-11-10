/**
 * EkoHisob dizayn tizimi.
 *
 * Barcha ekranlar SHU yerdagi komponentlardan quriladi. Yangi ekran yozayotganda
 * `bg-white rounded-xl border...` kabi klasslarni qo'lda yozmang — kerakli
 * primitiv bo'lmasa, uni shu papkaga qo'shing. To'liq qo'llanma: ./README.md
 *
 * Tokenlar: ./tokens.css (CSS o'zgaruvchilari, `.eko-app` ichida amal qiladi)
 * Tailwind kalitlari: `eko-*` (tailwind.config.js) + `.eko-text-*`, `.eko-nav-*` klasslari.
 */

import './tokens.css'

export { cx } from './cx'
export { Button, IconButton, LinkButton, buttonClasses } from './Button'
export type { ButtonVariant, ButtonSize, ButtonProps, LinkButtonProps } from './Button'
export { Card, CardHeader, CardBody } from './Card'
export { Badge, DebtBadge, DebtDot, BillingBadge, STATUS_BADGE } from './Badge'
export type { BadgeTone, DebtLevel } from './Badge'
export { StatTile, StatRow } from './StatTile'
export type { StatTileProps, StatTone } from './StatTile'
export { Modal } from './Modal'
export type { ModalProps, ModalSize } from './Modal'
export { ConfirmProvider, useConfirm } from './ConfirmDialog'
export type { ConfirmOptions, ConfirmFn, ConfirmResult } from './ConfirmDialog'
export { EmptyState, ErrorState, Skeleton, SkeletonList, SkeletonTable, Banner } from './States'
export type { BannerTone } from './States'
export { Field, Input, Select, Textarea, InputWithIcon, Toggle } from './Field'
export type { FieldProps } from './Field'
export { PageHeader, Page, Toolbar, SegmentedControl } from './PageHeader'
export type { PageHeaderProps } from './PageHeader'
export { MonthInput } from './MonthInput'

// ── Yangi primitivlar ────────────────────────────────────────────────────────
export { DataTable } from './DataTable'
export type { Column, DataTableProps } from './DataTable'
export { Pagination } from './Pagination'
export type { PaginationProps } from './Pagination'
export { FilterBar, FilterChip } from './FilterBar'
export type { FilterBarProps, FilterDef } from './FilterBar'
export { RowActions } from './RowActions'
export type { RowActionsProps } from './RowActions'
export { Popover, Menu } from './Popover'
export type { PopoverProps, PopoverTriggerProps, MenuProps, MenuItem } from './Popover'
export { Tooltip } from './Tooltip'
export { SplitPane } from './SplitPane'
export type { SplitPaneProps } from './SplitPane'
export { DateInput, DateRange, isoToDisplay } from './DateInput'
export type { DateInputProps, DateRangeProps } from './DateInput'
export { Avatar, initials } from './Avatar'
export { Tabs } from './Tabs'
export type { TabItem } from './Tabs'
export { Num, MoneyText } from './Money'
export { DebtAgeStrip } from './DebtAgeStrip'
export type { DebtAgeMonth, DebtMonthState } from './DebtAgeStrip'
export { useMediaQuery, useIsMobile, useIsTouch } from './hooks'
export { chart } from './chart'
export { currentTheme } from './theme'
export * as f from './format'
