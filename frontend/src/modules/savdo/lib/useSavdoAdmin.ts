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

/**
 * Rolga bog'liq imkoniyat tekshiruvi — nav va tugmalarni yashirish uchun.
 * Imkoniyatlar ro'yxati serverdan keladi (backend lib/savdoPermissions.ts —
 * yagona manba, frontendda matritsa TAKRORLANMAYDI).
 *
 * Eski sessiyada (capabilities hali kelmagan) hamma narsa ko'rinadi — backend
 * baribir har bir so'rovni tekshiradi, bu faqat UX qatlami. Sahifa ochilganda
 * SavdoApp /auth/me bilan imkoniyatlarni yangilaydi.
 */
export function useSavdoPerms(): (capability: string) => boolean {
  const isAdmin = useSavdoAdmin()
  const capabilities = useSavdoAuthStore(s => s.user?.capabilities)

  return (capability: string) => {
    if (isAdmin) return true
    if (!capabilities) return true
    return capabilities.includes(capability)
  }
}
