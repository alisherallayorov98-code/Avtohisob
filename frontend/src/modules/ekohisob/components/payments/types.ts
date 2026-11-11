import type { Allocation, OpenDebt } from './paymentMath'

export interface EntityBasic {
  id: string
  name: string
  address: string
  monthlyFee: number
  /** 'YYYY-MM' ro'yxati (eng eskisi birinchi) — boshlang'ich oy */
  unpaidMonths?: string[]
  billingMode?: string
}

export interface ChargeStatus {
  expectedAmount: number
  paidAmount: number
  /** TANLANGAN oy bo'yicha qolgan qarz */
  remaining: number
  status: string
  billingMode: string
  /** Tanlangan oydan boshqa ochiq qarz oylari */
  openDebts?: OpenDebt[]
}

export interface PaymentResult {
  amount: number
  month: string
  receiptNumber: string | null
  receiptId: string | null
  allocations: Allocation[]
  /** To'lovdan keyin JAMI qolgan qarz */
  remaining: number | null
  advance: number
  idempotentReplay: boolean
}

export interface DuplicateInfo { paidAt?: string; receiptNumber?: string | null }
