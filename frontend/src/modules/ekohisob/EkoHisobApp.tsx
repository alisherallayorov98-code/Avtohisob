import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import {
  LayoutDashboard, Building2, Map, AlertCircle, Users, MapPin, Trophy,
  LogOut, Menu, X, ChevronsLeft, BarChart3, Target, ShieldAlert, Eye,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useEkoAuthStore } from './stores/ekoAuthStore'
import ekoApi from './lib/ekoApi'
import ForcePasswordChange from './components/ForcePasswordChange'
import { useAuthStore } from '../../stores/authStore'
import DashboardPage from './pages/DashboardPage'
import EntitiesPage from './pages/EntitiesPage'
import MapPage from './pages/MapPage'
import BlacklistPage from './pages/BlacklistPage'
import ReportsPage from './pages/ReportsPage'
import PlansPage from './pages/PlansPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminDistrictsPage from './pages/AdminDistrictsPage'
import AuditPage from './pages/AuditPage'
import KpiPage from './pages/KpiPage'
import EntitiesImportPage from './pages/EntitiesImportPage'
import SettingsPage from './pages/SettingsPage'
import ReconciliationPage from './pages/ReconciliationPage'
// Dizayn tizimi: tokenlar (`.eko-app` ichida amal qiladi) + tasdiqlash dialogi.
// `window.confirm` o'rniga `useConfirm()` ishlatiladi.
import { ConfirmProvider, Avatar, Banner, Tooltip, IconButton, cx, useIsMobile } from './ui'
import { FOCUSABLE } from './ui/hooks'

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard }

const NAV = {
  dashboard: { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  entities: { to: 'entities', label: 'Tashkilotlar', icon: Building2 },
  map: { to: 'map', label: 'Xarita', icon: Map },
  reports: { to: 'reports', label: 'Hisobot', icon: BarChart3 },
  blacklist: { to: 'blacklist', label: "Qora ro'yxat", icon: AlertCircle },
  kpi: { to: 'kpi', label: 'KPI', icon: Trophy },
  plans: { to: 'plans', label: 'Planlar', icon: Target },
  audit: { to: 'audit', label: 'Jurnal', icon: ShieldAlert },
  users: { to: 'admin/users', label: 'Foydalanuvchilar', icon: Users },
  districts: { to: 'admin/districts', label: 'Tumanlar', icon: MapPin },
  settings: { to: 'settings', label: 'Sozlamalar', icon: SettingsIcon },
} satisfies Record<string, NavItem>

/** Mahsulot belgisi: tomchi-barg. Kvadrat fonsiz, aksent rangda. */
function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('text-eko-accent', className)} aria-hidden fill="none">
      <path d="M12 2.5c3.9 4.3 6.2 7.5 6.2 10.8a6.2 6.2 0 0 1-12.4 0C5.8 10 8.1 6.8 12 2.5z" fill="currentColor" />
      <path d="M12 21V11m0 4 2.6-2.6M12 13.2 9.6 10.8" stroke="rgb(var(--eko-canvas))" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function roleLabel(role: string) {
  return role === 'admin' ? 'Admin' : role === 'supervisor' ? 'Boshliq' : 'Inspektor'
}

export default function EkoHisobApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user: ekoUser, isAuthenticated: ekoAuth, logout: ekoLogout } = useEkoAuthStore()
  const { user: mainUser, isAuthenticated: mainAuth, logout: mainLogout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobile = useIsMobile()
  const asideRef = useRef<HTMLElement>(null)
  const burgerRef = useRef<HTMLButtonElement>(null)

  // Mobil drawer ochilganda: fokus ichkariga, Esc yopadi, yopilganda hamburgerga qaytadi.
  useEffect(() => {
    if (!mobileNavOpen) return
    asideRef.current?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMobileNavOpen(false) }
    document.addEventListener('keydown', onKey)
    const burger = burgerRef.current
    return () => { document.removeEventListener('keydown', onKey); burger?.focus() }
  }, [mobileNavOpen])

  // Yopiq drawer klaviatura bilan fokus olmasin
  useEffect(() => {
    const el = asideRef.current
    if (!el) return
    if (mobile && !mobileNavOpen) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [mobile, mobileNavOpen])

  // Sahifa o'zgarganda drawer yopiladi
  useEffect(() => { setMobileNavOpen(false) }, [location.pathname])

  // admin/super_admin — to'g'ridan-to'g'ri kiradi (EkoHisob admin sifatida)
  // ekohisob_user — asosiy token bilan kiradi (inspector sifatida)
  // EkoHisob o'z tokeni bilan kirganlar — eski usul
  const isMainAdmin = mainAuth && (mainUser?.role === 'admin' || mainUser?.role === 'super_admin')
  const isMainEkoUser = mainAuth && mainUser?.role === 'ekohisob_user'
  const isMainAuth = isMainAdmin || isMainEkoUser
  const isAuthenticated = isMainAuth || ekoAuth

  if (!isAuthenticated) {
    return <Navigate to="/ekohisob/login" replace />
  }

  const user = isMainAuth
    ? { fullName: mainUser!.fullName, email: mainUser!.email, role: isMainAdmin ? 'admin' : 'inspector' }
    : ekoUser

  const isAdmin = isMainAdmin || ekoUser?.role === 'admin'
  // Boshliq (supervisor) — faqat EkoHisob o'z tokeni bilan kiradi, read-only nazoratchi
  const isSupervisor = !isMainAuth && ekoUser?.role === 'supervisor'

  // Ikki guruh. Rol shartlari avvalgidek: Planlar — admin/boshliq, KPI — boshliqdan tashqari,
  // "Boshqaruv" — faqat admin.
  const workItems: NavItem[] = [
    NAV.dashboard, NAV.entities, NAV.map, NAV.reports, NAV.blacklist,
    ...(!isSupervisor ? [NAV.kpi] : []),
    ...(isAdmin || isSupervisor ? [NAV.plans] : []),
  ]
  const adminItems: NavItem[] = isAdmin ? [NAV.audit, NAV.users, NAV.districts, NAV.settings] : []
  const groups = [
    { title: 'Ish', items: workItems },
    ...(adminItems.length ? [{ title: 'Boshqaruv', items: adminItems }] : []),
  ]

  const allItems = [...workItems, ...adminItems]
  const pageTitle = location.pathname.includes('/akt/')
    ? 'Akt sverka'
    : allItems.find(i => location.pathname.includes(`/ekohisob/${i.to}`))?.label ?? 'EkoHisob'

  const scopeText = isAdmin
    ? 'Barcha tumanlar'
    : user && 'districtIds' in user
    ? `${user.districtIds.length} tuman`
    : ''

  const collapsed = !sidebarOpen && !mobile

  async function handleLogout() {
    // Serverda sessiyani bekor qilish (tokenVersion++). Xato bo'lsa ham chiqish davom etadi.
    try { await ekoApi.post('/auth/logout') } catch { /* chiqish baribir bajariladi */ }
    if (isMainAuth) {
      mainLogout()
      navigate('/login')
    } else {
      ekoLogout()
      navigate('/ekohisob/login')
    }
  }

  // Drawer ichida Tab sikli
  function trapTab(e: KeyboardEvent) {
    if (!mobileNavOpen || e.key !== 'Tab') return
    const items = Array.from(asideRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <ConfirmProvider>
    <div className="eko-app flex h-[100dvh] overflow-hidden">
      {/* Mobil orqa fon */}
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 eko-overlay"
          style={{ zIndex: 'calc(var(--eko-z-drawer) - 1)' as unknown as number }}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        id="eko-sidebar"
        ref={asideRef}
        onKeyDown={trapTab}
        aria-label="Asosiy navigatsiya"
        className={cx(
          'eko-nav eko-z-drawer fixed md:relative h-full flex flex-col shrink-0',
          'transition-[transform,width] duration-200',
          'w-[232px]',
          sidebarOpen ? 'md:w-[232px]' : 'md:w-16',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Mahsulot + qamrov */}
        <div className={cx('flex items-center gap-2.5 px-4 h-16 shrink-0', collapsed && 'justify-center px-0')}>
          <BrandMark className="w-7 h-7 shrink-0" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="eko-text-md font-semibold text-eko-text leading-tight">EkoHisob</p>
              {scopeText && <p className="eko-text-xs text-eko-muted truncate">{scopeText}</p>}
            </div>
          )}
          {mobileNavOpen && (
            <IconButton
              label="Menyuni yopish"
              variant="ghost"
              className="md:hidden"
              onClick={() => setMobileNavOpen(false)}
              icon={<X className="w-5 h-5" />}
            />
          )}
        </div>

        {/* Navigatsiya */}
        <nav className="flex-1 px-3 pb-3 overflow-y-auto" aria-label="Bo'limlar">
          {groups.map((g, gi) => (
            <div key={g.title}>
              {!collapsed ? (
                <p className="eko-nav-group-title">{g.title}</p>
              ) : (
                gi > 0 && <div className="my-2 h-px bg-eko-line" />
              )}
              <ul className="space-y-0.5">
                {g.items.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <Tooltip content={collapsed ? label : undefined} side="right" className="flex w-full">
                      <NavLink
                        to={to}
                        aria-label={collapsed ? label : undefined}
                        data-touch={mobile ? 'true' : undefined}
                        data-collapsed={collapsed ? 'true' : undefined}
                        className="eko-nav-item w-full"
                      >
                        <Icon className="w-4 h-4 shrink-0" aria-hidden />
                        {!collapsed && <span className="truncate">{label}</span>}
                      </NavLink>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Pastki qism: yig'ish + foydalanuvchi */}
        <div className="px-3 py-3 border-t border-eko-line shrink-0 space-y-1">
          <button
            type="button"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label={sidebarOpen ? "Menyuni yig'ish" : 'Menyuni kengaytirish'}
            aria-expanded={sidebarOpen}
            data-collapsed={collapsed ? 'true' : undefined}
            className="hidden md:flex eko-nav-item w-full"
          >
            <ChevronsLeft className={cx('w-4 h-4 shrink-0 transition-transform', !sidebarOpen && 'rotate-180')} aria-hidden />
            {!collapsed && <span>Yig'ish</span>}
          </button>

          {user && (
            <div className={cx('flex items-center gap-2.5 pt-1', collapsed && 'flex-col')}>
              <Tooltip content={collapsed ? `${user.fullName} · ${roleLabel(user.role)}` : undefined} side="right">
                <Avatar name={user.fullName} size={32} />
              </Tooltip>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="eko-text-sm font-medium text-eko-text truncate">{user.fullName}</p>
                  <p className="eko-text-xs text-eko-muted">{roleLabel(user.role)}</p>
                </div>
              )}
              <IconButton
                label="Chiqish"
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                icon={<LogOut className="w-4 h-4" />}
              />
            </div>
          )}
        </div>
      </aside>

      {/* Asosiy qism */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* Mobil sarlavha */}
        <header className="md:hidden flex items-center gap-1 px-2 h-14 bg-eko-canvas border-b border-eko-line shrink-0">
          <button
            ref={burgerRef}
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Menyuni ochish"
            aria-expanded={mobileNavOpen}
            aria-controls="eko-sidebar"
            className="w-11 h-11 inline-flex items-center justify-center rounded-eko text-eko-text hover:bg-eko-surface-2"
          >
            <Menu className="w-5 h-5" aria-hidden />
          </button>
          <p className="eko-text-md font-semibold text-eko-text truncate">{pageTitle}</p>
        </header>

        {/* Boshliq (nazoratchi) — faqat o'qish */}
        {isSupervisor && (
          <div className="px-4 sm:px-6 pt-3 shrink-0">
            <Banner tone="warn" icon={<Eye className="w-4 h-4" />}>
              <b>Nazoratchi rejimi</b> — siz o'z tumaningiz ma'lumotlarini kuzatasiz.
              To'lov va o'zgartirish inspektorlar tomonidan bajariladi.
            </Banner>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage readOnly={isSupervisor} isAdmin={isAdmin} />} />
            <Route path="entities" element={<EntitiesPage readOnly={isSupervisor} isAdmin={isAdmin} />} />
            <Route path="map" element={<MapPage readOnly={isSupervisor} />} />
            <Route path="reports" element={<ReportsPage />} />
            {/* Akt sverka — to'liq sahifa. Huquq backendda tekshiriladi. */}
            <Route path="akt/:entityId" element={<ReconciliationPage />} />
            {(isAdmin || isSupervisor) && <Route path="plans" element={<PlansPage />} />}
            <Route path="blacklist" element={<BlacklistPage />} />
            {!isSupervisor && <Route path="kpi" element={<KpiPage isAdmin={isAdmin} />} />}
            {isAdmin && (
              <>
                <Route path="audit" element={<AuditPage />} />
                <Route path="entities/import" element={<EntitiesImportPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admin/users" element={<AdminUsersPage />} />
                <Route path="admin/districts" element={<AdminDistrictsPage />} />
              </>
            )}
            {/* Ruxsatsiz yoki mavjud bo'lmagan manzil — bo'sh ekran o'rniga dashboard */}
            <Route path="*" element={<Navigate to="/ekohisob/dashboard" replace />} />
          </Routes>
        </div>
      </main>
    </div>
    <ForcePasswordChange />
    </ConfirmProvider>
  )
}
