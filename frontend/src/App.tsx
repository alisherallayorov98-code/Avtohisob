import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useIdleLogout } from './hooks/useIdleLogout'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import RoleGuard from './components/RoleGuard'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'

// Eager — auth routes (kichik, birinchi yuklanishda kerak)
import Login from './pages/Login'

// Lazy — protected app routes (code-split)
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const NotFound = lazy(() => import('./pages/NotFound'))

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Vehicles = lazy(() => import('./pages/Vehicles'))
const VehicleDetail = lazy(() => import('./pages/VehicleDetail'))
const SpareParts = lazy(() => import('./pages/SpareParts'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Maintenance = lazy(() => import('./pages/Maintenance'))
const Fuel = lazy(() => import('./pages/Fuel'))
const FuelMeter = lazy(() => import('./pages/FuelMeter'))
const Transfers = lazy(() => import('./pages/Transfers'))
const Reports = lazy(() => import('./pages/Reports'))
const AnalyticsDashboard = lazy(() => import('./pages/AnalyticsDashboard'))
const Branches = lazy(() => import('./pages/Branches'))
const Warehouses = lazy(() => import('./pages/Warehouses'))
const Settings = lazy(() => import('./pages/Settings'))
const VehicleHealth = lazy(() => import('./pages/VehicleHealth'))
const Anomalies = lazy(() => import('./pages/Anomalies'))
const Recommendations = lazy(() => import('./pages/Recommendations'))
const MaintenancePredictions = lazy(() => import('./pages/MaintenancePredictions'))
const FuelAnalytics = lazy(() => import('./pages/FuelAnalytics'))
const Billing = lazy(() => import('./pages/Billing'))
const Tires = lazy(() => import('./pages/Tires'))
const Warranties = lazy(() => import('./pages/Warranties'))
const Support = lazy(() => import('./pages/Support'))
const HelpCenter = lazy(() => import('./pages/HelpCenter'))
const ImportData = lazy(() => import('./pages/ImportData'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Waybills = lazy(() => import('./pages/Waybills'))
const Expenses = lazy(() => import('./pages/Expenses'))
const TechInspections = lazy(() => import('./pages/TechInspections'))
const FleetRisk = lazy(() => import('./pages/FleetRisk'))
const GpsPage = lazy(() => import('./pages/Gps'))
const OilChange = lazy(() => import('./pages/OilChange'))
const Drivers = lazy(() => import('./pages/Drivers'))
const Budget = lazy(() => import('./pages/Budget'))
const TelegramAdmin = lazy(() => import('./pages/TelegramAdmin'))

// Admin panel (kamroq ishlatiladi — hammasi lazy)
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminOrganizations = lazy(() => import('./pages/admin/AdminOrganizations'))
const AdminBilling = lazy(() => import('./pages/admin/AdminBilling'))
const AdminSupport = lazy(() => import('./pages/admin/AdminSupport'))
const AdminAuditLogs = lazy(() => import('./pages/admin/AdminAuditLogs'))
const AdminPromoCodes = lazy(() => import('./pages/admin/AdminPromoCodes'))
const AdminMonitoring = lazy(() => import('./pages/admin/AdminMonitoring'))

// Role shorthand constants (must match Sidebar.tsx)
const ADM = ['super_admin', 'admin']
const MGR = ['super_admin', 'admin', 'manager']
const BRM = ['super_admin', 'admin', 'manager', 'branch_manager']

function Guard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  return <RoleGuard roles={roles}>{children}</RoleGuard>
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  useAppUpdate()
  useIdleLogout()

  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public auth routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        {/* Protected app routes */}
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          {/* Dashboard — everyone */}
          <Route index element={<Dashboard />} />

          {/* Analytics & Reports — manager+ */}
          <Route path="analytics" element={<Guard roles={MGR}><AnalyticsDashboard /></Guard>} />
          <Route path="reports"   element={<Guard roles={MGR}><Reports /></Guard>} />

          {/* Transport — all */}
          <Route path="vehicles"       element={<Vehicles />} />
          <Route path="vehicles/:id"   element={<VehicleDetail />} />
          <Route path="waybills"       element={<Waybills />} />
          <Route path="vehicle-health" element={<VehicleHealth />} />

          {/* Transport — branch_manager+ */}
          <Route path="maintenance"    element={<Guard roles={BRM}><Maintenance /></Guard>} />
          <Route path="predictions"    element={<Guard roles={BRM}><MaintenancePredictions /></Guard>} />
          <Route path="tires"          element={<Guard roles={BRM}><Tires /></Guard>} />
          <Route path="warranties"     element={<Guard roles={BRM}><Warranties /></Guard>} />
          <Route path="inspections"    element={<Guard roles={BRM}><TechInspections /></Guard>} />
          <Route path="fleet-risk"     element={<Guard roles={MGR}><FleetRisk /></Guard>} />
          <Route path="gps"            element={<Guard roles={MGR}><GpsPage /></Guard>} />
          <Route path="oil-change"     element={<Guard roles={BRM}><OilChange /></Guard>} />
          <Route path="drivers"        element={<Guard roles={MGR}><Drivers /></Guard>} />
          <Route path="budget"         element={<Guard roles={MGR}><Budget /></Guard>} />

          {/* Fuel — all */}
          <Route path="fuel" element={<Fuel />} />
          {/* Fuel Analytics — manager+ */}
          <Route path="fuel-analytics" element={<Guard roles={MGR}><FuelAnalytics /></Guard>} />
          {/* Fuel Meter — branch_manager+ */}
          <Route path="fuel-meter" element={<Guard roles={BRM}><FuelMeter /></Guard>} />

          {/* Warehouse — branch_manager+ */}
          <Route path="spare-parts" element={<Guard roles={BRM}><SpareParts /></Guard>} />
          <Route path="inventory"   element={<Guard roles={BRM}><Inventory /></Guard>} />
          <Route path="transfers"   element={<Guard roles={BRM}><Transfers /></Guard>} />
          {/* Suppliers — manager+ */}
          <Route path="suppliers" element={<Guard roles={MGR}><Suppliers /></Guard>} />
          {/* Expenses — branch_manager+ */}
          <Route path="expenses" element={<Guard roles={BRM}><Expenses /></Guard>} />

          {/* AI — manager+ */}
          <Route path="anomalies"       element={<Guard roles={MGR}><Anomalies /></Guard>} />
          <Route path="recommendations" element={<Guard roles={MGR}><Recommendations /></Guard>} />

          {/* Admin — admin only */}
          <Route path="branches"   element={<Guard roles={ADM}><Branches /></Guard>} />
          <Route path="warehouses" element={<Guard roles={ADM}><Warehouses /></Guard>} />
          <Route path="billing"  element={<Guard roles={ADM}><Billing /></Guard>} />
          <Route path="import"   element={<Guard roles={ADM}><ImportData /></Guard>} />
          {/* Settings — manager+ (tabs inside are further restricted) */}
          <Route path="settings" element={<Guard roles={MGR}><Settings /></Guard>} />
          {/* Telegram admin — admin only */}
          <Route path="telegram" element={<Guard roles={ADM}><TelegramAdmin /></Guard>} />

          {/* Help — everyone */}
          <Route path="support" element={<Support />} />
          <Route path="help"    element={<HelpCenter />} />
        </Route>

        {/* Super Admin Panel */}
        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminDashboard />} />
          <Route path="users"         element={<AdminUsers />} />
          <Route path="organizations" element={<AdminOrganizations />} />
          <Route path="billing"       element={<AdminBilling />} />
          <Route path="support"       element={<AdminSupport />} />
          <Route path="audit-logs"    element={<AdminAuditLogs />} />
          <Route path="promo-codes"   element={<AdminPromoCodes />} />
          <Route path="monitoring"    element={<AdminMonitoring />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
