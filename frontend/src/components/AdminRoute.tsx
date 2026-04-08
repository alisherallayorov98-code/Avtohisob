import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.role !== 'super_admin') return <Navigate to="/" replace />
  return <>{children}</>
}
