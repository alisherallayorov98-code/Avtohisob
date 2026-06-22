// Xizmat intervallari (yog'/filtr va h.k.) bilan ishlash uchun umumiy mantiq.
// Bir nechta joydan ishlatiladi — dublikat bo'lmasin:
//   - ta'mirlash yozilganda/tasdiqlanганда (yog'/filtr → interval avtomatik yangilanadi)
//   - keyingi bosqichlarda: probeg o'zgarganda statusni qayta hisoblash.

import { prisma } from './prisma'
import { detectIsOil } from './oilKeywords'

export type ServiceType = 'oil_change' | 'air_filter' | 'fuel_filter'

interface ServiceDefault { intervalKm: number; intervalDays: number; warningKm: number }

// Interval mavjud bo'lmasa shu default bilan yaratiladi (foydalanuvchi keyin sozlay oladi)
const DEFAULTS: Record<ServiceType, ServiceDefault> = {
  oil_change:  { intervalKm: 7000,  intervalDays: 180, warningKm: 500 },
  air_filter:  { intervalKm: 15000, intervalDays: 365, warningKm: 1000 },
  fuel_filter: { intervalKm: 20000, intervalDays: 365, warningKm: 1000 },
}

/** Joriy probegga qarab xizmat statusini hisoblaydi */
export function computeServiceStatus(
  nextDueKm: number | null,
  warningKm: number,
  mileage: number,
): 'ok' | 'due_soon' | 'overdue' {
  if (nextDueKm === null) return 'ok'
  if (mileage >= nextDueKm) return 'overdue'
  if (mileage >= nextDueKm - warningKm) return 'due_soon'
  return 'ok'
}

// Filtr kalit so'zlari — lotin/kirill/rus/ingliz
const AIR_FILTER_KW = [
  'havo filtr', "havo filьtri", 'vozdushn', 'havo filtri', 'havofiltr',
  'воздушн', 'воздушный фильтр', 'air filter', 'airfilter',
]
const FUEL_FILTER_KW = [
  'yoqilg', "yoqilg'i filtr", 'yoqilgi filtr', 'benzin filtr', 'solyarka filtr',
  'dizel filtr', 'топливн', 'топливный фильтр', 'fuel filter', 'fuelfilter', 'toplivn',
]

function matchAny(text: string, kws: string[]): boolean {
  const l = text.toLowerCase()
  return kws.some(k => l.includes(k))
}

/** Matn(lar)dan qaysi filtr turlari almashtirilganini aniqlaydi */
export function detectFilterTypes(...texts: (string | null | undefined)[]): ServiceType[] {
  const joined = texts.filter(Boolean).join(' ')
  if (!joined) return []
  const out: ServiceType[] = []
  if (matchAny(joined, AIR_FILTER_KW)) out.push('air_filter')
  if (matchAny(joined, FUEL_FILTER_KW)) out.push('fuel_filter')
  return out
}

/**
 * Ta'mirlash matni/qism nomlaridan qaysi xizmatlar (yog'/filtr) bajarilganini aniqlaydi.
 * isOil — ta'mirlash yozuvida allaqachon aniqlangan yog' bayrog'i (bo'lsa).
 */
export function detectServiceTypes(opts: {
  isOil?: boolean
  oilLiters?: number | null
  notes?: string | null
  partNames?: (string | null | undefined)[]
}): ServiceType[] {
  const partNames = (opts.partNames || []).filter(Boolean) as string[]
  const types: ServiceType[] = []
  const oilLitersNum = opts.oilLiters != null ? Number(opts.oilLiters) : 0
  const oil = opts.isOil || oilLitersNum > 0 || detectIsOil([opts.notes, ...partNames].join(' '))
  if (oil) types.push('oil_change')
  types.push(...detectFilterTypes(opts.notes, ...partNames))
  return [...new Set(types)]
}

/**
 * Mashinaga xizmat (yog'/filtr) bajarilganda intervalni yangilaydi:
 * lastServiceKm/Date, nextDueKm/Date qayta hisob + status, va ServiceRecord yozadi.
 * Mavjud interval bo'lsa uning oralig'ini saqlaydi; bo'lmasa default bilan yaratadi.
 */
export async function recordServicedTypes(
  vehicleId: string,
  serviceTypes: ServiceType[],
  servicedAtKm: number,
  servicedAt: Date,
  createdById?: string | null,
): Promise<void> {
  const mileage = Math.round(servicedAtKm)
  if (serviceTypes.length === 0 || !mileage || mileage <= 0) return

  for (const serviceType of [...new Set(serviceTypes)]) {
    const existing = await prisma.serviceInterval.findUnique({
      where: { vehicleId_serviceType: { vehicleId, serviceType } },
    })
    const def = DEFAULTS[serviceType]
    const intervalKm = existing?.intervalKm ?? def.intervalKm
    const intervalDays = existing?.intervalDays ?? def.intervalDays
    const warningKm = existing?.warningKm ?? def.warningKm
    const nextDueKm = mileage + intervalKm
    const nextDueDate = new Date(servicedAt.getTime() + intervalDays * 86400000)
    const status = computeServiceStatus(nextDueKm, warningKm, mileage)

    const interval = await prisma.serviceInterval.upsert({
      where: { vehicleId_serviceType: { vehicleId, serviceType } },
      create: {
        vehicleId, serviceType, intervalKm, intervalDays, warningKm,
        lastServiceKm: mileage, lastServiceDate: servicedAt, nextDueKm, nextDueDate, status,
      },
      update: { lastServiceKm: mileage, lastServiceDate: servicedAt, nextDueKm, nextDueDate, status },
    })

    await prisma.serviceRecord.create({
      data: {
        vehicleId, serviceIntervalId: interval.id, serviceType,
        servicedAtKm: mileage, servicedAt, cost: 0,
        nextDueKm, nextDueDate, createdById: createdById ?? null,
        notes: "Ta'mirlash orqali avtomatik qayd etildi",
      },
    })
  }
}

/**
 * Probeg o'zgarganda mashinaning barcha xizmat intervallari statusini qayta hisoblaydi.
 * GPS sync va qo'lda km kiritishdan chaqiriladi (2-bosqich).
 */
export async function recomputeVehicleServiceIntervals(vehicleId: string, mileage: number): Promise<void> {
  const m = Math.round(mileage)
  if (!m || m <= 0) return
  const intervals = await prisma.serviceInterval.findMany({ where: { vehicleId } })
  await Promise.all(
    intervals.map(iv => {
      const status = computeServiceStatus(iv.nextDueKm, iv.warningKm, m)
      if (status === iv.status) return Promise.resolve(iv)
      return prisma.serviceInterval.update({ where: { id: iv.id }, data: { status } })
    }),
  )
}
