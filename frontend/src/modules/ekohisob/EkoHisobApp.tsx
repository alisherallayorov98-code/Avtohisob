import { useState } from 'react'
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom'
import {
  Leaf, LayoutDashboard, Building2, Map, AlertCircle, Users, MapPin,
  LogOut, Menu, X, ChevronLeft,
} from 'lucide-react'
import { useEkoAuthStore } from './stores/ekoAuthStore'
import { useAuthStore } from '../../stores/authStore'
import DashboardPage from './pages/DashboardPage'
import EntitiesPage from './pages/EntitiesPage'
import MapPage from './pages/MapPage'
import BlacklistPage from './pages/BlacklistPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminDistrictsPage from './pages/AdminDistrictsPage'

const baseNavItems = [
  { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: 'entities', label: 'Tashkilotlar', icon: Building2 },
  { to: 'map', label: 'Xarita', icon: Map },
  { to: 'blacklist', label: "Qora ro'yxat", icon: AlertCircle },
]

const adminNavItems = [
  { to: 'admin/users', label: 'Foydalanuvchilar', icon: Users },
  { to: 'admin/districts', label: 'Tumanlar', icon: MapPin },
]

export default function EkoHisobApp() {
  const navigate = useNavigate()
  const { user: ekoUser, isAuthenticated: ekoAuth, logout: ekoLogout } = useEkoAuthStore()
  const { user: mainUser, isAuthenticated: mainAuth, logout: mainLogout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Asosiy AutoHisob token (ekohisob_user roli) yoki eski EkoHisob token
  const isMainEkoUser = mainAuth && mainUser?.role === 'ekohisob_user'
  const isAuthenticated = isMainEkoUser || ekoAuth

  if (!isAuthenticated) {
    return <Navigate to="/ekohisob/login" replace />
  }

  // Asosiy tokendan foydalanuvchi ma'lumotlari
  const user = isMainEkoUser
    ? { fullName: mainUser!.fullName, email: mainUser!.email, role: 'inspector' as const }
    : ekoUser

  const isAdmin = !isMainEkoUser && ekoUser?.role === 'admin'
  const navItems = isAdmin ? [...baseNavItems, ...adminNavItems] : baseNavItems

  function handleLogout() {
    if (isMainEkoUser) {
      mainLogout()
      navigate('/login')
    } else {
      ekoLogout()
      navigate('/ekohisob/login')
    }
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Mobile overlay */}
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        ${sidebarOpen ? 'md:w-56' : 'md:w-16'}
        ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        fixed md:relative z-40 h-full w-56
        bg-green-800 text-white flex flex-col transition-all duration-200 shrink-0
      `}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-green-700">
          <div className="w-8 h-8 bg-green-400 rounded-lg flex items-center justify-center shrink-0">
            <Leaf className="w-5 h-5 text-green-900" />
          </div>
          {(sidebarOpen || mobileNavOpen) && (
            <div>
              <p className="font-bold text-sm leading-tight">EkoHisob</p>
              <p className="text-green-300 text-xs">To'lov tizimi</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-green-900 text-white font-medium'
                    : 'text-green-200 hover:bg-green-700 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {(sidebarOpen || mobileNavOpen) && label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-2 py-3 border-t border-green-700 space-y-0.5">
          {/* User info */}
          {(sidebarOpen || mobileNavOpen) && user && (
            <div className="px-3 py-2 mb-1">
              <p className="text-xs font-medium text-white truncate">{user.fullName}</p>
              <p className="text-xs text-green-300">
                {'districtIds' in user ? `${user.districtIds.length} tuman · ` : ''}
                {user.role === 'admin' ? 'Admin' : 'Inspektor'}
              </p>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="hidden md:flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-green-300 hover:bg-green-700 hover:text-white transition-colors"
          >
            <ChevronLeft className={`w-4 h-4 shrink-0 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} />
            {sidebarOpen && "Yig'ish"}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-green-300 hover:bg-green-700 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {(sidebarOpen || mobileNavOpen) && 'Chiqish'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between gap-3 px-4 py-3 bg-green-800 text-white shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="p-1 hover:bg-green-700 rounded"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Leaf className="w-5 h-5 text-green-400" />
              <p className="font-bold text-sm">EkoHisob</p>
            </div>
          </div>
          {mobileNavOpen && (
            <button onClick={() => setMobileNavOpen(false)} className="p-1 hover:bg-green-700 rounded">
              <X className="w-5 h-5" />
            </button>
          )}
        </header>

        <div className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="entities" element={<EntitiesPage />} />
            <Route path="map" element={<MapPage />} />
            <Route path="blacklist" element={<BlacklistPage />} />
            {isAdmin && (
              <>
                <Route path="admin/users" element={<AdminUsersPage />} />
                <Route path="admin/districts" element={<AdminDistrictsPage />} />
              </>
            )}
          </Routes>
        </div>
      </main>
    </div>
  )
}
