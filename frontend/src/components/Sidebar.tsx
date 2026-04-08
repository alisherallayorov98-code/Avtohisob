import { NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard, Truck, Wrench, Package, Database,
  Fuel, Gauge, ArrowLeftRight, BarChart3, Building2, Settings, X, Search,
  HeartPulse, AlertOctagon, Lightbulb, CalendarClock, TrendingUp, CreditCard,
  CircleDot, ShieldCheck, MessageSquare, HelpCircle, Upload, ShieldAlert
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { cn } from '../lib/utils'

const navItems = [
  { path: '/', label: 'Boshqaruv paneli', icon: LayoutDashboard, exact: true },
  { path: '/vehicles', label: 'Avtomashinalari', icon: Truck },
  { path: '/vehicle-health', label: 'Texnika holati', icon: HeartPulse },
  { path: '/maintenance', label: "Ta'mirlash", icon: Wrench },
  { path: '/predictions', label: 'Bashoratlar', icon: CalendarClock },
  { path: '/tires', label: 'Shinalar', icon: CircleDot },
  { path: '/warranties', label: 'Kafolatlar', icon: ShieldCheck },
  null, // divider
  { path: '/fuel', label: "Yonilg'i", icon: Fuel },
  { path: '/fuel-analytics', label: "Yonilg'i tahlili", icon: TrendingUp },
  { path: '/fuel-meter', label: 'Hisoblagich', icon: Gauge },
  null,
  { path: '/spare-parts', label: 'Ehtiyot qismlar', icon: Package },
  { path: '/inventory', label: 'Ombor', icon: Database },
  { path: '/transfers', label: "O'tkazmalar", icon: ArrowLeftRight },
  null,
  { path: '/anomalies', label: 'Anomaliyalar', icon: AlertOctagon },
  { path: '/recommendations', label: 'Tavsiyalar', icon: Lightbulb },
  { path: '/reports', label: 'Hisobotlar', icon: BarChart3 },
  null,
  { path: '/branches', label: 'Filiallar', icon: Building2, adminOnly: true },
  { path: '/settings', label: 'Sozlamalar', icon: Settings, adminOnly: true },
  { path: '/billing', label: "Obuna va To'lov", icon: CreditCard, adminOnly: true },
  { path: '/import', label: 'Import', icon: Upload, adminOnly: true },
  null,
  { path: '/support', label: "Qo'llab-quvvatlash", icon: MessageSquare },
  { path: '/help', label: 'Yordam', icon: HelpCircle },
]

interface Props { open: boolean; onClose: () => void }

export default function Sidebar({ open, onClose }: Props) {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
  const isSuperAdmin = user?.role === 'super_admin'

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
            className="px-3 py-1.5 rounded-lg bg-gray-800 flex items-center gap-2 text-gray-400 text-xs cursor-pointer hover:bg-gray-700"
            onClick={() => { const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }); window.dispatchEvent(e) }}
          >
            <Search className="w-3 h-3" />
            <span>Qidirish...</span>
            <kbd className="ml-auto font-mono bg-gray-700 px-1 py-0.5 rounded text-[10px]">Ctrl+K</kbd>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-2 py-1">
          {navItems.map((item, i) => {
            if (item === null) return <div key={i} className="my-1 border-t border-gray-800" />
            if (item.adminOnly && !isAdmin) return null
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.exact}
                onClick={close}
                className={({ isActive }) => cn(
                  'flex items-center gap-2.5 px-3 py-1.5 rounded-lg mb-0.5 text-sm transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                )}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Super Admin */}
        {isSuperAdmin && (
          <div className="px-2 pb-2 flex-shrink-0">
            <Link to="/admin"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-800/50">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              Admin Panel
            </Link>
          </div>
        )}

        {/* User */}
        <div className="px-4 py-3 border-t border-gray-700 flex-shrink-0">
          <div className="text-xs text-gray-500">
            <div className="font-medium text-gray-300">{user?.fullName}</div>
            <div className="capitalize">{user?.role?.replace(/_/g, ' ')}</div>
            {user?.branch && <div className="text-blue-400 mt-0.5 truncate">{user.branch.name}</div>}
          </div>
        </div>
      </aside>
    </>
  )
}
