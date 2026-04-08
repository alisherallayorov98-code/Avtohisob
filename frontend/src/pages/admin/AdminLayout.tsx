import { Outlet, NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard, Users, Building2, CreditCard, MessageSquare,
  Shield, Tag, Activity, ArrowLeft, ChevronRight
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

const adminNavItems = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { path: '/admin/users', label: 'Foydalanuvchilar', icon: Users },
  { path: '/admin/organizations', label: 'Tashkilotlar', icon: Building2 },
  { path: '/admin/billing', label: 'Billing & Revenue', icon: CreditCard },
  { path: '/admin/support', label: 'Support Tickets', icon: MessageSquare },
  { path: '/admin/audit-logs', label: 'Audit Logs', icon: Shield },
  { path: '/admin/promo-codes', label: 'Promo Kodlar', icon: Tag },
  { path: '/admin/monitoring', label: 'Monitoring', icon: Activity },
]

export default function AdminLayout() {
  const user = useAuthStore(s => s.user)

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-black border-r border-gray-800 flex flex-col">
        <div className="flex items-center gap-3 h-16 px-5 border-b border-gray-800">
          <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-xs font-black">A</div>
          <div>
            <div className="font-bold text-sm">Admin Panel</div>
            <div className="text-[10px] text-gray-500">Super Admin</div>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {adminNavItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-red-600 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                }`
              }
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-white hover:bg-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Asosiy ilovaga qaytish
          </Link>
          <div className="px-3 pt-2 text-xs text-gray-600 truncate">{user?.fullName} · {user?.email}</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center px-6 gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>Admin</span>
            <ChevronRight className="w-3 h-3" />
          </div>
          <h1 className="text-sm font-semibold text-white">AutoHisob Super Admin</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-6 bg-gray-950">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
