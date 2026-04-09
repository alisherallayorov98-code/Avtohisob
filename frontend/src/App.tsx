import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import RoleGuard from './components/RoleGuard'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import NotFound from './pages/NotFound'
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUsers from './pages/admin/AdminUsers'
import AdminOrganizations from './pages/admin/AdminOrganizations'
import AdminBilling from './pages/admin/AdminBilling'
import AdminSupport from './pages/admin/AdminSupport'
import AdminAuditLogs from './pages/admin/AdminAuditLogs'
import AdminPromoCodes from './pages/admin/AdminPromoCodes'
import AdminMonitoring from './pages/admin/AdminMonitoring'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import Dashboard from './pages/Dashboard'
import Vehicles from './pages/Vehicles'
import SpareParts from './pages/SpareParts'
import Inventory from './pages/Inventory'
import Maintenance from './pages/Maintenance'
import Fuel from './pages/Fuel'
import FuelMeter from './pages/FuelMeter'
import Transfers from './pages/Transfers'
import Reports from './pages/Reports'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import Branches from './pages/Branches'
import Settings from './pages/Settings'
import VehicleHealth from './pages/VehicleHealth'
import Anomalies from './pages/Anomalies'
import Recommendations from './pages/Recommendations'
import MaintenancePredictions from './pages/MaintenancePredictions'
import FuelAnalytics from './pages/FuelAnalytics'
import Billing from './pages/Billing'
import Tires from './pages/Tires'
import Warranties from './pages/Warranties'
import Support from './pages/Support'
import HelpCenter from './pages/HelpCenter'
import ImportData from './pages/ImportData'
import VehicleDetail from './pages/VehicleDetail'
import Suppliers from './pages/Suppliers'
import Waybills from './pages/Waybills'

// Role shorthand constants (must match Sidebar.tsx)
const ADM = ['super_admin', 'admin']
const MGR = ['super_admin', 'admin', 'manager']
const BRM = ['super_admin', 'admin', 'manager', 'branch_manager']
const ALL = ['super_admin', 'admin', 'manager', 'branch_manager', 'operator']

function Guard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  return <RoleGuard roles={roles}>{children}</RoleGuard>
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <ErrorBoundary>
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
          <Route path="maintenance"  element={<Guard roles={BRM}><Maintenance /></Guard>} />
          <Route path="predictions"  element={<Guard roles={BRM}><MaintenancePredictions /></Guard>} />
          <Route path="tires"        element={<Guard roles={BRM}><Tires /></Guard>} />
          <Route path="warranties"   element={<Guard roles={BRM}><Warranties /></Guard>} />

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

          {/* AI — manager+ */}
          <Route path="anomalies"       element={<Guard roles={MGR}><Anomalies /></Guard>} />
          <Route path="recommendations" element={<Guard roles={MGR}><Recommendations /></Guard>} />

          {/* Admin — admin only */}
          <Route path="branches" element={<Guard roles={ADM}><Branches /></Guard>} />
          <Route path="billing"  element={<Guard roles={ADM}><Billing /></Guard>} />
          <Route path="import"   element={<Guard roles={ADM}><ImportData /></Guard>} />
          {/* Settings — manager+ (tabs inside are further restricted) */}
          <Route path="settings" element={<Guard roles={MGR}><Settings /></Guard>} />

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
      </ErrorBoundary>
    </BrowserRouter>
  )
}
