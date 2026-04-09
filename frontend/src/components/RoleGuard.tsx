import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import AccessDenied from '../pages/AccessDenied'

interface Props {
  roles: string[]
  children: React.ReactNode
}

/**
 * Shows AccessDenied if the user's role is not in the allowed list.
 * Unauthenticated users are redirected to login.
 */
export default function RoleGuard({ roles, children }: Props) {
  const user = useAuthStore(s => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <AccessDenied />
  return <>{children}</>
}
