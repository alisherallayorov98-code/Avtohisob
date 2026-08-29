import { useState } from 'react'
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom'
import {
  ShoppingCart, LayoutDashboard, LogOut, Menu, X, ChevronLeft,
  Warehouse, Package, Truck, PackagePlus, Boxes, Users, Receipt, Wallet, Store, ClipboardCheck,
  Settings as SettingsIcon, UserCog,
} from 'lucide-react'
import { useSavdoAuthStore } from './stores/savdoAuthStore'
import { useAuthStore } from '../../stores/authStore'
import DashboardPage from './pages/DashboardPage'
import WarehousesPage from './pages/WarehousesPage'
import ProductsPage from './pages/ProductsPage'
import SuppliersPage from './pages/SuppliersPage'
import PurchasesPage from './pages/PurchasesPage'
import StockPage from './pages/StockPage'
import CustomersPage from './pages/CustomersPage'
import SalesPage from './pages/SalesPage'
import SaleDetailPage from './pages/SaleDetailPage'
import PaymentsPage from './pages/PaymentsPage'
import KassaPage from './pages/KassaPage'
import InventoryCountPage from './pages/InventoryCountPage'
import InventoryCountDetailPage from './pages/InventoryCountDetailPage'
import SettingsPage from './pages/SettingsPage'
import EmployeesPage from './pages/EmployeesPage'
import './ui/tokens.css'

const baseNavItems = [
  { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: 'kassa', label: 'Kassa', icon: Store },
  { to: 'sales', label: 'Savdo', icon: Receipt },
  { to: 'payments', label: 'To\'lov / Qarz', icon: Wallet },
  { to: 'products', label: 'Mahsulotlar', icon: Package },
  { to: 'warehouses', label: 'Omborlar', icon: Warehouse },
  { to: 'purchases', label: 'Kirim', icon: PackagePlus },
  { to: 'stock', label: 'Qoldiq', icon: Boxes },
  { to: 'inventarizatsiya', label: 'Inventarizatsiya', icon: ClipboardCheck },
  { to: 'customers', label: 'Mijozlar', icon: Users },
  { to: 'suppliers', label: 'Yetkazib beruvchilar', icon: Truck },
]

// Faqat admin ko'radi: xodim boshqaruvi va korxona sozlamalari
const adminNavItems = [
  { to: 'employees', label: 'Xodimlar', icon: UserCog },
  { to: 'settings', label: 'Sozlamalar', icon: SettingsIcon },
]

export default function SavdoApp() {
  const navigate = useNavigate()
  const { user: savdoUser, isAuthenticated: savdoAuth, logout: savdoLogout } = useSavdoAuthStore()
  const { user: mainUser, isAuthenticated: mainAuth, logout: mainLogout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // admin/super_admin — asosiy AutoHisob tokeni bilan to'g'ridan-to'g'ri kiradi (soya-yozuv)
  const isMainAdmin = mainAuth && (mainUser?.role === 'admin' || mainUser?.role === 'super_admin')
  const isAuthenticated = isMainAdmin || savdoAuth

  if (!isAuthenticated) {
    return <Navigate to="/savdo/login" replace />
  }

  const user = isMainAdmin
    ? { fullName: mainUser!.fullName, email: mainUser!.email, role: 'admin' as const }
    : savdoUser

  const isAdmin = user?.role === 'admin'
  const navItems = isAdmin ? [...baseNavItems, ...adminNavItems] : baseNavItems

  function handleLogout() {
    if (isMainAdmin) {
      mainLogout()
      navigate('/login')
    } else {
      savdoLogout()
      navigate('/savdo/login')
    }
  }

  return (
    <div className="savdo-app flex h-screen overflow-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className={`
        ${sidebarOpen ? 'md:w-56' : 'md:w-16'}
        ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        fixed md:relative z-40 h-full w-56
        bg-stone-800 text-white flex flex-col transition-all duration-200 shrink-0
      `}>
        <div className="flex items-center gap-2 px-4 py-4 border-b border-stone-700">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shrink-0">
            <ShoppingCart className="w-5 h-5 text-amber-950" />
          </div>
          {(sidebarOpen || mobileNavOpen) && (
            <div>
              <p className="font-bold text-sm leading-tight">Savdo</p>
              <p className="text-stone-400 text-xs">Ombor va savdo</p>
            </div>
          )}
        </div>

        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-stone-900 text-white font-medium'
                    : 'text-stone-300 hover:bg-stone-700 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {(sidebarOpen || mobileNavOpen) && label}
            </NavLink>
          ))}
        </nav>

        <div className="px-2 py-3 border-t border-stone-700 space-y-0.5">
          {(sidebarOpen || mobileNavOpen) && user && (
            <div className="px-3 py-2 mb-1">
              <p className="text-xs font-medium text-white truncate">{user.fullName}</p>
              <p className="text-xs text-stone-400">
                {user.role === 'admin' ? 'Admin' : user.role === 'manager' ? 'Menejer' : user.role === 'cashier' ? 'Kassir' : 'Xodim'}
              </p>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="hidden md:flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-stone-300 hover:bg-stone-700 hover:text-white transition-colors"
          >
            <ChevronLeft className={`w-4 h-4 shrink-0 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} />
            {sidebarOpen && "Yig'ish"}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-stone-300 hover:bg-stone-700 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {(sidebarOpen || mobileNavOpen) && 'Chiqish'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col">
        <header className="md:hidden flex items-center justify-between gap-3 px-4 py-3 bg-stone-800 text-white shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="p-1 hover:bg-stone-700 rounded"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-amber-400" />
              <p className="font-bold text-sm">Savdo</p>
            </div>
          </div>
          {mobileNavOpen && (
            <button onClick={() => setMobileNavOpen(false)} className="p-1 hover:bg-stone-700 rounded">
              <X className="w-5 h-5" />
            </button>
          )}
        </header>

        <div className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="warehouses" element={<WarehousesPage />} />
            <Route path="purchases" element={<PurchasesPage />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="inventarizatsiya" element={<InventoryCountPage />} />
            <Route path="inventarizatsiya/:id" element={<InventoryCountDetailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="sales/:id" element={<SaleDetailPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="kassa" element={<KassaPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
