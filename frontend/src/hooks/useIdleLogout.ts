import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores/authStore'

const IDLE_LIMIT_MS = 60 * 60 * 1000
const WARN_BEFORE_MS = 5 * 60 * 1000
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const

export function useIdleLogout() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const logout = useAuthStore(s => s.logout)
  const warnTimerRef = useRef<number | null>(null)
  const logoutTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return

    const clear = () => {
      if (warnTimerRef.current != null) window.clearTimeout(warnTimerRef.current)
      if (logoutTimerRef.current != null) window.clearTimeout(logoutTimerRef.current)
      warnTimerRef.current = null
      logoutTimerRef.current = null
    }

    const reset = () => {
      clear()
      warnTimerRef.current = window.setTimeout(() => {
        toast('Sessiya 5 daqiqadan keyin yakunlanadi. Harakat qilsangiz saqlanadi.', {
          icon: '⏳',
          duration: 10_000,
          id: 'idle-warning',
        })
      }, IDLE_LIMIT_MS - WARN_BEFORE_MS)
      logoutTimerRef.current = window.setTimeout(() => {
        toast.error('Uzoq vaqt harakatsizlik — sessiya yakunlandi', { duration: 6000 })
        logout()
        window.location.href = '/login'
      }, IDLE_LIMIT_MS)
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true })
    }
    reset()

    return () => {
      clear()
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, reset)
      }
    }
  }, [isAuthenticated, logout])
}
