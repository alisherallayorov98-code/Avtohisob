import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard, Truck, Wrench, Package, Database,
  Fuel, Gauge, ArrowLeftRight, BarChart3, Building2, Settings, X, Search,
  HeartPulse, AlertOctagon, Lightbulb, CalendarClock, TrendingUp, CreditCard,
  CircleDot, ShieldCheck, MessageSquare, HelpCircle, Upload, ShieldAlert, Users,
  Activity, ChevronDown, ClipboardList, Warehouse, Wallet, ClipboardCheck,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { cn } from '../lib/utils'

interface NavItem {
  path: string
  label: string
  icon: React.ElementType
  exact?: boolean
  /** If specified, only these roles can see this item. Omit = all roles. */
  roles?: string[]
}

interface NavGroup {
  id: string
  label: string
  /** If specified, only these roles can see this group. Omit = all roles. */
  roles?: string[]
  items: NavItem[]
}

// Roles shorthand
const ALL   = undefined                                         // everyone
const ADM   = ['super_admin', 'admin']                        // admin only
const MGR   = ['super_admin', 'admin', 'manager']             // manager+
const BRM   = ['super_admin', 'admin', 'manager', 'branch_manager'] // branch_manager+

const navGroups: NavGroup[] = [
  {
    id: 'main',
    label: 'Asosiy',
    items: [
      { path: '/',          label: 'Boshqaruv paneli', icon: LayoutDashboard, exact: true, roles: ALL },
      { path: '/analytics', label: 'Analitika',         icon: Activity,        roles: MGR },
      { path: '/reports',   label: 'Hisobotlar',        icon: BarChart3,       roles: MGR },
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    items: [
      { path: '/vehicles',      label: 'Avtomashinalari', icon: Truck,          roles: ALL },
      { path: '/waybills',      label: "Yo'l varaqlari",  icon: ClipboardList,  roles: ALL },
      { path: '/vehicle-health',label: 'Texnika holati',  icon: HeartPulse,     roles: ALL },
      { path: '/maintenance',   label: "Ta'mirlash",      icon: Wrench,         roles: BRM },
      { path: '/predictions',   label: 'Bashoratlar',     icon: CalendarClock,  roles: BRM },
      { path: '/tires',         label: 'Shinalar',           icon: CircleDot,       roles: BRM },
      { path: '/warranties',    label: 'Kafolatlar',         icon: ShieldCheck,     roles: BRM },
      { path: '/inspections',   label: 'Oylik tekshiruv',    icon: ClipboardCheck,  roles: BRM },
      { path: '/fleet-risk',    label: 'Profilaktika',       icon: ShieldAlert,     roles: MGR },
    ],
  },
  {
    id: 'fuel',
    label: "Yoqilg'i",
    items: [
      { path: '/fuel',          label: "Yoqilg'i",       icon: Fuel,    roles: ALL },
      { path: '/fuel-analytics',label: 'Tahlil',          icon: TrendingUp, roles: MGR },
      { path: '/fuel-meter',    label: 'Vedomost Import', icon: Gauge,   roles: BRM },
    ],
  },
  {
    id: 'warehouse',
    label: 'Ombor',
    roles: BRM,
    items: [
      { path: '/warehouses',  label: 'Skladlar',        icon: Warehouse,      roles: ADM },
      { path: '/spare-parts', label: 'Ehtiyot qismlar', icon: Package,        roles: BRM },
      { path: '/suppliers',   label: 'Yetkazuvchilar',  icon: Users,          roles: MGR },
      { path: '/inventory',   label: 'Ombor',           icon: Database,       roles: BRM },
      { path: '/transfers',   label: "O'tkazmalar",     icon: ArrowLeftRight, roles: BRM },
      { path: '/expenses',    label: 'Xarajatlar',      icon: Wallet,         roles: BRM },
    ],
  },
  {
    id: 'ai',
    label: 'AI Tahlil',
    roles: MGR,
    items: [
      { path: '/anomalies',       label: 'Anomaliyalar', icon: AlertOctagon },
      { path: '/recommendations', label: 'Tavsiyalar',   icon: Lightbulb },
    ],
  },
  {
    id: 'admin',
    label: 'Boshqaruv',
    roles: MGR,   // group visible to manager+ (item-level further restricts)
    items: [
      { path: '/branches',  label: 'Filiallar',      icon: Building2, roles: ADM },
      { path: '/settings',  label: 'Sozlamalar',     icon: Settings,  roles: MGR },
      { path: '/billing',   label: "Obuna va To'lov",icon: CreditCard,roles: ADM },
      { path: '/import',    label: 'Import',         icon: Upload,    roles: ADM },
    ],
  },
  {
    id: 'help',
    label: 'Yordam',
    items: [
      { path: '/support', label: "Qo'llab-quvvatlash", icon: MessageSquare },
      { path: '/help',    label: 'Yordam',              icon: HelpCircle },
    ],
  },
]

interface Props { open: boolean; onClose: () => void }

export default function Sidebar({ open, onClose }: Props) {
  const user = useAuthStore(s => s.user)
  const role = user?.role || ''
  const isSuperAdmin = role === 'super_admin'

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleGroup = (id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  const close = () => { if (window.innerWidth < 1024) onClose() }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />}
      <aside className={cn(
        'fixed left-0 top-0 h-full w-60 bg-gray-900 text-white z-50 flex flex-col transition-transform duration-300',
        open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <img src="/icons/icon.svg" alt="AvtoHisob" className="w-8 h-8 rounded-lg" />
            <span className="font-bold tracking-wide">AvtoHisob</span>
          </div>
          <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-2 pt-2 pb-1 flex-shrink-0">
          <div
            className="px-3 py-1.5 rounded-lg bg-gray-800 flex items-center gap-2 text-gray-400 text-xs cursor-pointer hover:bg-gray-700 transition-colors"
            onClick={() => {
              const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
              window.dispatchEvent(e)
            }}
          >
            <Search className="w-3 h-3" />
            <span>Qidirish...</span>
            <kbd className="ml-auto font-mono bg-gray-700 px-1 py-0.5 rounded text-[10px]">Ctrl+K</kbd>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {navGroups.map(group => {
            // Group-level role check
            if (group.roles && !group.roles.includes(role)) return null

            // Filter items by role
            const visibleItems = group.items.filter(
              item => !item.roles || item.roles.includes(role)
            )
            if (visibleItems.length === 0) return null

            const isCollapsed = collapsed[group.id] || false

            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-3 py-1.5 mt-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-400 transition-colors rounded-lg hover:bg-gray-800/50"
                >
                  <span>{group.label}</span>
                  <ChevronDown className={cn(
                    'w-3 h-3 transition-transform duration-200',
                    isCollapsed ? '-rotate-90' : ''
                  )} />
                </button>

                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {visibleItems.map(item => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.exact}
                        onClick={close}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
                          isActive
                            ? 'bg-blue-600 text-white font-medium'
                            : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                        )}
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Super Admin Panel link */}
        {isSuperAdmin && (
          <div className="px-2 pb-2 flex-shrink-0">
            <Link to="/admin"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-800/50 transition-colors">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              Admin Panel
            </Link>
          </div>
        )}

        {/* User info */}
        <div className="px-4 py-3 border-t border-gray-700 flex-shrink-0">
          <div className="text-xs text-gray-500">
            <div className="font-medium text-gray-300 truncate">{user?.fullName}</div>
            <div className="capitalize">{user?.role?.replace(/_/g, ' ')}</div>
            {user?.branch && (
              <div className="text-blue-400 mt-0.5 truncate">{user.branch.name}</div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
