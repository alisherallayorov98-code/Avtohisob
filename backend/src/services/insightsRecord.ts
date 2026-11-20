// Tahlil → "Manba" qatorini bosganda yozuv to'liq ochiladi (tekshirish paneli).
// Bitta umumiy shakl qaytariladi: maydonlar, jadval (qismlar), fayllar (rasm/chek), havola.
// Tenant: yozuvning mashinasi (yoki ombori) foydalanuvchi tashkilotida bo'lishi shart.
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { getOrgWarehouseIds } from '../lib/orgFilter'
import { resolveInsightScope } from './insightsService'

interface AuthUserLike { id: string; role: string; branchId?: string | null }
type Cell = string | number | null

export interface RecordDetail {
  kind: string
  title: string
  fields: Array<[string, Cell]>
  table?: { columns: string[]; rows: Cell[][] }
  files?: Array<{ url: string; label: string }>
  link?: { label: string; path: string }
}

const db = () => prisma as any
const n = (x: any) => (x == null ? null : Number(x))
const day = (d: any) => (d ? new Date(new Date(d).getTime() + 5 * 3600000).toISOString().slice(0, 10).split('-').reverse().join('.') : null)
const dt = (d: any) => (d ? `${day(d)} ${new Date(new Date(d).getTime() + 5 * 3600000).toISOString().slice(11, 16)}` : null)
const money = (x: any) => (x == null ? null : `${Math.round(Number(x)).toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`)
const STATUS: Record<string, string> = {
  approved: 'Tasdiqlangan', pending_approval: 'Tasdiq kutmoqda', rejected: 'Rad etilgan',
  active: 'Faol', inactive: 'Nofaol', maintenance: "Ta'mirda", completed: 'Yopilgan', draft: 'Qoralama', cancelled: 'Bekor qilingan',
  installed: "O'rnatilgan", in_stock: 'Omborda', returned: 'Qaytarilgan', written_off: 'Hisobdan chiqarilgan', damaged: 'Shikastlangan',
}
const st = (s: any) => (s ? STATUS[s] || s : null)

async function vehicleInScope(vehicleId: string | null | undefined, branchIds: string[]) {
  if (!vehicleId) throw new AppError('Yozuv topilmadi', 404)
  const v = await db().vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true, registrationNumber: true } })
  if (!v || !branchIds.includes(v.branchId)) throw new AppError('Yozuv topilmadi', 404)
  return v
}

export async function getRecordDetail(user: AuthUserLike, kind: string, id: string): Promise<RecordDetail> {
  const scope = await resolveInsightScope(user)
  const B = scope.branchIds

  switch (kind) {
    case 'maintenance': {
      const m = await db().maintenanceRecord.findUnique({
        where: { id },
        include: {
          items: { include: { sparePart: { select: { name: true, partCode: true } }, warehouse: { select: { name: true } } } },
          sparePart: { select: { name: true, partCode: true } },
          evidence: { select: { fileUrl: true, createdAt: true } },
          performedBy: { select: { fullName: true } }, approvedBy: { select: { fullName: true } },
          supplier: { select: { name: true } }, sourceWarehouse: { select: { name: true } },
        },
      })
      if (!m) throw new AppError('Yozuv topilmadi', 404)
      const v = await vehicleInScope(m.vehicleId, B)
      const rows: Cell[][] = m.items.length
        ? m.items.map((i: any) => [i.sparePart?.name || '—', i.sparePart?.partCode || '—', i.quantityUsed, money(i.unitCost), money(Number(i.unitCost) * i.quantityUsed), i.warehouse?.name || '—', i.isTire ? `shina${i.tireSerial ? ` ${i.tireSerial}` : ''}` : ''])
        : m.sparePart ? [[m.sparePart.name, m.sparePart.partCode, m.quantityUsed, '—', money(m.cost), m.sourceWarehouse?.name || '—', '']] : []
      return {
        kind, title: `${v.registrationNumber} — ta'mir ${day(m.installationDate)}`,
        fields: [
          ['Sana', day(m.installationDate)], ['Probeg', m.installationMileage != null ? `${m.installationMileage} km` : null],
          ['Qismlar summasi', money(m.cost)], ['Usta haqi', money(m.laborCost)], ['Jami', money(Number(m.cost) + Number(m.laborCost))],
          ['Usta', m.workerName], ['Yetkazib beruvchi', m.supplier?.name || null],
          ["To'lov", `${m.paymentType === 'cash' ? 'Naqd' : m.paymentType}${m.isPaid ? ", to'langan" : ", to'lanmagan"}`],
          ['Rasmiy', m.isOfficial ? 'ha' : "yo'q (hujjatsiz)"], ['Holat', st(m.status)],
          ['Kiritgan', m.performedBy?.fullName || null], ['Kiritilgan vaqti', dt(m.createdAt)],
          ['Tasdiqlagan', m.approvedBy?.fullName || null], ['Tasdiqlangan vaqti', dt(m.approvedAt)],
          ...(m.rejectedReason ? [['Rad etish sababi', m.rejectedReason] as [string, Cell]] : []),
          ['Izoh', m.notes], ['Rasm/video', m.evidence.length ? `${m.evidence.length} ta` : "yo'q"],
        ],
        table: rows.length ? { columns: ['Qism', 'Kod', 'Soni', 'Narx', 'Summa', 'Ombor', ''], rows } : undefined,
        files: m.evidence.map((e: any, i: number) => ({ url: e.fileUrl, label: `Dalil ${i + 1} (${day(e.createdAt)})` })),
        link: { label: "Ta'mirlar bo'limida ochish", path: `/maintenance?search=${encodeURIComponent(v.registrationNumber)}` },
      }
    }
    case 'fuel': {
      const r = await db().fuelRecord.findUnique({ where: { id }, include: { supplier: { select: { name: true } }, createdBy: { select: { fullName: true } } } })
      if (!r) throw new AppError('Yozuv topilmadi', 404)
      const v = await vehicleInScope(r.vehicleId, B)
      const liters = n(r.amountLiters) || 0
      return {
        kind, title: `${v.registrationNumber} — yoqilg'i ${day(r.refuelDate)}`,
        fields: [
          ['Sana', dt(r.refuelDate)], ['Turi', r.fuelType], ['Miqdor', liters], ['Summa', money(r.cost)],
          ['Litr narxi', liters > 0 ? money(Number(r.cost) / liters) : null], ['Odometr', n(r.odometerReading) || null],
          ['Yetkazib beruvchi', r.supplier?.name || null], ['Chek', r.receiptImageUrl ? 'bor' : "yo'q"],
          ['Kiritgan', r.createdBy?.fullName || null], ['Kiritilgan vaqti', dt(r.createdAt)],
        ],
        files: r.receiptImageUrl ? [{ url: r.receiptImageUrl, label: 'Chek' }] : [],
        link: { label: "Yoqilg'i bo'limida ochish", path: `/fuel?search=${encodeURIComponent(v.registrationNumber)}` },
      }
    }
    case 'expense': {
      const e = await db().expense.findUnique({ where: { id }, include: { category: { select: { name: true } }, createdBy: { select: { fullName: true } } } })
      if (!e) throw new AppError('Yozuv topilmadi', 404)
      const v = await vehicleInScope(e.vehicleId, B)
      return {
        kind, title: `${v.registrationNumber} — xarajat ${day(e.expenseDate)}`,
        fields: [
          ['Sana', day(e.expenseDate)], ['Kategoriya', e.category?.name || null], ['Summa', money(e.amount)], ['Izoh', e.description],
          ['Chek', e.receiptUrl ? 'bor' : "yo'q"], ['Kiritgan', e.createdBy?.fullName || null], ['Kiritilgan vaqti', dt(e.createdAt)],
        ],
        files: e.receiptUrl ? [{ url: e.receiptUrl, label: 'Chek' }] : [],
        link: { label: "Xarajatlar bo'limida ochish", path: '/expenses' },
      }
    }
    case 'engine': {
      const e = await db().engineRecord.findUnique({ where: { id }, include: { createdBy: { select: { fullName: true } } } })
      if (!e) throw new AppError('Yozuv topilmadi', 404)
      const v = await vehicleInScope(e.vehicleId, B)
      return {
        kind, title: `${v.registrationNumber} — dvigatel yozuvi ${day(e.date)}`,
        fields: [
          ['Sana', day(e.date)], ['Turi', e.recordType], ['Probeg', n(e.mileage)], ['Tavsif', e.description], ['Narx', money(e.cost)],
          ['Keyingi xizmat (km)', n(e.nextServiceMileage)], ['Bajargan', e.performedBy], ['Izoh', e.notes],
          ['Kiritgan', e.createdBy?.fullName || null], ['Kiritilgan vaqti', dt(e.createdAt)],
        ],
        link: { label: 'Dvigatel pasportida ochish', path: '/engine-monitor' },
      }
    }
    case 'service': {
      const r = await db().serviceRecord.findUnique({ where: { id } })
      if (!r) throw new AppError('Yozuv topilmadi', 404)
      const v = await vehicleInScope(r.vehicleId, B)
      const by = r.createdById ? await db().user.findUnique({ where: { id: r.createdById }, select: { fullName: true } }) : null
      return {
        kind, title: `${v.registrationNumber} — xizmat ${day(r.servicedAt)}`,
        fields: [
          ['Sana', day(r.servicedAt)], ['Xizmat', r.serviceType], ['Probeg', r.servicedAtKm], ['Narx', money(r.cost)],
          ['Usta', r.technicianName], ['Keyingi (km)', r.nextDueKm], ['Keyingi (sana)', day(r.nextDueDate)], ['Izoh', r.notes],
          ['Kiritgan', by?.fullName || null], ['Kiritilgan vaqti', dt(r.createdAt)],
        ],
        link: { label: "Motor yog'i bo'limida ochish", path: '/oil-change' },
      }
    }
    case 'waybill': {
      const w = await db().waybill.findUnique({ where: { id }, include: { driver: { select: { fullName: true } }, createdBy: { select: { fullName: true } } } })
      if (!w) throw new AppError('Yozuv topilmadi', 404)
      const v = await vehicleInScope(w.vehicleId, B)
      return {
        kind, title: `${v.registrationNumber} — yo'l varaqasi ${w.number}`,
        fields: [
          ['Raqam', w.number], ['Holat', st(w.status)], ['Haydovchi', w.driver?.fullName || null], ['Maqsad', w.purpose], ['Manzil', w.destination],
          ['Marshrut', w.routeDescription], ['Chiqish', dt(w.actualDeparture || w.plannedDeparture)], ['Qaytish', dt(w.actualReturn)],
          ['Odometr', `${w.departureOdometer ?? '—'} → ${w.returnOdometer ?? '—'}`], ["Berilgan yoqilg'i", n(w.fuelIssued)],
          ['Mexanik', w.mechanicName ? `${w.mechanicName}${w.mechanicApproved ? ' (tasdiqlagan)' : ''}` : 'tasdiqlanmagan'],
          ['Dispetcher', w.dispatcherName], ['Izoh', w.notes], ['Kiritgan', w.createdBy?.fullName || null],
        ],
        link: { label: "Yo'l varaqalarida ochish", path: '/waybills' },
      }
    }
    case 'tire': {
      const t = await db().tire.findUnique({ where: { id }, include: { supplier: { select: { name: true } }, driver: { select: { fullName: true } } } })
      if (!t) throw new AppError('Yozuv topilmadi', 404)
      if (t.vehicleId) await vehicleInScope(t.vehicleId, B)
      else if (!t.branchId || !B.includes(t.branchId)) throw new AppError('Yozuv topilmadi', 404)
      return {
        kind, title: `Shina ${t.serialCode}`,
        fields: [
          ['Seriya', t.serialCode], ['Marka / model', `${t.brand} ${t.model}`], ["O'lcham", t.size], ['DOT', t.dotCode], ['Holat', st(t.status)],
          ['Pozitsiya', t.position], ['Haydovchi', t.driver?.fullName || null], ['Sotib olingan', day(t.purchaseDate)], ['Narx', money(t.purchasePrice)],
          ['Yetkazib beruvchi', t.supplier?.name || null], ["O'rnatilgan", day(t.installationDate)], ["O'rnatilgan km", t.installedMileageKm],
          ['Yechilgan', day(t.removedDate)], ['Yurgan / norma', `${t.actualMileageUsed ?? '—'} / ${t.standardMileageKm}`],
          ['Protektor', t.currentTreadDepth != null ? `${n(t.currentTreadDepth)} mm` : null], ['Izoh', t.notes],
        ],
        link: { label: "Shinalar bo'limida ochish", path: '/tires' },
      }
    }
    case 'vehicle': {
      const v = await db().vehicle.findUnique({ where: { id } })
      if (!v || !B.includes(v.branchId)) throw new AppError('Yozuv topilmadi', 404)
      return {
        kind, title: `${v.registrationNumber} — ${v.brand} ${v.model}`,
        fields: [
          ['Davlat raqami', v.registrationNumber], ['Marka / model', `${v.brand} ${v.model}`], ['Yil', v.year], ['Holat', st(v.status)],
          ['Probeg', n(v.mileage)], ["Yoqilg'i turi", v.fuelType], ['Norma (/100km)', n(v.fuelNormPer100km)], ['Bak hajmi', n(v.tankCapacity)],
          ["Sug'urta tugaydi", day(v.insuranceExpiry)], ['Texosmotr tugaydi', day(v.techInspectionExpiry)], ['Izoh', v.notes],
        ],
        link: { label: 'Tahlil dosyesi', path: `/insights/vehicle/${v.id}` },
      }
    }
    case 'inventory': {
      const [partId, warehouseId] = id.split('|')
      const allowed = (await getOrgWarehouseIds({ type: 'org', orgBranchIds: B })) || []
      if (!warehouseId || !allowed.includes(warehouseId)) throw new AppError('Yozuv topilmadi', 404)
      const i = await db().inventory.findFirst({
        where: { sparePartId: partId, warehouseId },
        include: { sparePart: { select: { name: true, partCode: true, category: true, unitPrice: true } }, warehouse: { select: { name: true } } },
      })
      if (!i) throw new AppError('Yozuv topilmadi', 404)
      return {
        kind, title: `${i.sparePart.name} — ${i.warehouse.name}`,
        fields: [
          ['Qism', i.sparePart.name], ['Kod', i.sparePart.partCode], ['Ombor', i.warehouse.name], ['Qoldiq', i.quantityOnHand],
          ['Band qilingan', i.quantityReserved], ['Minimal daraja', i.reorderLevel], ['Narx', money(i.sparePart.unitPrice)],
          ['Oxirgi kirim', day(i.lastRestockDate)],
        ],
        link: { label: "Ombor qoldig'ida ochish", path: '/inventory' },
      }
    }
    default:
      throw new AppError("Noma'lum yozuv turi", 400)
  }
}
