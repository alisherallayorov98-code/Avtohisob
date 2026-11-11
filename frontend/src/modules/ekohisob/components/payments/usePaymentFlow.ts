import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { parseEkoError, newIdempotencyKey } from '../../lib/ekoErrors'
import { ekoKeys, invalidateEko } from '../../lib/queries'
import {
  currentMonth, parseAmount, totalDebt, previewAllocation, advanceOf, PaymentMethod,
} from './paymentMath'
import type { ChargeStatus, DuplicateInfo, EntityBasic, PaymentResult } from './types'

/**
 * To'lov yozish oqimi: holatni yuklash, summani oldindan to'ldirish, taqsimot
 * preview'i va yuborish. Idempotency kaliti modal ochilganda BIR MARTA yaratiladi;
 * faqat to'lov ma'lumoti (summa/oy/usul/izoh) o'zgarsa yangisi olinadi — shunda
 * tarmoq uzilganda qayta yuborish dublikat yaratmaydi (server o'sha natijani qaytaradi).
 */
export function usePaymentFlow(entity: EntityBasic) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(entity.unpaidMonths?.[0] ?? currentMonth())
  const [amountText, setAmountText] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [allowAdvance, setAllowAdvance] = useState(false)
  const touched = useRef(false)
  const keyRef = useRef({ key: newIdempotencyKey(), sig: '' })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null)
  const [result, setResult] = useState<PaymentResult | null>(null)

  const status = useQuery<ChargeStatus>({
    queryKey: [...ekoKeys.payments, 'charge-status', entity.id, month],
    queryFn: async () => {
      const res = await ekoApi.get('/payments/charge-status', { params: { entityId: entity.id, month } })
      return res.data.data ?? res.data
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const monthRemaining = status.data?.remaining ?? 0
  const openDebts = useMemo(() => status.data?.openDebts ?? [], [status.data])
  const total = totalDebt(monthRemaining, openDebts)
  const amount = parseAmount(amountText)

  // Tanlangan oylar ro'yxati to'planib boradi (oy almashtirilganda yo'qolmasin)
  const knownMonths = useRef(new Set<string>([month]))
  openDebts.forEach(d => knownMonths.current.add(d.month))
  knownMonths.current.add(month)

  // Foydalanuvchi summani o'zgartirmagan bo'lsa — kanonik qarz bilan to'ldiramiz
  useEffect(() => {
    if (!status.data || touched.current) return
    const d = status.data
    const prefill = total > 0 ? total : (d.paidAmount === 0 ? (d.expectedAmount || entity.monthlyFee || 0) : 0)
    setAmountText(prefill > 0 ? String(prefill) : '')
  }, [status.data, total, entity.monthlyFee])

  const plan = amount > 0 ? previewAllocation(amount, month, monthRemaining, openDebts) : []
  const advance = advanceOf(amount, monthRemaining, openDebts)
  const fullyPaid = !!status.data && total === 0 && status.data.paidAmount > 0

  function setAmount(v: number | string) {
    touched.current = true
    setAmountText(String(parseAmount(v) || ''))
    setDuplicate(null)
    setError(null)
  }

  async function submit(force = false) {
    if (submitting) return
    if (amount <= 0) { setError("Summani kiriting"); return }
    const payload = {
      entityId: entity.id, month, amount, method,
      note: note.trim() || undefined,
    }
    const sig = JSON.stringify(payload)
    if (keyRef.current.sig && keyRef.current.sig !== sig) keyRef.current = { key: newIdempotencyKey(), sig: '' }
    keyRef.current.sig = sig

    setSubmitting(true)
    setError(null)
    setDuplicate(null)
    try {
      const res = await ekoApi.post('/payments', {
        ...payload, idempotencyKey: keyRef.current.key, ...(force ? { force: true } : {}),
      })
      const d = res.data.data ?? res.data
      setResult({
        amount,
        month,
        receiptNumber: d?.receiptNumber ?? null,
        receiptId: d?.receiptId ?? null,
        allocations: Array.isArray(d?.allocations) ? d.allocations : [],
        remaining: typeof d?.remaining === 'number' ? d.remaining : null,
        advance: typeof d?.advance === 'number' ? d.advance : 0,
        idempotentReplay: Boolean(d?.idempotentReplay),
      })
      invalidateEko(qc, 'payment')
    } catch (err) {
      const info = parseEkoError(err)
      if (info.code === 'DUPLICATE_PAYMENT') setDuplicate((info.data as DuplicateInfo) ?? {})
      else setError(info.message)
    } finally {
      setSubmitting(false)
    }
  }

  return {
    month, setMonth: (m: string) => { setMonth(m); setError(null); setDuplicate(null) },
    amount, amountText, setAmount, method, setMethod, note, setNote,
    allowAdvance, setAllowAdvance,
    status, monthRemaining, openDebts, total, plan, advance, fullyPaid,
    knownMonths: Array.from(knownMonths.current).sort(),
    submitting, error, duplicate, result, submit,
  }
}
