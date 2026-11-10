import { ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Field, Input, Textarea } from './Field'
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
  /** Sabab maydoni ko'rsatiladi (to'lovni bekor qilish kabi amallar). Qiymatni `confirm.ask()` qaytaradi. */
  reasonRequired?: boolean
  /** Sabab uchun minimal belgi soni (default 5) */
  reasonMinLength?: number
  reasonLabel?: string
  reasonPlaceholder?: string
}

export interface ConfirmResult { confirmed: boolean; reason: string }

export interface ConfirmFn {
  /** `true` = tasdiqlandi. Eski API — o'zgarmagan. */
  (opts: ConfirmOptions): Promise<boolean>
  /** Sabab bilan: `{ confirmed, reason }` qaytaradi. */
  ask: (opts: ConfirmOptions) => Promise<ConfirmResult>
}

type Resolver = (r: ConfirmResult) => void

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Tasdiqlash dialogi provayderi. `window.confirm` o'rniga: oqibatlar ro'yxati,
 * xavfli amal qizil, qaytarib bo'lmaydigani ibora yozishni talab qiladi,
 * pul amallari uchun sabab maydoni.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [phrase, setPhrase] = useState('')
  const [reason, setReason] = useState('')
  const resolverRef = useRef<Resolver | null>(null)

  const ask = useCallback((o: ConfirmOptions) => {
    setPhrase('')
    setReason('')
    setOpts(o)
    return new Promise<ConfirmResult>((resolve) => { resolverRef.current = resolve })
  }, [])

  const confirm = useCallback(
    Object.assign((o: ConfirmOptions) => ask(o).then(r => r.confirmed), { ask }),
    [ask],
  ) as ConfirmFn

  function close(ok: boolean) {
    resolverRef.current?.({ confirmed: ok, reason: reason.trim() })
    resolverRef.current = null
    setOpts(null)
    setPhrase('')
    setReason('')
  }

  const minReason = opts?.reasonMinLength ?? 5
  const phraseOk = !opts?.confirmPhrase || phrase.trim() === opts.confirmPhrase
  const reasonOk = !opts?.reasonRequired || reason.trim().length >= minReason

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal
          onClose={() => close(false)}
          size="sm"
          title={opts.title}
          disableBackdropClose={!!opts.confirmPhrase || !!opts.reasonRequired}
          footer={
            <>
              <Button variant="ghost" onClick={() => close(false)} className="flex-1">
                {opts.cancelLabel ?? 'Bekor qilish'}
              </Button>
              <Button
                variant={opts.danger ? 'danger' : 'primary'}
                onClick={() => close(true)}
                disabled={!phraseOk || !reasonOk}
                className="flex-1"
              >
                {opts.confirmLabel ?? 'Tasdiqlash'}
              </Button>
            </>
          }
        >
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-start gap-2.5">
              {opts.danger && <AlertTriangle className="w-5 h-5 text-eko-danger shrink-0 mt-0.5" aria-hidden />}
              <div className="eko-text-base text-eko-text-2">{opts.message}</div>
            </div>

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
                      'eko-text-xs flex items-start gap-1.5',
                      opts.danger ? 'text-eko-danger' : 'text-eko-warn',
                    )}
                  >
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
            )}

            {opts.reasonRequired && (
              <Field
                label={opts.reasonLabel ?? 'Sabab'}
                required
                hint={`Kamida ${minReason} belgi. Jurnalga yoziladi.`}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    data-autofocus
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={opts.reasonPlaceholder}
                  />
                )}
              </Field>
            )}

            {opts.confirmPhrase && (
              <Field label={<>Davom etish uchun <b>{opts.confirmPhrase}</b> deb yozing</>}>
                {(id) => (
                  <Input
                    id={id}
                    data-autofocus={opts.reasonRequired ? undefined : true}
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                  />
                )}
              </Field>
            )}
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

/**
 * Tasdiqlash so'raydi:
 *
 *   const confirm = useConfirm()
 *   if (!await confirm({ title: '...', message: '...', danger: true })) return
 *   const { confirmed, reason } = await confirm.ask({ ..., reasonRequired: true })
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm faqat <ConfirmProvider> ichida ishlaydi')
  }
  return ctx
}
