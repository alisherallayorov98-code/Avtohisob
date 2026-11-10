import { useEffect, useRef, useState, RefObject } from 'react'

/** CSS media query holatini kuzatadi. SSR/test muhitida `false`. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const on = () => setMatches(mql.matches)
    on()
    mql.addEventListener?.('change', on)
    return () => mql.removeEventListener?.('change', on)
  }, [query])
  return matches
}

/** Tailwind `md` (768px) dan kichik ekran = mobil. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)')
}

/** Sensorli qurilma (hover yo'q) — Tooltip title'ga o'tishi uchun. */
export function useIsTouch(): boolean {
  return useMediaQuery('(hover: none)')
}

/** Element tashqarisiga bosilganda `handler` chaqiriladi. */
export function useOutsideClick(refs: RefObject<HTMLElement>[], handler: () => void, active = true) {
  const h = useRef(handler)
  h.current = handler
  useEffect(() => {
    if (!active) return
    function on(e: MouseEvent | TouchEvent) {
      const t = e.target as Node
      if (refs.some(r => r.current?.contains(t))) return
      h.current()
    }
    document.addEventListener('mousedown', on)
    document.addEventListener('touchstart', on)
    return () => {
      document.removeEventListener('mousedown', on)
      document.removeEventListener('touchstart', on)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
