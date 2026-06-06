import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import Landing from '../pages/Landing'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const user = useAuthStore(s => s.user)
  const location = useLocation()

  if (!isAuthenticated) {
    // Bosh sahifa ('/') — landing ko'rsatamiz (reklama/ro'yxatdan o'tish uchun).
    // Boshqa himoyalangan yo'llar — login sahifasiga.
    if (location.pathname === '/') return <Landing />
    return <Navigate to="/login" replace />
  }
  // super_admin has no fleet access — redirect to admin panel
  if (user?.role === 'super_admin') return <Navigate to="/admin" replace />
  return <>{children}</>
}
