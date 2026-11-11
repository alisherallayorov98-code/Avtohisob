// Oddiy xotiradagi tezlik cheklovchi (kalit bo'yicha oyna hisoblagichi).
//
// ESLATMA: holat jarayon xotirasida — PM2 qayta ishga tushsa nolga tushadi, ko'p instansiyada
// har biri alohida hisoblaydi. Brute-force/suiiste'mol oldini olish uchun yetarli; qat'iy
// kafolat kerak bo'lsa Redis/DB kerak.

import { Request, Response, NextFunction } from 'express'

export interface LimiterOptions {
  windowMs: number
  max: number
}

export class MemCounter {
  private map = new Map<string, { n: number; reset: number }>()
  constructor(private opts: LimiterOptions) {}

  /** Urinishni sanaydi. true = ruxsat, false = limitdan oshdi. */
  hit(key: string, now: number = Date.now()): boolean {
    const e = this.map.get(key)
    if (!e || now > e.reset) {
      this.map.set(key, { n: 1, reset: now + this.opts.windowMs })
      this.gc(now)
      return true
    }
    if (e.n >= this.opts.max) return false
    e.n++
    return true
  }

  /** Sanamasdan tekshiradi: limitga yetganmi. */
  isBlocked(key: string, now: number = Date.now()): boolean {
    const e = this.map.get(key)
    return !!e && now <= e.reset && e.n >= this.opts.max
  }

  reset(key: string): void { this.map.delete(key) }

  retryAfterSec(key: string, now: number = Date.now()): number {
    const e = this.map.get(key)
    return e ? Math.max(0, Math.ceil((e.reset - now) / 1000)) : 0
  }

  private gc(now: number): void {
    if (this.map.size < 5000) return
    for (const [k, v] of this.map) if (v.reset < now) this.map.delete(k)
    // Baribir juda katta bo'lsa (hujum) — eng eskilarini tashlaymiz
    if (this.map.size > 20000) {
      let i = 0
      for (const k of this.map.keys()) { this.map.delete(k); if (++i > 10000) break }
    }
  }
}

/** Express middleware: har so'rov sanaladi (muvaffaqiyatli yoki yo'q). */
export function makeRateLimit(
  opts: LimiterOptions & { message: string; key: (req: Request) => string },
) {
  const counter = new MemCounter(opts)
  return (req: Request, res: Response, next: NextFunction): void => {
    if (counter.hit(opts.key(req))) { next(); return }
    res.setHeader('Retry-After', String(counter.retryAfterSec(opts.key(req))))
    res.status(429).json({ success: false, error: opts.message })
  }
}
