import { useState } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { Leaf, Database, Map, CalendarDays, BarChart3, Settings, LogOut, ChevronLeft, Activity, LayoutDashboard, Truck, Menu } from 'lucide-react'
import DataEntry from './pages/DataEntry'
import MapPage from './pages/MapPage'
import SchedulePage from './pages/SchedulePage'
import TripsPage from './pages/TripsPage'
import ReportsPage from './pages/ReportsPage'
import DashboardPage from './pages/DashboardPage'
import SettingsPage from './pages/SettingsPage'
import DriverPage from './pages/DriverPage'

const navItems = [
  { to: 'dashboard', label: 'Boshqaruv', icon: LayoutDashboard },
  { to: 'data', label: "Ma'lumotlar", icon: Database },
  { to: 'map', label: 'Xarita', icon: Map },
  { to: 'schedule', label: 'Grafik', icon: CalendarDays },
  { to: 'trips', label: 'GPS Monitoring', icon: Activity },
  { to: 'driver', label: 'Haydovchi', icon: Truck },
  { to: 'reports', label: 'Hisobotlar', icon: BarChart3 },
  { to: 'settings', label: 'Sozlamalar', icon: Settings },
]

export default function TozaHududApp() {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Mobil hamburger overlay */}
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar — mobil: drawer, desktop: oddiy */}
      <aside className={`
        ${sidebarOpen ? 'md:w-56' : 'md:w-16'}
        ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        fixed md:relative z-40 h-full w-56
        bg-emerald-900 text-white flex flex-col transition-all duration-200 shrink-0
      `}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-emerald-800">
          <div className="w-8 h-8 bg-emerald-400 rounded-lg flex items-center justify-center shrink-0">
            <Leaf className="w-5 h-5 text-emerald-900" />
          </div>
          {(sidebarOpen || mobileNavOpen) && (
            <div>
              <p className="font-bold text-sm leading-tight">Toza-Hudud</p>
              <p className="text-emerald-400 text-xs">Monitoring tizimi</p>
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
                    ? 'bg-emerald-700 text-white font-medium'
                    : 'text-emerald-200 hover:bg-emerald-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {(sidebarOpen || mobileNavOpen) && label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-2 py-3 border-t border-emerald-800 space-y-0.5">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="hidden md:flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-emerald-300 hover:bg-emerald-800 hover:text-white transition-colors"
          >
            <ChevronLeft className={`w-4 h-4 shrink-0 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} />
            {sidebarOpen && 'Yig\'ish'}
          </button>
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-emerald-300 hover:bg-emerald-800 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {(sidebarOpen || mobileNavOpen) && 'AutoHisob ga qaytish'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Mobil header — hamburger */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-emerald-900 text-white shrink-0">
          <button onClick={() => setMobileNavOpen(true)} className="p-1 hover:bg-emerald-800 rounded">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Leaf className="w-5 h-5 text-emerald-400" />
            <p className="font-bold text-sm">Toza-Hudud</p>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="data" element={<DataEntry />} />
            <Route path="map" element={<MapPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="trips" element={<TripsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="driver" element={<DriverPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

