// Sessiyalar ombori: TTL (harakatsizlikdan keyin) bilan. Pure — vaqt tashqaridan beriladi.

export const SESSION_TTL_MS = 30 * 60 * 1000

export interface BotSession { state: string; data: Record<string, any> }

interface Entry extends BotSession { touched: number }

export class SessionStore {
  private map = new Map<string, Entry>()
  constructor(
    private ttlMs = SESSION_TTL_MS,
    private now: () => number = () => Date.now(),
    private maxSize = 5000,
  ) {}

  /** Joriy sessiya; muddati o'tgan bo'lsa idle + expired=true (faqat faol holat bo'lgan bo'lsa). */
  take(id: string): { session: BotSession; expired: boolean } {
    const e = this.map.get(id)
    if (!e) return { session: this.fresh(id), expired: false }
    if (this.now() - e.touched > this.ttlMs) {
      this.map.delete(id)
      return { session: this.fresh(id), expired: e.state !== 'idle' }
    }
    e.touched = this.now()
    return { session: e, expired: false }
  }

  get(id: string): BotSession { return this.take(id).session }

  private fresh(id: string): BotSession {
    const e: Entry = { state: 'idle', data: {}, touched: this.now() }
    this.map.set(id, e)
    this.evict()
    return e
  }

  set(id: string, state: string, data: Record<string, any> = {}): void {
    this.map.set(id, { state, data, touched: this.now() })
    this.evict()
  }

  clear(id: string): void { this.map.delete(id) }

  size(): number { return this.map.size }

  sweep(): number {
    let n = 0
    for (const [k, e] of this.map) {
      if (this.now() - e.touched > this.ttlMs) { this.map.delete(k); n++ }
    }
    return n
  }

  private evict(): void {
    if (this.map.size <= this.maxSize) return
    this.sweep()
    while (this.map.size > this.maxSize) {
      const k = this.map.keys().next().value as string
      this.map.delete(k)
    }
  }
}
