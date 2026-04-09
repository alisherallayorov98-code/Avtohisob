import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard, Truck, Wrench, Package, Database,
  Fuel, Gauge, ArrowLeftRight, BarChart3, Building2, Settings, X, Search,
  HeartPulse, AlertOctagon, Lightbulb, CalendarClock, TrendingUp, CreditCard,
  CircleDot, ShieldCheck, MessageSquare, HelpCircle, Upload, ShieldAlert, Users,
  Activity, ChevronDown,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { cn } from '../lib/utils'

interface NavItem {
  path: string
  label: string
  icon: React.ElementType
  exact?: boolean
}

interface NavGroup {
  id: string
  label: string
  adminOnly?: boolean
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    id: 'main',
    label: 'Asosiy',
    items: [
      { path: '/', label: 'Boshqaruv paneli', icon: LayoutDashboard, exact: true },
      { path: '/analytics', label: 'Analitika', icon: Activity },
      { path: '/reports', label: 'Hisobotlar', icon: BarChart3 },
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    items: [
      { path: '/vehicles', label: 'Avtomashinalari', icon: Truck },
      { path: '/vehicle-health', label: 'Texnika holati', icon: HeartPulse },
      { path: '/maintenance', label: "Ta'mirlash", icon: Wrench },
      { path: '/predictions', label: 'Bashoratlar', icon: CalendarClock },
      { path: '/tires', label: 'Shinalar', icon: CircleDot },
      { path: '/warranties', label: 'Kafolatlar', icon: ShieldCheck },
    ],
  },
  {
    id: 'fuel',
    label: "Yoqilg'i",
    items: [
      { path: '/fuel', label: "Yoqilg'i", icon: Fuel },
      { path: '/fuel-analytics', label: 'Tahlil', icon: TrendingUp },
      { path: '/fuel-meter', label: 'Vedomost Import', icon: Gauge },
    ],
  },
  {
    id: 'warehouse',
    label: 'Ombor',
    items: [
      { path: '/spare-parts', label: 'Ehtiyot qismlar', icon: Package },
      { path: '/suppliers', label: 'Yetkazuvchilar', icon: Users },
      { path: '/inventory', label: 'Ombor', icon: Database },
      { path: '/transfers', label: "O'tkazmalar", icon: ArrowLeftRight },
    ],
  },
  {
    id: 'ai',
    label: 'AI Tahlil',
    items: [
      { path: '/anomalies', label: 'Anomaliyalar', icon: AlertOctagon },
      { path: '/recommendations', label: 'Tavsiyalar', icon: Lightbulb },
    ],
  },
  {
    id: 'admin',
    label: 'Boshqaruv',
    adminOnly: true,
    items: [
      { path: '/branches', label: 'Filiallar', icon: Building2 },
      { path: '/settings', label: 'Sozlamalar', icon: Settings },
      { path: '/billing', label: "Obuna va To'lov", icon: CreditCard },
      { path: '/import', label: 'Import', icon: Upload },
    ],
  },
  {
    id: 'help',
    label: 'Yordam',
    items: [
      { path: '/support', label: "Qo'llab-quvvatlash", icon: MessageSquare },
      { path: '/help', label: 'Yordam', icon: HelpCircle },
    ],
  },
]

interface Props { open: boolean; onClose: () => void }

export default function Sidebar({ open, onClose }: Props) {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
  const isSuperAdmin = user?.role === 'super_admin'

  // All groups open by default
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
            <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
            <span className="font-bold">AvtoHisob</span>
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
            if (group.adminOnly && !isAdmin) return null
            const isCollapsed = collapsed[group.id] || false

            return (
              <div key={group.id}>
                {/* Group header */}
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

                {/* Group items */}
                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {group.items.map(item => (
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

        {/* Super Admin */}
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
