import { useState } from 'react'
import { CheckCircle2, Printer } from 'lucide-react'
import { Banner, Button, MoneyText, f } from '../../ui'
import { openReceiptPrint } from './receiptPrint'
import type { PaymentResult } from './types'

/** Muvaffaqiyat ekrani: avtomatik yopilmaydi — inspektor kvitansiyani ko'rib, o'zi yopadi. */
export default function PaymentSuccess({
  entityName, result, onClose,
}: { entityName: string; result: PaymentResult; onClose: () => void }) {
  const [printing, setPrinting] = useState(false)
  const r = result
  async function print() {
    if (!r.receiptId) return
    setPrinting(true)
    await openReceiptPrint(r.receiptId)
    setPrinting(false)
  }
  return (
    <div className="px-5 py-6 space-y-4 text-center">
      <div className="w-12 h-12 rounded-full bg-eko-success-soft text-eko-success flex items-center justify-center mx-auto">
        <CheckCircle2 className="w-6 h-6" aria-hidden />
      </div>
      <div>
        <p className="eko-text-base text-eko-muted">To'lov yozildi</p>
        <p className="text-eko-text font-semibold eko-text-lead eko-num mt-1">
          <MoneyText value={r.amount} />
        </p>
        <p className="eko-text-sm text-eko-muted mt-1">{entityName} · {f.monthLabel(r.month)}</p>
      </div>
      {r.receiptNumber && (
        <div className="border border-eko-line rounded-eko-lg p-3">
          <p className="eko-text-xs text-eko-muted">Kvitansiya raqami</p>
          <p className="font-mono eko-text-lg font-semibold text-eko-text tracking-wider">{r.receiptNumber}</p>
        </div>
      )}
      {r.allocations.length > 1 && (
        <div className="text-left border border-eko-line rounded-eko-lg p-3">
          <p className="eko-text-xs text-eko-muted mb-1.5">{r.allocations.length} oyga taqsimlandi</p>
          <ul className="space-y-1">
            {r.allocations.map(a => (
              <li key={a.month} className="flex justify-between eko-text-sm">
                <span className="text-eko-text-2">{f.monthLabel(a.month)}</span>
                <MoneyText value={a.amount} className="font-medium text-eko-text" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.idempotentReplay && (
        <Banner tone="info" className="text-left">Bu to'lov avval yozilgan edi — takror yaratilmadi.</Banner>
      )}
      {r.remaining != null && r.remaining > 0 && (
        <Banner tone="warn" className="text-left">Qarz qoldi: <b>{f.money(r.remaining)}</b></Banner>
      )}
      {r.remaining === 0 && <p className="eko-text-sm text-eko-success">Qarz qolmadi</p>}
      {r.advance > 0 && (
        <Banner tone="info" className="text-left">Avans sifatida qoldi: <b>{f.money(r.advance)}</b></Banner>
      )}
      <div className="flex gap-2 pt-1">
        {r.receiptId && (
          <Button className="flex-1" icon={<Printer className="w-4 h-4" aria-hidden />} loading={printing} onClick={print}>
            Chop etish
          </Button>
        )}
        <Button variant="primary" className="flex-1" onClick={onClose} data-autofocus>Yopish</Button>
      </div>
    </div>
  )
}
