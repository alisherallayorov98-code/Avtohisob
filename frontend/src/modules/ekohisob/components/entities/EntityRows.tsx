import {
  Wallet, Pencil, FileText, CalendarDays, ShieldCheck, MapPin, MessageSquare, AlertCircle, Eye,
} from 'lucide-react'
import {
  Badge, BillingBadge, Column, DebtAgeStrip, DebtAgeMonth, DebtBadge, MoneyText, RowActions, MenuItem, f,
} from '../../ui'
import type { Entity } from './types'

export interface EntityRowHandlers {
  readOnly: boolean
  smsBusyId: string | null
  onPay: (e: Entity) => void
  onCard: (e: Entity, edit: boolean) => void
  onLedger: (e: Entity) => void
  onTalons: (e: Entity) => void
  onProof: (e: Entity) => void
  onLocation: (e: Entity) => void
  onSms: (e: Entity) => void
  onBlacklist: (e: Entity) => void
}

/** Qatorda BITTA holat belgisi: faol bo'lsa qarz darajasi, aks holda faollik holati. */
function StateBadge({ e }: { e: Entity }) {
  if (e.status === 'active') return <DebtBadge level={e.debtLevel} />
  if (e.status === 'draft') return <Badge tone="draft">Chala</Badge>
  if (e.status === 'blacklisted') return <Badge tone="blacklisted">Qora ro'yxat</Badge>
  return <Badge tone="inactive">Nofaol</Badge>
}

/** Oxirgi 12 oy: to'lanmagan oylar qarz yoshiga qarab rangda (1 oy / 2 oy / 3+). */
function agingMonths(unpaid: string[]): DebtAgeMonth[] {
  const now = new Date()
  const cur = now.getFullYear() * 12 + now.getMonth()
  const set = new Set(unpaid)
  const out: DebtAgeMonth[] = []
  for (let i = 11; i >= 0; i--) {
    const idx = cur - i
    const month = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
    out.push(set.has(month)
      ? { month, state: 'open', level: (i >= 2 ? 3 : i === 1 ? 2 : 1) as 1 | 2 | 3 }
      : { month, state: 'paid' })
  }
  return out
}

function LevelCell({ e }: { e: Entity }) {
  const strip = e.status === 'active' && e.unpaidMonths && e.unpaidMonths.length > 0
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <StateBadge e={e} />
        {e.status === 'active' && (e.debtMonths ?? 0) > 0 && (
          <span className="eko-text-xs text-eko-muted">{e.debtMonths} oy</span>
        )}
      </div>
      {strip && <DebtAgeStrip months={agingMonths(e.unpaidMonths!)} />}
    </div>
  )
}

const NO_PAY_REASON: Record<string, string> = {
  blacklisted: "Qora ro'yxatda",
  inactive: 'Nofaol',
}

export function entityColumns(): Column<Entity>[] {
  return [
    {
      key: 'name', title: 'Tashkilot', mobile: 'primary',
      render: e => (
        <div className="min-w-0">
          <p className="font-medium text-eko-text break-words">{e.name}</p>
          <p className="eko-text-xs text-eko-muted">
            {[e.code, e.mahalla?.name].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'address', title: 'Manzil', mobile: 'secondary',
      render: e => <span className="text-eko-text-2 line-clamp-2">{e.address || '—'}</span>,
    },
    { key: 'level', title: 'Qarz darajasi', mobile: 'secondary', render: e => <LevelCell e={e} /> },
    {
      key: 'debt', title: 'Qarz', align: 'right', mobile: 'secondary',
      render: e => (
        <div className="flex flex-col items-end">
          <MoneyText value={e.debtAmount ?? 0} className={(e.debtAmount ?? 0) > 0 ? 'font-medium text-eko-text' : 'text-eko-muted'} />
          {(e.advance ?? 0) > 0 && <span className="eko-text-xs text-eko-muted">avans {f.num(e.advance)}</span>}
        </div>
      ),
    },
    {
      key: 'fee', title: 'Oylik / rejim', align: 'right', mobile: 'secondary',
      render: e => (
        <div className="flex flex-col items-end gap-0.5">
          {e.billingMode === 'talon'
            ? <span className="eko-num">{f.num(e.cubicPrice)} <span className="text-eko-muted">so'm/kub</span></span>
            : <MoneyText value={e.monthlyFee} />}
          <BillingBadge mode={e.billingMode} />
        </div>
      ),
    },
  ]
}

export function entityRowActions(e: Entity, h: EntityRowHandlers) {
  const items: MenuItem[] = []
  items.push({ key: 'open', label: 'Kartochka', icon: <Eye className="w-4 h-4" />, onSelect: () => h.onCard(e, false) })
  if (!h.readOnly) {
    items.push({ key: 'edit', label: 'Tahrirlash', icon: <Pencil className="w-4 h-4" />, onSelect: () => h.onCard(e, true) })
  }
  items.push(e.billingMode === 'talon'
    ? { key: 'talons', label: 'Talonlar', icon: <FileText className="w-4 h-4" />, onSelect: () => h.onTalons(e) }
    : { key: 'ledger', label: "To'lovlar tasmasi", icon: <CalendarDays className="w-4 h-4" />, onSelect: () => h.onLedger(e) })
  items.push(
    { key: 'proof', label: 'GPS isbot', icon: <ShieldCheck className="w-4 h-4" />, onSelect: () => h.onProof(e) },
    {
      key: 'loc', icon: <MapPin className="w-4 h-4" />, onSelect: () => h.onLocation(e),
      label: e.lat ? "Joyni ko'rish / yangilash" : 'Joyni xaritadan belgilash',
    },
  )
  if (!h.readOnly && e.status === 'active' && e.phone) {
    items.push({
      key: 'sms', icon: <MessageSquare className="w-4 h-4" />, onSelect: () => h.onSms(e),
      label: e.smsOptOut ? 'SMS rad etgan' : 'SMS eslatma',
      disabled: !!e.smsOptOut || h.smsBusyId === e.id,
    })
  }
  if (!h.readOnly && e.status === 'active') {
    items.push({
      key: 'bl', label: "Qora ro'yxatga qo'shish", icon: <AlertCircle className="w-4 h-4" />,
      danger: true, divider: true, onSelect: () => h.onBlacklist(e),
    })
  }

  let primary
  let reason: string | null = null
  if (h.readOnly) {
    reason = null
  } else if (e.status === 'active') {
    primary = { label: "To'lov", icon: <Wallet className="w-4 h-4" aria-hidden />, onClick: () => h.onPay(e) }
  } else if (e.status === 'draft') {
    primary = { label: "To'ldirish", icon: <Pencil className="w-4 h-4" aria-hidden />, onClick: () => h.onCard(e, true) }
  } else {
    reason = NO_PAY_REASON[e.status] ?? null
  }

  return (
    <div className="inline-flex items-center gap-2">
      {reason && <span className="eko-text-xs text-eko-muted">{reason}</span>}
      <RowActions primary={primary} items={items} />
    </div>
  )
}
