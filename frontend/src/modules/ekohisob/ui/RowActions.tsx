import { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button, IconButton } from './Button'
import { Menu, MenuItem } from './Popover'

export interface RowActionsProps {
  /** Bitta ASOSIY amal (ko'rinib turadi), masalan "To'lov" */
  primary?: { label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean; loading?: boolean }
  /** Qolgan amallar kebab menyuda (xavflilari `danger`) */
  items?: MenuItem[]
  /** Kebab tugmasi ovozi: "Boshqa amallar" */
  menuLabel?: string
}

/**
 * Jadval qatori amallari: bitta asosiy tugma + kebab menyu. Qatorda 3+ tugma
 * qatorlashtirmang — qolganlarini menyuga oling.
 */
export function RowActions({ primary, items, menuLabel = 'Boshqa amallar' }: RowActionsProps) {
  const hasItems = items && items.length > 0
  return (
    <div className="inline-flex items-center gap-1">
      {primary && (
        <Button
          size="sm"
          icon={primary.icon}
          onClick={primary.onClick}
          disabled={primary.disabled}
          loading={primary.loading}
        >
          {primary.label}
        </Button>
      )}
      {hasItems && (
        <Menu
          items={items!}
          trigger={(p) => (
            <IconButton {...p} variant="ghost" size="sm" label={menuLabel} icon={<MoreHorizontal className="w-4 h-4" />} />
          )}
        />
      )}
    </div>
  )
}
