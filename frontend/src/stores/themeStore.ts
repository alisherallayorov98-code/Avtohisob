import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ThemeState {
  isDark: boolean
  toggle: () => void
  setDark: (v: boolean) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: false,
      toggle: () => set(s => {
        const next = !s.isDark
        document.documentElement.classList.toggle('dark', next)
        return { isDark: next }
      }),
      setDark: (v) => set(() => {
        document.documentElement.classList.toggle('dark', v)
        return { isDark: v }
      }),
    }),
    { name: 'theme-storage' }
  )
)

// Apply on load
const stored = localStorage.getItem('theme-storage')
if (stored) {
  try {
    const parsed = JSON.parse(stored)
    if (parsed?.state?.isDark) document.documentElement.classList.add('dark')
  } catch {}
}
