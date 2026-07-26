import { ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { cx } from './cx'

export interface ConfirmOptions {
  title: string
  /** Asosiy tushuntirish. Nima sodir bo'lishini ANIQ ayting. */
  message: ReactNode
  /** Tasdiqlash tugmasi matni. Amalni nomlang: "O'chirish", "To'lovni bekor qilish" */
  confirmLabel?: string
  cancelLabel?: string
  /** Xavfli amal — qizil tugma va ogohlantirish belgisi */
  danger?: boolean
  /** Qaytarib bo'lmaydigan amal uchun: foydalanuvchi shu iborani yozishi kerak */
  confirmPhrase?: string
  /** Qo'shimcha ogohlantirish (masalan: "Kvitansiya ham bekor qilinadi") */
  consequences?: string[]
}

type Resolver = (ok: boolean) => void

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

/**
 * Tasdiqlash dialogi provayderi.
 *
 * Nega kerak: pul o'chirish kabi amallar `window.confirm` orqali so'ralardi —
 * brauzerning eng xunuk oynasi, dizayni yo'q, xavfli amalni oddiyidan
 * ajratib bo'lmaydi va matnni formatlab bo'lmaydi. Endi oqibatlar ro'yxati
 * ko'rsatiladi, xavfli amal qizil, qaytarib bo'lmaydigani ibora yozishni talab qiladi.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [phrase, setPhrase] = useState('')
  const resolverRef = useRef<Resolver | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    setPhrase('')
    setOpts(o)
    return new Promise<boolean>((resolve) => { resolverRef.current = resolve })
  }, [])

  function close(ok: boolean) {
    resolverRef.current?.(ok)
    resolverRef.current = null
    setOpts(null)
    setPhrase('')
  }

  const phraseOk = !opts?.confirmPhrase || phrase.trim() === opts.confirmPhrase

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal
          onClose={() => close(false)}
          size="sm"
          title={opts.title}
          icon={opts.danger
            ? <AlertTriangle className="w-5 h-5 text-eko-danger" />
            : <Info className="w-5 h-5 text-eko-info" />}
          disableBackdropClose={!!opts.confirmPhrase}
          footer={
            <>
              <Button variant="ghost" onClick={() => close(false)} className="flex-1">
                {opts.cancelLabel ?? 'Bekor qilish'}
              </Button>
              <Button
                variant={opts.danger ? 'danger' : 'primary'}
                onClick={() => close(true)}
                disabled={!phraseOk}
                className="flex-1"
              >
                {opts.confirmLabel ?? 'Tasdiqlash'}
              </Button>
            </>
          }
        >
          <div className="px-5 py-4 space-y-3">
            <div className="text-sm text-eko-text-2 leading-relaxed">{opts.message}</div>

            {opts.consequences && opts.consequences.length > 0 && (
              <ul
                className={cx(
                  'rounded-eko border p-3 space-y-1.5',
                  opts.danger
                    ? 'bg-eko-danger-soft border-eko-danger-line'
                    : 'bg-eko-warn-soft border-eko-warn-line',
                )}
              >
                {opts.consequences.map((c, i) => (
                  <li
                    key={i}
                    className={cx(
                      'text-xs flex items-start gap-1.5',
                      opts.danger ? 'text-eko-danger' : 'text-eko-warn',
                    )}
                  >
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            )}

            {opts.confirmPhrase && (
              <div>
                <label className="block text-xs text-eko-muted mb-1.5">
                  Davom etish uchun <b className="text-eko-text">{opts.confirmPhrase}</b> deb yozing
                </label>
                <input
                  autoFocus
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  className="w-full h-10 px-3 rounded-eko border border-eko-line bg-eko-surface text-sm text-eko-text focus:border-eko-accent"
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

/**
 * Tasdiqlash so'raydi. `window.confirm` o'rniga:
 *
 *   const confirm = useConfirm()
 *   if (!await confirm({ title: '...', message: '...', danger: true })) return
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm faqat <ConfirmProvider> ichida ishlaydi')
  }
  return ctx
}
