import { useSavdoAuthStore } from '../stores/savdoAuthStore'
import { useAuthStore } from '../../../stores/authStore'

// SavdoApp.tsx'dagi isMainAdmin/isAdmin aniqlash mantig'ining bir xilligi —
// bekor qilish kabi admin-only amallarni tugma darajasida ham yashirish uchun
// (backend requireSavdoAdmin baribir 403 qaytaradi, bu faqat UX).
export function useSavdoAdmin(): boolean {
  const savdoRole = useSavdoAuthStore(s => s.user?.role)
  const mainAuth = useAuthStore(s => s.isAuthenticated)
  const mainRole = useAuthStore(s => s.user?.role)
  const isMainAdmin = mainAuth && (mainRole === 'admin' || mainRole === 'super_admin')
  return Boolean(isMainAdmin) || savdoRole === 'admin'
}
