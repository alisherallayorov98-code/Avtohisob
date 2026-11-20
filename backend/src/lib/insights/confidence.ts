// Har bir qoidaning ishonch darajasi va asosi. Admin savolga qancha ishonish mumkinligini
// shu yerdan ko'radi. "guess" (taxmin) savol hech qachon ayblov sifatida qabul qilinmasligi kerak —
// avval manba tekshiriladi. Yangi qoida qo'shilsa — shu yerga ham qo'shiladi (test majburlaydi).
import type { Confidence } from './types'

const F = 'fact' as const, S = 'strong' as const, G = 'guess' as const

const MISSING = "Ma'lumot tizimda yo'q — bu aniq fakt, faqat sababi noma'lum."
const CONTRA = "Yozuvning o'zi mantiqqa zid (raqamlar bir-biriga to'g'ri kelmaydi) — aniq fakt."
const DATE = "Sana tizimda yozilgan — muddat hisobi aniq."
const STATUS = "Hujjat holati tizimda shunday turibdi — aniq fakt."
const KEYWORD = "Ta'mir matnidagi kalit so'z bo'yicha topilgan — so'z boshqa qismni bildirishi mumkin. Manbani tekshiring."
const STAT = "Statistik solishtirish — sabab oddiy (mavsum, ish hajmi) bo'lishi mumkin. Manbani tekshiring."
const NORM = "Umumiy tavsiya (km/yil) asosida — mashina holatiga qarab farq qiladi."
const TWO = "Ikki mustaqil manba bir-biriga zid — kuchli belgi, lekin manbalardan biri xato bo'lishi ham mumkin."

export const RULE_CONFIDENCE: Record<string, [Confidence, string]> = {
  'engine.parts_without_passport': [G, KEYWORD],
  'engine.high_mileage_no_passport': [F, MISSING],
  'engine.next_service_passed': [F, "Dvigatel yozuvidagi keyingi xizmat km'i va hozirgi probeg solishtirilgan."],
  'engine.repeated_overhaul': [G, "Dvigatel yozuvi turi bo'yicha — yozuvlar takror kiritilgan bo'lishi ham mumkin."],
  'engine.no_oil_after_overhaul': [F, "Kapital ta'mirdan keyin moy almashtirish yozuvi yo'q — aniq; ish qilinib, kiritilmagan bo'lishi mumkin."],
  'engine.zero_cost': [F, MISSING],
  'engine.mileage_regress': [F, CONTRA],
  'engine.oil_topups': [G, "Moy qo'shish yozuvlari soni bo'yicha — sabab texnik tekshiruvsiz aniq emas."],
  'engine.no_effect_after_overhaul': [G, STAT],
  'engine.repeat_engine_repair': [G, "Ikki dvigatel ta'miri yaqin sanalarda — sabab har xil bo'lishi mumkin."],
  'engine.fuel_system_without_passport': [G, KEYWORD],
  'engine.gearbox_no_interval': [G, KEYWORD],

  'service.no_oil_interval': [F, MISSING],
  'service.oil_overdue_km': [F, "Interval va probeg tizimda — hisob aniq; moy almashtirilib, kiritilmagan bo'lishi mumkin."],
  'service.oil_overdue_days': [F, DATE],
  'service.oil_due_soon': [F, "Interval va probeg bo'yicha hisob — eslatma."],
  'service.oil_history_empty': [F, MISSING],
  'service.oil_too_early': [S, "Bir necha almashtirish orasidagi km tizimdagi intervaldan ancha kam."],
  'service.air_filter': [F, MISSING],
  'service.fuel_filter': [F, MISSING],
  'service.no_anchor': [F, MISSING],
  'service.record_above_current': [F, CONTRA],
  'service.oil_maint_not_recorded': [G, KEYWORD],
  'service.odd_interval': [G, "Interval odatiy chegaradan tashqarida — mashina turiga qarab to'g'ri ham bo'lishi mumkin."],
  'service.model_interval_mismatch': [F, "Bir xil modeldagi mashinalarning intervallari tizimda har xil yozilgan."],
  'service.zero_cost': [F, MISSING],

  'fuel.moved_no_fuel': [S, "GPS yurganini ko'rsatadi, yoqilg'i yozuvi yo'q — ikki manba zid."],
  'fuel.fuel_while_parked': [S, "Quyish kunlari GPS bo'yicha mashina joyidan qo'zg'almagan — ikki manba zid."],
  'fuel.over_norm': [S, "Haqiqiy litr va km (GPS yoki odometr) normaga solishtirilgan; km manbasi noto'g'ri bo'lsa xato chiqishi mumkin."],
  'fuel.no_norm': [F, MISSING],
  'fuel.odometer_regress': [F, CONTRA],
  'fuel.zero_odometer': [F, MISSING],
  'fuel.over_tank': [F, "Bir quyish litri bak hajmidan katta — bak hajmi to'g'ri kiritilgan bo'lsa, aniq fakt."],
  'fuel.multi_fill_day': [S, "Bir kundagi quyishlar yig'indisi bak hajmidan oshgan."],
  'fuel.type_mismatch': [F, "Quyilgan yoqilg'i turi mashina kartochkasidagi turdan farq qiladi."],
  'fuel.price_mismatch': [S, "Litr narxi narx tarixidan farq qiladi — chegirma yoki xato kiritish bo'lishi mumkin."],
  'fuel.import_draft': [F, STATUS],
  'fuel.import_unmatched': [F, STATUS],
  'fuel.above_own_avg': [G, STAT],
  'fuel.above_model_median': [G, STAT],
  'fuel.sensor_theft': [S, "Bak sensori dvigatel o'chiq holatda sathning tushishini qayd etgan; sensor xatosi ham bo'lishi mumkin."],
  'fuel.sensor_unrecorded': [S, "Sensor quyishni ko'rgan, tizimda chek yo'q — ikki manba zid."],
  'fuel.sensor_no_tank': [F, MISSING],
  'fuel.org_spend_up': [G, STAT],
  'fuel.no_supplier': [F, MISSING],
  'fuel.duplicate_fill': [S, "Ikki quyish orasidagi km juda kam — takror kiritilgan bo'lishi mumkin."],

  'gps.not_linked': [F, MISSING],
  'gps.no_signal': [F, "Oxirgi GPS signal sanasi tizimda — aniq fakt."],
  'gps.connection_error': [F, "GPS server javobi xato — tizim jurnali."],
  'gps.cache_gap': [F, "Kunlik km jadvali yangilanmagan — tizim holati."],
  'gps.idle_14d': [S, "GPS bo'yicha mashina joyidan qo'zg'almagan, holati esa \"faol\"."],
  'gps.moving_in_maintenance': [S, "Holati \"ta'mirda\", GPS esa yurganini ko'rsatadi — ikki manba zid."],
  'gps.moving_inactive': [S, "Holati \"nofaol\", GPS esa yurganini ko'rsatadi — ikki manba zid."],
  'gps.km_spike': [G, "Bir kunlik km g'ayrioddiy — uzoq reys bo'lishi yoki GPS sakrashi mumkin."],
  'gps.mileage_stale': [F, DATE],
  'gps.sunday_use': [G, "Yakshanba ishi — navbatchilik yoki rejali ish bo'lishi mumkin."],
  'gps.km_drop': [G, STAT],
  'gps.underused': [G, STAT],

  'documents.insurance_missing': [F, MISSING],
  'documents.insurance_expired': [F, DATE],
  'documents.insurance_soon': [F, DATE],
  'documents.techinsp_missing': [F, MISSING],
  'documents.techinsp_expired': [F, DATE],
  'documents.techinsp_soon': [F, DATE],
  'documents.monthly_inspection_missing': [F, MISSING],
  'documents.critical_inspection_no_repair': [S, "Tekshiruvda KRITIK, keyin ta'mir yozuvi yo'q — ta'mir qilinib, kiritilmagan bo'lishi mumkin."],
  'documents.brakes_not_fixed': [G, "Tormoz ta'miri kalit so'z bo'yicha qidirilgan — boshqa nom bilan yozilgan bo'lishi mumkin."],
  'documents.warranty_soon': [F, DATE],
  'documents.paid_under_warranty': [G, "Qism nomi kafolat yozuvidagi nomga o'xshash — boshqa qism bo'lishi mumkin."],

  'tires.none': [F, MISSING],
  'tires.over_norm': [F, "Shina yurgan km normadan oshgan — tizim hisobi."],
  'tires.no_install_km': [F, MISSING],
  'tires.early_removal': [F, "Shina normadan oldin yechilgan va ushlab qolish yozilmagan — tizim hisobi."],
  'tires.deduction_unsettled': [F, STATUS],
  'tires.stale_stock': [F, DATE],
  'tires.old_dot': [F, "DOT kodidagi ishlab chiqarilgan yil bo'yicha."],
  'tires.position_conflict': [F, CONTRA],
  'tires.zero_price': [F, MISSING],

  'repairs.repeat_part': [S, "Ombordagi bir xil qism (kod bo'yicha) bir mashinaga qisqa vaqtda ikki marta chiqarilgan."],
  'repairs.no_mileage': [F, MISSING],
  'repairs.pending_approval': [F, STATUS],
  'repairs.no_evidence': [F, MISSING],
  'repairs.mileage_above_current': [F, CONTRA],
  'repairs.future_date': [F, CONTRA],
  'repairs.unpaid': [F, STATUS],
  'repairs.labor_heavy': [G, "Ish haqi va qism narxi nisbati — murakkab ishda ish haqi yuqori bo'lishi tabiiy."],
  'repairs.unofficial_share_up': [G, STAT],
  'repairs.old_part_debt': [F, STATUS],
  'repairs.driven_no_repairs': [G, "GPS bo'yicha ko'p yurgan, ta'mir yozuvi yo'q — ta'mir kerak bo'lmagan bo'lishi ham mumkin."],
  'repairs.cost_per_km_top': [G, STAT],
  'repairs.brake_pads': [G, NORM + ' ' + KEYWORD],
  'repairs.timing_belt': [G, NORM + ' ' + KEYWORD],
  'repairs.battery': [G, NORM + ' ' + KEYWORD],
  'repairs.clutch_repeat': [G, KEYWORD],

  'warehouse.low_stock': [F, "Ombor qoldig'i minimal darajadan past — tizim hisobi."],
  'warehouse.dead_stock': [F, DATE],
  'warehouse.transfer_not_received': [F, STATUS],
  'warehouse.request_unanswered': [F, STATUS],
  'warehouse.official_no_invoice': [F, MISSING],
  'warehouse.supplier_debt': [F, "Hisob-faktura va to'lovlar yig'indisi bo'yicha — tizim hisobi."],
  'warehouse.return_pending': [F, STATUS],
  'warehouse.zero_price': [F, MISSING],

  'waybills.open_too_long': [F, STATUS],
  'waybills.no_return_odo': [F, MISSING],
  'waybills.distance_vs_gps': [S, TWO],
  'waybills.fuel_vs_records': [S, TWO],
  'waybills.moved_without': [S, "GPS bo'yicha yurgan kunlar uchun yo'l varaqasi yo'q — ikki manba zid."],
  'waybills.no_mechanic': [F, STATUS],
  'waybills.stale_drafts': [F, STATUS],

  'budget.exceeded': [F, "Reja va haqiqiy xarajat yig'indisi — tizim hisobi."],
  'budget.pace': [F, "Reja va haqiqiy xarajat yig'indisi — tizim hisobi."],
  'budget.no_receipt': [F, MISSING],
  'budget.expense_spike': [G, STAT],
  'budget.inactive_expense': [S, "Holati \"nofaol\", lekin xarajat yozilgan — holat yoki xarajat noto'g'ri."],
  'budget.maint_spend_up': [G, STAT],

  'data.bad_year': [F, CONTRA],
  'data.duplicate_plate': [S, "Davlat raqamlari normallashtirilganda bir xil chiqadi."],
  'data.ghost_vehicle': [F, MISSING],
  'data.placeholder_model': [F, MISSING],
  'data.sold_but_active': [G, "Izohdagi so'z bo'yicha topilgan."],
  'data.duplicate_records': [S, "Bir kunda bir xil summa va miqdordagi yozuvlar — takror kiritish belgisi."],
  'data.branch_no_manager': [F, MISSING],
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  fact: 'Aniq fakt',
  strong: 'Kuchli belgi',
  guess: 'Taxmin',
}
