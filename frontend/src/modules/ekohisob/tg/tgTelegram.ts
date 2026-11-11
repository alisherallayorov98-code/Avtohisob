import { useEffect, useRef, useState } from 'react'

/**
 * Telegram WebApp integratsiyasi (tema, BackButton, MainButton, online holati).
 * Telegram API faqat Telegram ichida bor — brauzerda hammasi "yo'q" bo'lib, oddiy
 * sahifa tugmalariga qaytiladi (`useMainButton` false qaytaradi).
 */

export function webApp(): any | null {
  return (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) || null
}

/** Haqiqiy Telegram ichidamizmi (initData bor). */
export function inTelegram(): boolean {
  return Boolean(webApp()?.initData)
}

function supports(version: string): boolean {
  const tg = webApp()
  try { return Boolean(tg?.isVersionAtLeast?.(version)) } catch { return false }
}

// ── Tokenlar → rang (xarita markerlari, Telegram sarlavha ranglari) ──────────

/** `--eko-*` tokenini [r,g,b] qilib o'qiydi (.eko-app dan, ya'ni joriy mavzu bilan). */
export function tokenRgb(name: string): [number, number, number] {
  const el = document.querySelector('.eko-app') ?? document.documentElement
  const raw = getComputedStyle(el).getPropertyValue(name).trim()
  const parts = raw.split(/\s+/).map(Number)
  return parts.length >= 3 && parts.every(Number.isFinite) ? [parts[0], parts[1], parts[2]] : [128, 128, 128]
}

/** Canvas (Leaflet) uchun: "rgb(r,g,b)". */
export function tokenColor(name: string): string {
  const [r, g, b] = tokenRgb(name)
  return `rgb(${r},${g},${b})`
}

export function tokenHex(name: string): string {
  const [r, g, b] = tokenRgb(name)
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

// ── Mavzu ────────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light'

function detectTheme(): Theme {
  const tg = webApp()
  if (tg?.colorScheme) return tg.colorScheme === 'dark' ? 'dark' : 'light'
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Telegram `colorScheme` + `themeChanged` (brauzerda prefers-color-scheme). */
export function useTelegramTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(detectTheme)
  useEffect(() => {
    const tg = webApp()
    const on = () => setTheme(detectTheme())
    if (tg?.onEvent) {
      tg.onEvent('themeChanged', on)
      return () => tg.offEvent?.('themeChanged', on)
    }
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)')
    mql?.addEventListener?.('change', on)
    return () => mql?.removeEventListener?.('change', on)
  }, [])
  return theme
}

/** Telegram sarlavha/fon/pastki panel rangini ilova tokenlariga moslaydi. Mavzu o'zgarganda chaqiring. */
export function syncTelegramChrome() {
  const tg = webApp()
  if (!tg || !inTelegram()) return
  try {
    if (supports('6.1')) {
      tg.setHeaderColor?.(tokenHex('--eko-surface'))
      tg.setBackgroundColor?.(tokenHex('--eko-canvas'))
    }
    if (supports('7.10')) tg.setBottomBarColor?.(tokenHex('--eko-surface'))
  } catch (e) {
    // Eski mijozlarda rang API'si bo'lmasligi mumkin — faqat bezak
    console.warn('Telegram chrome colors', e)
  }
}

// ── Online / offline ─────────────────────────────────────────────────────────

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

// ── BackButton ───────────────────────────────────────────────────────────────

/** `handler` berilsa Telegram "Orqaga" tugmasi ko'rinadi va shuni chaqiradi; null — yashirin. */
export function useBackButton(handler: (() => void) | null) {
  const ref = useRef(handler)
  ref.current = handler
  const active = handler != null
  useEffect(() => {
    const tg = webApp()
    const bb = tg?.BackButton
    if (!active || !bb || !inTelegram()) return
    const cb = () => ref.current?.()
    bb.onClick(cb)
    bb.show()
    return () => { bb.offClick(cb); bb.hide() }
  }, [active])
}

// ── MainButton ───────────────────────────────────────────────────────────────

export interface MainButtonOpts {
  text: string
  onClick: () => void
  visible: boolean
  loading?: boolean
  disabled?: boolean
}

/**
 * Telegram pastki asosiy tugma. `true` qaytsa — tugma Telegram'da (sahifada o'z tugmangizni
 * KO'RSATMANG); `false` — brauzer/eski mijoz, oddiy tugmaga qayting.
 */
export function useMainButton({ text, onClick, visible, loading, disabled }: MainButtonOpts): boolean {
  const tg = webApp()
  const native = Boolean(tg?.MainButton && inTelegram())
  const cbRef = useRef(onClick)
  cbRef.current = onClick

  // Ko'rsatish/yashirish + bosish
  useEffect(() => {
    const mb = webApp()?.MainButton
    if (!native || !visible || !mb) return
    const cb = () => cbRef.current()
    mb.onClick(cb)
    try {
      mb.setParams({ color: tokenHex('--eko-accent'), text_color: tokenHex('--eko-on-accent') })
    } catch (e) {
      console.warn('MainButton colors', e)
    }
    mb.show()
    return () => { mb.offClick(cb); mb.hideProgress?.(); mb.hide() }
  }, [native, visible])

  // Matn/holat
  useEffect(() => {
    const mb = webApp()?.MainButton
    if (!native || !visible || !mb) return
    mb.setText(text)
    if (disabled || loading) mb.disable(); else mb.enable()
    if (loading) mb.showProgress(false); else mb.hideProgress()
  }, [native, visible, text, disabled, loading])

  return native
}

// ── Tasdiqlash va tashqi havola ──────────────────────────────────────────────

/** Telegram'ning o'z tasdiqlash oynasi (bo'lsa). `null` — mavjud emas, ilova ichki dialogidan foydalaning. */
export function nativeConfirm(message: string): Promise<boolean> | null {
  const tg = webApp()
  if (!tg?.showConfirm || !inTelegram() || !supports('6.2')) return null
  return new Promise(resolve => tg.showConfirm(message, (ok: boolean) => resolve(Boolean(ok))))
}

/** Tashqi havola (xarita yo'nalishi): Telegram ichida `openLink`, aks holda oddiy havola. */
export function openExternal(url: string, ev?: { preventDefault: () => void }): void {
  const tg = webApp()
  if (tg?.openLink && inTelegram()) {
    ev?.preventDefault()
    tg.openLink(url)
  }
}

/** Yengil tebranish (to'lov muvaffaqiyati) — bo'lmasa jim. */
export function hapticSuccess() {
  const tg = webApp()
  try { tg?.HapticFeedback?.notificationOccurred('success') } catch (e) { console.warn('haptic', e) }
}
