import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

interface Props {
  roles: string[]
  children: React.ReactNode
}

/**
 * Redirects to "/" if the logged-in user's role is not in the allowed list.
 * Wrap route elements in App.tsx with this component.
 */
export default function RoleGuard({ roles, children }: Props) {
  const user = useAuthStore(s => s.user)
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
