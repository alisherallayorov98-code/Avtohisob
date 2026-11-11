import { Button, Modal, f } from '../ui'
import PaymentFormBody from './payments/PaymentFormBody'
import PaymentSuccess from './payments/PaymentSuccess'
import { usePaymentFlow } from './payments/usePaymentFlow'
import type { EntityBasic } from './payments/types'

export type { EntityBasic }

interface Props {
  entity: EntityBasic
  onClose: () => void
  /** To'lov yozilgach, modal YOPILGANDA chaqiriladi (ro'yxatni yangilash uchun) */
  onSuccess: () => void
}

/**
 * To'lov yozish. Tezkor yo'l: summa kanonik qarz bilan oldindan to'ldirilgan,
 * bitta tugma ("150 000 so'm yozish") tasdiq vazifasini ham bajaradi.
 * Mobilda pastdan chiqadigan varaq (ui/Modal).
 */
export default function PaymentModal({ entity, onClose, onSuccess }: Props) {
  const flow = usePaymentFlow(entity)
  const done = flow.result !== null

  function close() {
    if (done) onSuccess()
    onClose()
  }

  const canSubmit = !flow.fullyPaid || flow.allowAdvance
  const footer = done ? undefined : canSubmit ? (
    <Button
      variant="primary"
      className="flex-1"
      loading={flow.submitting}
      disabled={flow.amount <= 0 || flow.status.isLoading}
      onClick={() => flow.submit(false)}
    >
      {flow.amount > 0 ? `${f.num(flow.amount)} so'm yozish` : "To'lov yozish"}
    </Button>
  ) : (
    <Button className="flex-1" onClick={close}>Yopish</Button>
  )

  return (
    <Modal
      onClose={close}
      size="sm"
      title={done ? "To'lov yozildi" : "To'lov yozish"}
      disableBackdropClose={!done}
      footer={footer}
    >
      {done
        ? <PaymentSuccess entityName={entity.name} result={flow.result!} onClose={close} />
        : <PaymentFormBody entity={entity} flow={flow} />}
    </Modal>
  )
}
