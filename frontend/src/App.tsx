import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import Layout from './components/Layout'
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

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <Routes>
        {/* Public auth routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        {/* Protected app routes */}
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="vehicles/:id" element={<VehicleDetail />} />
          <Route path="spare-parts" element={<SpareParts />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="maintenance" element={<Maintenance />} />
          <Route path="fuel" element={<Fuel />} />
          <Route path="fuel-meter" element={<FuelMeter />} />
          <Route path="transfers" element={<Transfers />} />
          <Route path="reports" element={<Reports />} />
          <Route path="branches" element={<Branches />} />
          <Route path="settings" element={<Settings />} />
          <Route path="vehicle-health" element={<VehicleHealth />} />
          <Route path="anomalies" element={<Anomalies />} />
          <Route path="recommendations" element={<Recommendations />} />
          <Route path="predictions" element={<MaintenancePredictions />} />
          <Route path="fuel-analytics" element={<FuelAnalytics />} />
          <Route path="billing" element={<Billing />} />
          <Route path="tires" element={<Tires />} />
          <Route path="warranties" element={<Warranties />} />
          <Route path="support" element={<Support />} />
          <Route path="help" element={<HelpCenter />} />
          <Route path="import" element={<ImportData />} />
        </Route>
        {/* Super Admin Panel */}
        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="organizations" element={<AdminOrganizations />} />
          <Route path="billing" element={<AdminBilling />} />
          <Route path="support" element={<AdminSupport />} />
          <Route path="audit-logs" element={<AdminAuditLogs />} />
          <Route path="promo-codes" element={<AdminPromoCodes />} />
          <Route path="monitoring" element={<AdminMonitoring />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
