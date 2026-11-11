// Kirish qulfi mantiqi — PURE (vaqt argument sifatida beriladi).
// 5 ta ketma-ket xato → 15 daqiqa qulf; muvaffaqiyatli kirishda hisoblagich nolga tushadi.

export const MAX_FAILED_LOGINS = 5
export const LOCK_MINUTES = 15
export const LOCK_MS = LOCK_MINUTES * 60 * 1000

export interface LockState {
  failedLogins: number
  lockedUntil: Date | null
}

export function isLocked(lockedUntil: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!lockedUntil) return false
  return new Date(lockedUntil).getTime() > now.getTime()
}

/** Qulf tugashigacha qolgan daqiqalar (yuqoriga yaxlitlanadi); qulf bo'lmasa 0. */
export function lockMinutesLeft(lockedUntil: Date | string | null | undefined, now: Date = new Date()): number {
  if (!isLocked(lockedUntil, now)) return 0
  return Math.ceil((new Date(lockedUntil as any).getTime() - now.getTime()) / 60000)
}

/** Muvaffaqiyatsiz urinishdan keyingi holat. Chegaraga yetsa qulflanadi va hisoblagich nolga tushadi. */
export function onLoginFailure(state: LockState, now: Date = new Date()): LockState & { justLocked: boolean } {
  // Qulf muddati o'tib ketgan bo'lsa — yangi sikl
  const base = state.lockedUntil && !isLocked(state.lockedUntil, now) ? 0 : state.failedLogins
  const next = base + 1
  if (next >= MAX_FAILED_LOGINS) {
    return { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS), justLocked: true }
  }
  return { failedLogins: next, lockedUntil: null, justLocked: false }
}

export function onLoginSuccess(): LockState {
  return { failedLogins: 0, lockedUntil: null }
}
