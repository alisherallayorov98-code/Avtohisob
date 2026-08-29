import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom'
import {
  ShoppingCart, LayoutDashboard, LogOut, Menu, X, ChevronLeft,
  Warehouse, Package, Truck, PackagePlus, Boxes, Users, Receipt, Wallet, Store, ClipboardCheck,
  Settings as SettingsIcon, UserCog, ArrowLeftRight, Banknote, MessageSquare, History,
} from 'lucide-react'
import { useSavdoAuthStore } from './stores/savdoAuthStore'
import { useAuthStore } from '../../stores/authStore'
import { useSavdoPerms } from './lib/useSavdoAdmin'
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
import TransfersPage from './pages/TransfersPage'
import ExpensesPage from './pages/ExpensesPage'
import SmsPage from './pages/SmsPage'
import SmenaHistoryPage from './pages/SmenaHistoryPage'
import SmenaDetailPage from './pages/SmenaDetailPage'
import './ui/tokens.css'

// Har bir bo'lim qaysi imkoniyatni talab qiladi — backend
// lib/savdoPermissions.ts matritsasi bilan bir xil kalitlar. Ruxsati
// bo'lmagan xodimga bo'lim umuman ko'rinmaydi (backend ham 403 qaytaradi).
const navItemsAll = [
  { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, cap: 'dashboard.view' },
  { to: 'kassa', label: 'Kassa', icon: Store, cap: 'kassa.use' },
  { to: 'kassa-tarix', label: 'Smena tarixi', icon: History, cap: 'kassa.history' },
  { to: 'sales', label: 'Savdo', icon: Receipt, cap: 'sales.view' },
  { to: 'payments', label: 'To\'lov / Qarz', icon: Wallet, cap: 'payments.view' },
  { to: 'sms', label: 'SMS eslatma', icon: MessageSquare, cap: 'sms.manage' },
  { to: 'products', label: 'Mahsulotlar', icon: Package, cap: 'products.view' },
  { to: 'warehouses', label: 'Omborlar', icon: Warehouse, cap: 'warehouses.view' },
  { to: 'purchases', label: 'Kirim', icon: PackagePlus, cap: 'purchases.view' },
  { to: 'kochirish', label: 'Ko\'chirish', icon: ArrowLeftRight, cap: 'transfers.view' },
  { to: 'stock', label: 'Qoldiq', icon: Boxes, cap: 'stock.view' },
  { to: 'inventarizatsiya', label: 'Inventarizatsiya', icon: ClipboardCheck, cap: 'inventory.view' },
  { to: 'xarajatlar', label: 'Xarajatlar', icon: Banknote, cap: 'expenses.view' },
  { to: 'customers', label: 'Mijozlar', icon: Users, cap: 'customers.view' },
  { to: 'suppliers', label: 'Yetkazib beruvchilar', icon: Truck, cap: 'suppliers.view' },
]

// Faqat admin ko'radi: xodim boshqaruvi va korxona sozlamalari
const adminNavItems = [
  { to: 'employees', label: 'Xodimlar', icon: UserCog, cap: 'users.manage' },
  { to: 'settings', label: 'Sozlamalar', icon: SettingsIcon, cap: 'settings.manage' },
]

export default function SavdoApp() {
  const navigate = useNavigate()
  const { user: savdoUser, isAuthenticated: savdoAuth, logout: savdoLogout, refreshMe } = useSavdoAuthStore()
  const { user: mainUser, isAuthenticated: mainAuth, logout: mainLogout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const hasPerm = useSavdoPerms()

  // Rol/ruxsat admin tomonidan o'zgartirilgan bo'lishi mumkin — kirishda
  // imkoniyatlar serverdan yangilanadi (eski sessiyada ular umuman yo'q edi).
  useEffect(() => {
    if (savdoAuth) refreshMe()
  }, [savdoAuth, refreshMe])

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
  const navItems = (isAdmin ? [...navItemsAll, ...adminNavItems] : navItemsAll)
    .filter(item => hasPerm(item.cap))

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
            {/* Ruxsati bo'lmagan xodim uchun "dashboard" mavjud emas — birinchi
                ko'rinadigan bo'limga yo'naltiriladi (kassir → kassa va h.k.) */}
            <Route index element={<Navigate to={navItems[0]?.to || 'dashboard'} replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="warehouses" element={<WarehousesPage />} />
            <Route path="purchases" element={<PurchasesPage />} />
            <Route path="kochirish" element={<TransfersPage />} />
            <Route path="xarajatlar" element={<ExpensesPage />} />
            <Route path="sms" element={<SmsPage />} />
            <Route path="kassa-tarix" element={<SmenaHistoryPage />} />
            <Route path="kassa-tarix/:id" element={<SmenaDetailPage />} />
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
