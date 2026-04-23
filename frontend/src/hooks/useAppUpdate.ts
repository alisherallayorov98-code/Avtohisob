import { useEffect } from 'react'
import toast from 'react-hot-toast'

// If the page has been open longer than this, reload when the user
// switches back to the tab (so we don't interrupt active work).
const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function useAppUpdate() {
  useEffect(() => {
    const pageLoadedAt = Date.now()
    const cleanups: (() => void)[] = []

    // ── Service Worker: auto-reload when new deployment is detected ───────
    // Flow: new sw.js deployed → browser installs new SW → skipWaiting()
    // fires → controllerchange event → we reload so the user gets the
    // new JS/CSS bundle instead of the cached old one.
    if ('serviceWorker' in navigator) {
      // Only auto-reload if this is an UPDATE (not the very first SW install).
      const hadController = !!navigator.serviceWorker.controller
      let reloading = false

      const onControllerChange = () => {
        if (!hadController || reloading) return
        reloading = true
        // Reload immediately — a 2.5s delay risks the user navigating to a
        // lazy-loaded page whose old-hash chunk was just removed from cache.
        toast.loading('Yangi versiya yuklanmoqda…', { id: 'app-update', duration: 1000 })
        setTimeout(() => window.location.reload(), 500)
      }

      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
      cleanups.push(() =>
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      )

      // Poke the SW registration every hour so the browser notices new sw.js
      // files sooner than its default 24-hour check interval.
      const swCheck = setInterval(() => {
        navigator.serviceWorker.ready.then(r => r.update()).catch(() => {})
      }, 60 * 60 * 1000) // every 1 hour
      cleanups.push(() => clearInterval(swCheck))
    }

    // ── Daily auto-reload when the user returns to the tab ────────────────
    // If the tab has been sitting in the background for more than 24 hours
    // we reload as soon as the user switches back to it.  This guarantees
    // everyone runs a fresh build at least once per day without interrupting
    // an active session.
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - pageLoadedAt > ONE_DAY_MS
      ) {
        window.location.reload()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    cleanups.push(() => document.removeEventListener('visibilitychange', onVisible))

    return () => cleanups.forEach(fn => fn())
  }, [])
}
