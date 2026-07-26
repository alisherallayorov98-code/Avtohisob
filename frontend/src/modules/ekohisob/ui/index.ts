/**
 * EkoHisob dizayn tizimi.
 *
 * Barcha ekranlar SHU yerdagi komponentlardan quriladi. Yangi ekran yozayotganda
 * `bg-white rounded-xl border...` kabi klasslarni qo'lda yozmang — kerakli
 * primitiv bo'lmasa, uni shu papkaga qo'shing.
 *
 * Tokenlar: ./tokens.css (CSS o'zgaruvchilari, `.eko-app` ichida amal qiladi)
 * Tailwind kalitlari: `eko-*` (tailwind.config.js) — faqat shu modul ishlatadi.
 */

import './tokens.css'

export { cx } from './cx'
export { Button, IconButton } from './Button'
export type { ButtonVariant, ButtonSize, ButtonProps } from './Button'
export { Card, CardHeader, CardBody } from './Card'
export { Badge, DebtBadge, DebtDot, BillingBadge } from './Badge'
export type { BadgeTone, DebtLevel } from './Badge'
export { StatTile, StatRow } from './StatTile'
export type { StatTileProps, StatTone } from './StatTile'
export { Modal } from './Modal'
export type { ModalProps, ModalSize } from './Modal'
export { ConfirmProvider, useConfirm } from './ConfirmDialog'
export type { ConfirmOptions } from './ConfirmDialog'
export { EmptyState, ErrorState, Skeleton, SkeletonList, Banner } from './States'
export type { BannerTone } from './States'
export { Field, Input, Select, Textarea, InputWithIcon, Toggle } from './Field'
export { PageHeader, Page, Toolbar, SegmentedControl } from './PageHeader'
export * as f from './format'
