// Tahlil saralash: qaysi savolni robot filialga o'zi yuboradi ("auto"), qaysi biri
// faqat admin qaroriga qoladi ("admin"). Maqsad — admin 100+ savolni emas, kuniga
// bir necha qarorni ko'rsin. Ma'lumot yetishmaydigan savollar filialga avtomatik ketadi,
// javobini esa robot o'zi tekshiradi (verify.ts).

import type { FindingOut } from './types'

export type Tier = 'auto' | 'admin'

/** Shundan katta pul ta'siri bo'lsa — savol har doim admin ko'zidan o'tadi */
export const BIG_MONEY_UZS = 2_000_000

/** Filial bilan emas, admin bilan hal qilinadigan savollar: shubha, pul, qaror */
export const ADMIN_RULES = new Set<string>([
  // Yoqilg'i: o'g'irlik/ortiqcha sarf shubhasi — filial o'zini o'zi tekshira olmaydi
  'fuel.moved_no_fuel', 'fuel.fuel_while_parked', 'fuel.over_norm', 'fuel.over_tank', 'fuel.multi_fill_day',
  'fuel.type_mismatch', 'fuel.price_mismatch', 'fuel.above_own_avg', 'fuel.above_model_median',
  'fuel.sensor_theft', 'fuel.sensor_unrecorded', 'fuel.duplicate_fill', 'fuel.org_spend_up',
  'fuel.import_draft', 'fuel.import_unmatched', 'fuel.no_supplier',
  // GPS: mashinadan noto'g'ri foydalanish
  'gps.moving_in_maintenance', 'gps.moving_inactive', 'gps.km_spike', 'gps.sunday_use', 'gps.km_drop', 'gps.underused',
  'gps.connection_error', 'gps.cache_gap',
  // Yo'l varaqasi va GPS ziddiyati
  'waybills.distance_vs_gps', 'waybills.fuel_vs_records', 'waybills.moved_without',
  // Ta'mir: sifat, pul, tasdiq — admin ishi
  'repairs.repeat_part', 'repairs.clutch_repeat', 'repairs.labor_heavy', 'repairs.unpaid', 'repairs.pending_approval',
  'repairs.unofficial_share_up', 'repairs.cost_per_km_top',
  'engine.no_effect_after_overhaul', 'documents.paid_under_warranty',
  // Byudjet va tashkilot darajasidagi masalalar
  'budget.exceeded', 'budget.pace', 'budget.no_receipt', 'budget.expense_spike', 'budget.inactive_expense', 'budget.maint_spend_up',
  'data.duplicate_plate', 'data.sold_but_active', 'data.branch_no_manager',
  'service.model_interval_mismatch', 'service.oil_too_early',
])

export function tierOf(f: Pick<FindingOut, 'ruleKey' | 'vehicleId' | 'branchId' | 'impactUzs' | 'mergedFrom'>): Tier {
  // Mashinaga bog'lanmagan (tashkilot darajasidagi) savol — qaysi filialga yuborishni bilmaymiz
  if (!f.vehicleId || !f.branchId) return 'admin'
  if ((f.impactUzs || 0) >= BIG_MONEY_UZS) return 'admin'
  if (ADMIN_RULES.has(f.ruleKey)) return 'admin'
  if (f.mergedFrom?.some(k => ADMIN_RULES.has(k))) return 'admin'
  return 'auto'
}

/** Bitta filialga bir kunda avtomatik yuboriladigan savollar chegarasi (birinchi kun to'lib ketmasin) */
export const AUTO_SEND_PER_BRANCH_PER_DAY = 15
/** Avtomatik so'rovga javob muddati (kun) */
export const AUTO_SEND_DUE_DAYS = 3
