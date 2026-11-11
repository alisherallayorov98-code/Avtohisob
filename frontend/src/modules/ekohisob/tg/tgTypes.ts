export interface CardData {
  entity: {
    id: string; name: string; address?: string | null; phone?: string | null
    contactName?: string | null; lat?: number | null; lon?: number | null
    status: string; billingMode: 'monthly_fixed' | 'variable' | 'talon'
    monthlyFee: number; cubicPrice: number
    district?: { name: string }; mahalla?: { name: string } | null
  }
  completeness: { percent: number; missingRequired: Array<{ label: string }> }
  debt: { totalDebt: number; debtMonths: number; unpaidMonths: string[]; level: string }
  payments: Array<{ id: string; month: string; amount: number; paidAt: string }>
}

export interface PayResult { amount: number; remaining: number; receipt?: string; replay: boolean }

export interface VisitMark { kind: 'not_paid' | 'promised' | 'visited'; promisedDate?: string | null }

export interface VisitRow {
  id: string; kind: VisitMark['kind']; reason?: string | null
  promisedDate?: string | null; createdAt: string; userName?: string | null
}

export interface LocalPay { id: string; amount: number; remaining: number; ts: number }
export interface LocalVisit { id: string; mark: VisitMark; ts: number }
