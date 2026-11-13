// H. Ombor va ta'minot (99–106)
import type { Rule, Finding, InventorySnap } from '../types'
import { fmtDate, fmtNum, fmtUzs } from '../context'

const INV = { label: 'Ombor qoldig\'i', path: '/inventory' }

export const warehouseRules: Rule[] = [
  {
    key: 'warehouse.low_stock', no: 99, category: 'warehouse', name: "Qoldiq minimal darajadan past",
    run: (c) => {
      const usedRecently = new Set<string>()
      for (const m of c.s.maintenance) if (m.date >= c.ago(180)) for (const p of m.parts) if (p.sparePartId) usedRecently.add(p.sparePartId)
      return c.s.inventory
        .filter(i => i.qty < i.reorderLevel && usedRecently.has(i.partId))
        .map(i => c.f({
          ruleKey: 'warehouse.low_stock', category: 'warehouse', severity: i.qty <= 0 ? 'warning' : 'info', subjectKey: `${i.partId}|${i.warehouseId}`,
          title: `"${i.partName}" ${i.warehouseName} omborida ${i.qty <= 0 ? 'tugagan' : `${i.qty} ta qoldi`}. Buyurtma berilganmi?`,
          detail: `Minimal daraja ${i.reorderLevel} ta; bu qism so'nggi 6 oyda ishlatilgan — kerak bo'lganda mashina turib qoladi.`,
          action: INV,
        }))
    },
  },
  {
    key: 'warehouse.dead_stock', no: 100, category: 'warehouse', name: "180 kun harakatsiz qismlar",
    run: (c) => {
      const used = new Set<string>()
      for (const m of c.s.maintenance) if (m.date >= c.ago(180)) for (const p of m.parts) if (p.sparePartId) used.add(p.sparePartId)
      const byWh = new Map<string, InventorySnap[]>()
      for (const i of c.s.inventory) {
        if (i.qty <= 0 || used.has(i.partId)) continue
        if (i.lastRestockDate && c.daysSince(i.lastRestockDate) < 180) continue
        byWh.set(i.warehouseId, [...(byWh.get(i.warehouseId) || []), i])
      }
      const out: Finding[] = []
      for (const [wid, items] of byWh) {
        const value = items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
        if (value < 500_000) continue
        const top = [...items].sort((a, b) => b.qty * b.unitPrice - a.qty * a.unitPrice).slice(0, 3)
        out.push(c.f({
          ruleKey: 'warehouse.dead_stock', category: 'warehouse', severity: 'info', subjectKey: wid,
          title: `${items[0].warehouseName}: ${items.length} xil qism yarim yildan beri ishlatilmayapti — ${fmtUzs(value)} muzlab yotibdi`,
          detail: `Eng qimmatlari: ${top.map(i => `${i.partName} (${i.qty} ta)`).join(', ')}. Boshqa filialga o'tkazing yoki sotib yuboring.`,
          action: INV, impactUzs: value,
        }))
      }
      return out
    },
  },
  {
    key: 'warehouse.transfer_not_received', no: 101, category: 'warehouse', name: "Transfer qabul qilinmagan",
    run: (c) => c.s.shippedBatches
      .filter(b => c.daysSince(b.at) >= 7)
      .map(b => c.f({
        ruleKey: 'warehouse.transfer_not_received', category: 'warehouse', severity: 'warning', subjectKey: b.id,
        title: `${b.number} transfer ${c.daysSince(b.at)} kundan beri yo'lda. Yetib keldimi?`,
        detail: `Jo'natilgan: ${fmtDate(b.at)}. Qabul qilinmaguncha qismlar hech qaysi omborda ko'rinmaydi.`,
        action: { label: 'Transferlar', path: '/transfers' },
      })),
  },
  {
    key: 'warehouse.request_unanswered', no: 102, category: 'warehouse', name: "Qism so'rovi javobsiz",
    run: (c) => c.s.pendingRequests
      .filter(r => c.daysSince(r.at) >= 3)
      .map(r => c.f({
        ruleKey: 'warehouse.request_unanswered', category: 'warehouse', severity: 'warning', subjectKey: r.id,
        title: `${r.number} qism so'roviga ${c.daysSince(r.at)} kundan beri javob yo'q`,
        detail: `So'rov: ${fmtDate(r.at)}. Filial qismsiz mashinani ta'mirlay olmayapti.`,
        action: { label: "So'rovlar", path: '/transfers' },
      })),
  },
  {
    key: 'warehouse.official_no_invoice', no: 103, category: 'warehouse', name: "Rasmiy kirimda faktura yo'q",
    run: (c) => {
      const bad = c.s.receipts.filter(r => r.isOfficial && !r.invoiceNumber?.trim())
      if (!bad.length) return []
      return [c.f({
        ruleKey: 'warehouse.official_no_invoice', category: 'warehouse', severity: 'info',
        title: `${bad.length} ta "rasmiy" kirimda hisob-faktura raqami yo'q. Rostdan rasmiymi?`,
        detail: `So'nggi 90 kun. Fakturasiz kirim buxgalteriya dalolatnomasida savol tug'diradi.`,
        action: INV,
      })]
    },
  },
  {
    key: 'warehouse.supplier_debt', no: 104, category: 'warehouse', name: "Yetkazib beruvchi qarzi 30+ kun",
    run: (c) => c.s.suppliers
      .filter(s => s.invoiced - s.paid > 0 && s.oldestInvoice && c.daysSince(s.oldestInvoice) >= 30)
      .filter(s => !s.lastPayment || c.daysSince(s.lastPayment) >= 30)
      .map(s => c.f({
        ruleKey: 'warehouse.supplier_debt', category: 'warehouse', severity: 'warning', subjectKey: s.id,
        title: `"${s.name}" ga ${fmtUzs(s.invoiced - s.paid)} qarz, ${s.lastPayment ? `oxirgi to'lov ${fmtDate(s.lastPayment)}` : "hech to'lanmagan"}`,
        detail: `Qarz uzoq tursa yetkazib beruvchi yuk berishni to'xtatishi mumkin. To'langan bo'lsa — to'lovni kiriting.`,
        action: { label: 'Yetkazib beruvchilar', path: '/suppliers' }, impactUzs: s.invoiced - s.paid,
      })),
  },
  {
    key: 'warehouse.return_pending', no: 105, category: 'warehouse', name: 'Qism qaytarish tasdiq kutmoqda',
    run: (c) => {
      const old = c.s.pendingReturns.filter(r => c.daysSince(r.at) >= 3)
      if (!old.length) return []
      return [c.f({
        ruleKey: 'warehouse.return_pending', category: 'warehouse', severity: 'info',
        title: `${old.length} ta qism qaytarish so'rovi tasdiqlanmagan`,
        detail: `Eng eskisi ${fmtDate(old[0].at)}. Tasdiqlanmaguncha qism omborga qaytmaydi.`,
        action: { label: 'Qaytarishlar', path: '/spare-part-returns' },
      })]
    },
  },
  {
    key: 'warehouse.zero_price', no: 106, category: 'warehouse', name: 'Narxi 0 bo\'lgan qismlar',
    run: (c) => {
      const zero = c.s.inventory.filter(i => i.qty > 0 && i.unitPrice <= 0)
      if (!zero.length) return []
      return [c.f({
        ruleKey: 'warehouse.zero_price', category: 'warehouse', severity: 'info',
        title: `Omborda ${zero.length} xil qism narxsiz turibdi`,
        detail: `Masalan: ${zero.slice(0, 3).map(i => `${i.partName} (${fmtNum(i.qty)} ta)`).join(', ')}. Ta'mirga ishlatilganda xarajat 0 bo'lib chiqadi.`,
        action: { label: 'Ehtiyot qismlar', path: '/spare-parts' },
      })]
    },
  },
]
