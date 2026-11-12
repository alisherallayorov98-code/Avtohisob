// Audit yozuvidagi "avval → keyin" holatini odam o'qiydigan o'zgarishlar ro'yxatiga aylantiradi.

const LABEL: Record<string, string> = {
  invoiceNumber: 'Invoys №', supplierId: 'Yetkazib beruvchi', currency: 'Valyuta', exchangeRate: 'Kurs',
  allocBy: 'Xarajat taqsimlash', minWage: 'Eng kam oylik', isOfficial: 'Rasmiy', notes: 'Izoh',
  quantity: 'Miqdor', unitCost: 'Tannarx / birlik', price: 'Narx', unitPrice: 'Narx', lineTotal: 'Summa',
  unitWeightKg: "Og'irlik (kg/birlik)", levy: "Yig'im turi", levyAmount: "Yig'im", extraCustoms: 'Bojxona ulushi',
  extraOther: "Qo'shimcha ulushi", paymentType: "To'lov turi", dueDate: 'Muddat', vatRate: 'QQS %',
  totalAmount: 'Jami summa', totalCost: 'Jami tannarx', customerId: 'Mijoz', documentNumber: 'Raqam', number: 'Raqam',
  amount: 'Summa', mode: 'Hisoblash', group: 'Guruh',
  landed: "To'liq tannarx", customs: 'Bojxona xarajatlari', other: "Qo'shimcha xarajatlar",
}
const TOTAL_ORDER = ['landed', 'customs', 'other', 'levy']
const VALUE_MAP: Record<string, Record<string, string>> = {
  allocBy: { value: "qiymat bo'yicha", quantity: "miqdor bo'yicha" },
  paymentType: { cash: 'Naqd', transfer: 'Perechisleniya', credit: 'Qarz' },
  mode: { total: 'butun partiyaga', per_unit: 'har bir birlikka' },
  group: { customs: 'Bojxona', other: "Qo'shimcha" },
}

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Ha' : "Yo'q"
  if (typeof v === 'number') return v.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
  const s = String(v)
  if (VALUE_MAP[key]?.[s]) return VALUE_MAP[key][s]
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const [y, m, d] = s.slice(0, 10).split('-'); return `${d}.${m}.${y}` }
  return s
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const lbl = (k: string) => LABEL[k] ?? k

function diffKeyed(kind: string, a: any[] = [], b: any[] = [], name: (x: any) => string, out: string[]) {
  const am = new Map(a.map(x => [x.key, x])); const bm = new Map(b.map(x => [x.key, x]))
  for (const [k, x] of bm) {
    const o = am.get(k)
    if (!o) { out.push(`${kind} qo'shildi: ${name(x)}`); continue }
    for (const f of Object.keys(x)) {
      if (['key', 'product', 'label', 'sku'].includes(f) || same(o[f], x[f])) continue
      out.push(`${name(x)} — ${lbl(f)}: ${show(f, o[f])} → ${show(f, x[f])}`)
    }
  }
  for (const [k, o] of am) if (!bm.has(k)) out.push(`${kind} olib tashlandi: ${name(o)}`)
}

export function diffSnapshots(action: string, before: any, after: any): string[] {
  const out: string[] = []
  if (action === 'cancel') {
    out.push('Hujjat bekor qilindi — ombor qoldig\'i va tannarx qatlami qaytarildi.')
    if (before?.totals) out.push(`Bekor qilingan hujjat tannarxi: ${show('landed', before.totals.landed)} so'm`)
    if (before?.totalAmount != null) out.push(`Bekor qilingan sotuv summasi: ${show('totalAmount', before.totalAmount)} so'm`)
    return out
  }
  if (!before || !after) return out
  for (const k of Object.keys(after)) {
    const v = after[k]
    if (v !== null && typeof v === 'object') continue
    if (!same(before[k], v)) out.push(`${lbl(k)}: ${show(k, before[k])} → ${show(k, v)}`)
  }
  if (Array.isArray(after.lines)) {
    diffKeyed('Qator', before.lines, after.lines, x => x.product || x.key, out)
  }
  if (Array.isArray(after.costs)) {
    diffKeyed('Xarajat', before.costs, after.costs, x => `${show('group', x.group)}: ${x.label}`, out)
  }
  if (after.totals) {
    for (const k of TOTAL_ORDER) {
      if (!same(before.totals?.[k], after.totals[k])) out.push(`${lbl(k)} (jami): ${show(k, before.totals?.[k])} → ${show(k, after.totals[k])} so'm`)
    }
  }
  return out
}
