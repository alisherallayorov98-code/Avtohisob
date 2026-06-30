import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { PATH_TO_FEATURE_KEY } from '../lib/featureFlags'
import {
  LayoutDashboard, Truck, Wrench, Package, Database,
  Fuel, Gauge, ArrowLeftRight, BarChart3, Building2, Settings, X, Search,
  HeartPulse, AlertOctagon, Lightbulb, CalendarClock, TrendingUp, CreditCard,
  CircleDot, ShieldCheck, MessageSquare, HelpCircle, Upload, ShieldAlert, Users,
  Activity, ChevronDown, ClipboardList, Warehouse, Wallet, ClipboardCheck, Satellite, Droplets, Send, Cpu,
  Archive as ArchiveIcon, RotateCcw, Leaf, Recycle, HardHat, Star,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { cn } from '../lib/utils'

interface NavItem {
  path: string
  /** i18n key e.g. "nav.vehicles" — t() bilan tarjima qilinadi */
  labelKey: string
  icon: React.ElementType
  exact?: boolean
  /** If specified, only these roles can see this item. Omit = all roles. */
  roles?: string[]
}

interface NavGroup {
  id: string
  /** i18n key e.g. "groups.main" */
  labelKey: string
  /** If specified, only these roles can see this group. Omit = all roles. */
  roles?: string[]
  /** Optional Tailwind text color class for a star marker next to the group title (e.g. 'text-amber-400') */
  star?: string
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
    labelKey: 'groups.main',
    items: [
      { path: '/',          labelKey: 'nav.dashboard',     icon: LayoutDashboard, exact: true, roles: ALL },
      { path: '/analytics',    labelKey: 'nav.analytics',    icon: Activity,    roles: MGR },
      { path: '/fleet-status', labelKey: 'nav.fleetStatus', icon: ShieldAlert, roles: MGR },
      { path: '/reports',      labelKey: 'nav.reports',      icon: BarChart3,   roles: MGR },
      { path: '/drivers',   labelKey: 'nav.drivers',       icon: Users,           roles: MGR },
      { path: '/budget',    labelKey: 'nav.budget',        icon: Wallet,          roles: MGR },
    ],
  },
  {
    id: 'transport',
    labelKey: 'groups.transport',
    items: [
      { path: '/driver-panel',   labelKey: 'nav.driverPanel',   icon: ClipboardList,  roles: ALL },
      { path: '/vehicles',      labelKey: 'nav.vehicles',      icon: Truck,          roles: ALL },
      { path: '/waybills',      labelKey: 'nav.waybills',      icon: ClipboardList,  roles: ALL },
      { path: '/vehicle-health',labelKey: 'nav.vehicleHealth', icon: HeartPulse,     roles: ALL },
      { path: '/maintenance',   labelKey: 'nav.maintenance',   icon: Wrench,         roles: BRM },
      { path: '/masters',       labelKey: 'nav.masters',       icon: HardHat,        roles: BRM },
      { path: '/vehicle-care',  labelKey: 'nav.vehicleCare',   icon: CalendarClock,  roles: BRM },
      { path: '/predictions',   labelKey: 'nav.predictions',   icon: CalendarClock,  roles: BRM },
      { path: '/tires',         labelKey: 'nav.tires',         icon: CircleDot,       roles: BRM },
      { path: '/tire-tracking', labelKey: 'nav.tireTracking',  icon: CircleDot,       roles: BRM },
      { path: '/warranties',    labelKey: 'nav.warranties',    icon: ShieldCheck,     roles: BRM },
      { path: '/inspections',   labelKey: 'nav.inspections',   icon: ClipboardCheck,  roles: BRM },
      { path: '/fleet-risk',    labelKey: 'nav.fleetRisk',     icon: ShieldAlert,     roles: MGR },
      { path: '/gps',           labelKey: 'nav.gps',           icon: Satellite,       roles: MGR },
      { path: '/oil-change',     labelKey: 'nav.oilChange',     icon: Droplets,        roles: BRM },
      { path: '/engine-monitor', labelKey: 'nav.engineMonitor', icon: Cpu,             roles: BRM },
    ],
  },
  {
    id: 'fuel',
    labelKey: 'groups.fuel',
    items: [
      { path: '/fuel',            labelKey: 'nav.fuel',           icon: Fuel,        roles: ALL },
      { path: '/fuel-monitoring', labelKey: 'nav.fuelMonitoring', icon: Activity,    roles: ALL },
      { path: '/fuel-analytics',  labelKey: 'nav.fuelAnalytics',  icon: TrendingUp,  roles: MGR },
      { path: '/gas-stations',    labelKey: 'nav.gasStations',    icon: Satellite,   roles: MGR },
      { path: '/fuel-meter',      labelKey: 'nav.fuelMeter',      icon: Gauge,       roles: BRM },
    ],
  },
  {
    id: 'warehouse',
    labelKey: 'groups.warehouse',
    roles: BRM,
    star: 'text-amber-400',
    items: [
      { path: '/warehouses',  labelKey: 'nav.warehouses', icon: Warehouse,      roles: ADM },
      { path: '/spare-parts', labelKey: 'nav.spareParts', icon: Package,        roles: BRM },
      { path: '/suppliers',   labelKey: 'nav.suppliers',  icon: Users,          roles: MGR },
      { path: '/inventory',   labelKey: 'nav.inventory',  icon: Database,       roles: BRM },
      { path: '/transfers',          labelKey: 'nav.transfers',         icon: ArrowLeftRight, roles: BRM },
      { path: '/spare-part-returns', labelKey: 'nav.sparePartReturns', icon: RotateCcw,      roles: BRM },
      { path: '/expenses',           labelKey: 'nav.expenses',          icon: Wallet,         roles: BRM },
    ],
  },
  {
    id: 'ai',
    labelKey: 'groups.ai',
    roles: MGR,
    items: [
      { path: '/anomalies',       labelKey: 'nav.anomalies',       icon: AlertOctagon },
      { path: '/recommendations', labelKey: 'nav.recommendations', icon: Lightbulb },
    ],
  },
  {
    id: 'admin',
    labelKey: 'groups.admin',
    roles: MGR,   // group visible to manager+ (item-level further restricts)
    items: [
      { path: '/branches',  labelKey: 'nav.branches', icon: Building2,   roles: ADM },
      { path: '/settings',  labelKey: 'nav.settings', icon: Settings,    roles: MGR },
      { path: '/archive',   labelKey: 'nav.archive',  icon: ArchiveIcon, roles: MGR },
      { path: '/telegram',  labelKey: 'nav.telegram', icon: Send,        roles: ADM },
      { path: '/billing',   labelKey: 'nav.billing',  icon: CreditCard,  roles: ADM },
      { path: '/import',    labelKey: 'nav.import',   icon: Upload,      roles: ADM },
    ],
  },
  {
    id: 'help',
    labelKey: 'groups.help',
    items: [
      { path: '/support', labelKey: 'nav.support', icon: MessageSquare },
      { path: '/help',    labelKey: 'nav.help',    icon: HelpCircle },
    ],
  },
]

interface Props { open: boolean; onClose: () => void }

export default function Sidebar({ open, onClose }: Props) {
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const role = user?.role || ''
  const isSuperAdmin = role === 'super_admin'

  // Yashirilgan funksiyalar (org-settings dan)
  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: () => api.get('/org-settings').then(r => r.data.data).catch(() => null),
    staleTime: 60_000,
    enabled: !!user, // login bo'lgan bo'lsa
  })
  const hiddenFeatures: string[] = orgSettings?.hiddenFeatures || []

  // Path → feature key. Agar key hidden ro'yxatida bo'lsa — sidebar'dan yashirin.
  const isHidden = (path: string) => {
    const key = PATH_TO_FEATURE_KEY[path]
    return key ? hiddenFeatures.includes(key) : false
  }

  const { data: subscription } = useQuery<{ plan?: { type?: string } } | null>({
    queryKey: ['subscription'],
    queryFn: () => api.get('/billing/subscription').then(r => r.data.data).catch(() => null),
    staleTime: 60_000,
    enabled: !!user,
  })
  const showTozaHudud = role === 'super_admin' || subscription?.plan?.type === 'enterprise'

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleGroup = (id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  const close = () => { if (window.innerWidth < 1024) onClose() }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />}
      <aside className={cn(
        'fixed left-0 top-0 h-full w-60 bg-gray-900/95 backdrop-blur-xl border-r border-white/5 text-white z-50 flex flex-col transition-transform duration-300',
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
            <span>{t('common.search')}...</span>
            <kbd className="ml-auto font-mono bg-gray-700 px-1 py-0.5 rounded text-[10px]">Ctrl+K</kbd>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {navGroups.map(group => {
            // Group-level role check
            if (group.roles && !group.roles.includes(role)) return null

            // Filter items by role va yashirilgan funksiyalar
            const visibleItems = group.items.filter(
              item => (!item.roles || item.roles.includes(role)) && !isHidden(item.path)
            )
            if (visibleItems.length === 0) return null

            const isCollapsed = collapsed[group.id] || false

            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-3 py-1.5 mt-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-400 transition-colors rounded-lg hover:bg-gray-800/50"
                >
                  <span className="flex items-center gap-1.5">
                    {t(group.labelKey)}
                    {group.star && <Star className={cn('w-3 h-3 fill-current', group.star)} />}
                  </span>
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
                        data-tour={item.path.replace(/^\//, '').replace(/\//g, '-')}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
                          item.path === '/maintenance'
                            ? isActive
                              ? 'bg-orange-500 shadow-lg shadow-orange-500/30 text-white font-bold'
                              : 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 hover:text-orange-100 font-medium border border-orange-500/20'
                            : isActive
                              ? 'bg-blue-600/90 shadow-lg shadow-blue-500/20 text-white font-medium'
                              : 'text-gray-400 hover:bg-gray-800/80 hover:text-white'
                        )}
                      >
                        <item.icon className={cn('w-4 h-4 flex-shrink-0', item.path === '/maintenance' && 'text-orange-400')} />
                        <span className="truncate">{t(item.labelKey)}</span>
                        {item.path === '/maintenance' && (
                          <span className="ml-auto text-[10px] bg-orange-500/30 text-orange-300 px-1.5 py-0.5 rounded-full font-semibold">★</span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Toza-Hudud moduli */}
        {showTozaHudud && (
          <div className="px-2 pb-1 flex-shrink-0">
            <Link to="/toza-hudud" onClick={close}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-800/50 transition-colors">
              <Leaf className="w-4 h-4 flex-shrink-0" />
              Toza-Hudud
            </Link>
          </div>
        )}

        {/* EkoHisob moduli */}
        {showTozaHudud && (
          <div className="px-2 pb-1 flex-shrink-0">
            <Link to="/ekohisob" onClick={close}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-800/50 transition-colors">
              <Recycle className="w-4 h-4 flex-shrink-0" />
              EkoHisob
            </Link>
          </div>
        )}

        {/* Super Admin Panel link */}
        {isSuperAdmin && (
          <div className="px-2 pb-2 flex-shrink-0">
            <Link to="/admin"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-800/50 transition-colors">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              {t('nav.adminPanel')}
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
