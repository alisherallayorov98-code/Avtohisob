import { previewLanded } from './landed'

// Import kirim formasi: tur, bo'sh holat, serverdagi hujjat/qoralamadan tiklash va jonli hisob.

export type CostGroup = 'customs' | 'other'
export type CostMode = 'total' | 'per_unit'

export interface FormLine {
  productId: string; quantity: string; price: string
  unitWeightKg: string; levyRateId: string; levyPercent: string
}
export interface FormCost { label: string; amount: string; mode: CostMode; group: CostGroup }
export interface FormState {
  warehouseId: string; supplierId: string; invoiceNumber: string
  currency: string; rate: string; allocBy: 'value' | 'quantity'; isOfficial: boolean
  notes: string; minWage: string; lines: FormLine[]; costs: FormCost[]
}

export const EMPTY_LINE: FormLine = { productId: '', quantity: '', price: '', unitWeightKg: '', levyRateId: '', levyPercent: '' }

export const GROUP_META: Record<CostGroup, { title: string; hint: string; presets: string[] }> = {
  customs: {
    title: 'Bojxona xarajatlari',
    hint: "bojxona to'lovlari: boj, rasmiylashtirish, aksiz ...",
    presets: ['Bojxona boji', 'Bojxona rasmiylashtiruvi', 'Aksiz', "Bojxona yig'imi", 'Bojxona omborida saqlash'],
  },
  other: {
    title: "Qo'shimcha xarajatlar",
    hint: 'sertifikat, transport, deklarant xizmati va boshqalar (bojxonaga kirmaydi)',
    presets: ['Transport', 'Sertifikat', 'Deklarant xizmati', 'Ekspeditor', "Sug'urta", 'Bank komissiyasi', 'Yuklash-tushirish'],
  },
}

export function emptyForm(warehouseId = '', minWage = ''): FormState {
  return {
    warehouseId, supplierId: '', invoiceNumber: '', currency: 'USD', rate: '', allocBy: 'value', isOfficial: true,
    notes: '', minWage, lines: [{ ...EMPTY_LINE }], costs: [],
  }
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

function costFrom(c: any): FormCost {
  return {
    label: str(c.label), amount: str(c.amount),
    mode: c.mode === 'per_unit' ? 'per_unit' : 'total',
    group: c.group === 'customs' ? 'customs' : 'other',
  }
}

/** Serverdagi qoralama (draftPayload) yoki formaning o'zi (localStorage) -> forma holati. */
export function fromPayload(p: any, fallbackWage = ''): FormState {
  const base = emptyForm('', fallbackWage)
  if (!p) return base
  return {
    ...base,
    warehouseId: str(p.warehouseId), supplierId: str(p.supplierId), invoiceNumber: str(p.invoiceNumber),
    currency: str(p.currency) || 'USD',
    rate: str(p.rate ?? (p.currency === 'UZS' ? '' : p.exchangeRate)),
    allocBy: p.allocBy === 'quantity' ? 'quantity' : 'value', isOfficial: p.isOfficial !== false,
    notes: str(p.notes), minWage: str(p.minWage) || fallbackWage,
    lines: (Array.isArray(p.lines) && p.lines.length ? p.lines : [{}]).map((l: any) => ({
      productId: str(l.productId), quantity: str(l.quantity), price: str(l.price),
      unitWeightKg: str(l.unitWeightKg), levyRateId: str(l.levyRateId), levyPercent: str(l.levyPercent),
    })),
    costs: (Array.isArray(p.costs) ? p.costs : []).map(costFrom),
  }
}

/** Kirim qilingan hujjat (GET /purchase-docs/:id) -> tahrirlash formasi. */
export function fromDoc(d: any): FormState {
  return {
    warehouseId: str(d.warehouseId), supplierId: str(d.supplierId), invoiceNumber: str(d.invoiceNumber),
    currency: str(d.currency) || 'USD', rate: d.currency === 'UZS' ? '' : str(Number(d.exchangeRate)),
    allocBy: d.allocBy === 'quantity' ? 'quantity' : 'value', isOfficial: d.isOfficial !== false,
    notes: str(d.notes), minWage: d.minWage != null ? str(Number(d.minWage)) : '',
    lines: d.purchases.map((p: any) => ({
      productId: p.productId, quantity: str(p.quantity), price: str(Number(p.foreignPrice ?? p.unitCost)),
      unitWeightKg: p.unitWeightKg != null ? str(Number(p.unitWeightKg)) : '',
      levyRateId: str(p.levyRateId), levyPercent: p.levyPercent != null ? str(Number(p.levyPercent)) : '',
    })),
    costs: d.costs.map((c: any) => costFrom({ ...c, amount: Number(c.amount) })),
  }
}

/** Serverga yuboriladigan tana (to'ldirilgan qatorlar/xarajatlar). */
export function toBody(f: FormState) {
  const isUzs = f.currency.trim().toUpperCase() === 'UZS'
  return {
    warehouseId: f.warehouseId, supplierId: f.supplierId || null, invoiceNumber: f.invoiceNumber.trim() || null,
    currency: f.currency.trim().toUpperCase(), exchangeRate: isUzs ? 1 : Number(f.rate),
    allocBy: f.allocBy, isOfficial: f.isOfficial, notes: f.notes.trim() || null,
    minWage: Number(f.minWage) > 0 ? Number(f.minWage) : null,
    costs: f.costs.filter(c => c.label.trim() && Number(c.amount) > 0).map(c => ({
      label: c.label.trim(), amount: Number(c.amount), mode: c.mode, group: c.group,
    })),
    lines: f.lines.filter(l => l.productId && Number(l.quantity) > 0).map(l => ({
      productId: l.productId, quantity: Number(l.quantity), price: Number(l.price) || 0,
      unitWeightKg: l.unitWeightKg !== '' ? Number(l.unitWeightKg) : null,
      levyRateId: l.levyRateId || null, levyPercent: l.levyPercent !== '' ? Number(l.levyPercent) : null,
    })),
  }
}

/** Qoralama uchun YENGIL tana: to'liq bo'lmasa ham saqlanadi (hech narsa yo'qolmasin). */
export function toDraftBody(f: FormState, docId: string | null) {
  return {
    docId, warehouseId: f.warehouseId, supplierId: f.supplierId || null, invoiceNumber: f.invoiceNumber,
    currency: f.currency, exchangeRate: f.currency.trim().toUpperCase() === 'UZS' ? 1 : (Number(f.rate) || null),
    rate: f.rate, allocBy: f.allocBy, isOfficial: f.isOfficial, notes: f.notes, minWage: f.minWage || null,
    costs: f.costs, lines: f.lines,
  }
}

export interface LiveTotals {
  goodsLocal: number; customs: number; other: number; levy: number; extra: number; extraPct: number; landed: number
  perLine: { unitCost: number; extraCustoms: number; extraOther: number; levy: number; extraCost: number; lineTotal: number }[]
}

const r2 = (n: number): number => Math.round(n * 100) / 100

/** Jonli hisob — backend lib/landedCost.ts (computeLandedCostGrouped) bilan bir xil algoritm. */
export function liveTotals(
  lines: { quantity: number; price: number; fixedExtra: number }[], rate: number,
  costs: { amount: number; mode: CostMode; group: CostGroup }[], allocBy: 'value' | 'quantity',
): LiveTotals {
  const sums = (g: CostGroup) => ({
    total: costs.filter(c => c.group === g && c.mode === 'total').reduce((s, c) => s + c.amount, 0),
    perUnit: costs.filter(c => c.group === g && c.mode === 'per_unit').reduce((s, c) => s + c.amount, 0),
  })
  const plain = lines.map(l => ({ quantity: l.quantity, price: l.price }))
  const sc = sums('customs'); const so = sums('other')
  const c = previewLanded(plain, rate, sc.total, allocBy, sc.perUnit)
  const o = previewLanded(plain, rate, so.total, allocBy, so.perUnit)
  const perLine = lines.map((l, i) => {
    const extraCost = r2(c[i].extraCost + o[i].extraCost + l.fixedExtra)
    const unitCost = l.quantity > 0 && rate > 0 ? r2(l.price * rate + extraCost / l.quantity) : 0
    return { unitCost, extraCustoms: c[i].extraCost, extraOther: o[i].extraCost, levy: l.fixedExtra, extraCost, lineTotal: r2(unitCost * l.quantity) }
  })
  const goodsLocal = r2(lines.reduce((s, l) => s + l.quantity * l.price * rate, 0))
  const customs = r2(perLine.reduce((s, p) => s + p.extraCustoms, 0))
  const other = r2(perLine.reduce((s, p) => s + p.extraOther, 0))
  const levy = r2(perLine.reduce((s, p) => s + p.levy, 0))
  const extra = r2(customs + other + levy)
  return {
    goodsLocal, customs, other, levy, extra,
    extraPct: goodsLocal > 0 ? r2((extra / goodsLocal) * 100) : 0,
    landed: r2(perLine.reduce((s, p) => s + p.lineTotal, 0)),
    perLine,
  }
}
