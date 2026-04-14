import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const user = useAuthStore(s => s.user)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  // super_admin has no fleet access — redirect to admin panel
  if (user?.role === 'super_admin') return <Navigate to="/admin" replace />
  return <>{children}</>
}
