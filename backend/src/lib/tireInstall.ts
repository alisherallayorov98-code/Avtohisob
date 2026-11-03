import { Prisma } from '@prisma/client'

export interface TireInstallInput {
  serial: string
  spareName: string
  installationDate: Date
  unitCost: Prisma.Decimal | number
  vehicleId: string
  installKm: number
  position: string | null
  supplierId: string | null
  branchId: string | null
  index: number
  createdById: string | null
}

// Shinani mashinaga "o'rnatilgan" qilib yozadi (yangi serial — yaratadi, mavjud — qayta o'rnatish)
// va harakat jurnaliga hodisa qo'shadi. Faqat TASDIQLANGAN ta'mirlash uchun chaqirilishi kerak:
// rad etilgan/kutilayotgan yozuv mavjud shinaning mashina/sana/probegini o'zgartirmasligi shart.
export async function upsertInstalledTire(tx: Prisma.TransactionClient, p: TireInstallInput) {
  const db = tx as any
  const brandGuess = p.spareName.split(' ')[0] || 'N/A'
  const before = await db.tire.findUnique({
    where: { serialCode: p.serial },
    select: { id: true, status: true, vehicleId: true, position: true, installedMileageKm: true },
  })

  const tire = await db.tire.upsert({
    where: { serialCode: p.serial },
    create: {
      uniqueId: `TIRE-${Date.now()}-${p.index}-${Math.random().toString(36).slice(2, 6)}`,
      serialCode: p.serial,
      brand: brandGuess,
      model: p.spareName,
      size: 'N/A',
      type: 'All-season',
      purchaseDate: p.installationDate,
      purchasePrice: p.unitCost,
      vehicleId: p.vehicleId,
      installationDate: p.installationDate,
      installedMileageKm: p.installKm,
      position: p.position,
      status: 'installed',
      supplierId: p.supplierId,
      branchId: p.branchId,
    },
    update: {
      vehicleId: p.vehicleId,
      installationDate: p.installationDate,
      installedMileageKm: p.installKm,
      actualMileageUsed: null,
      removedDate: null,
      removedMileageKm: null,
      position: p.position,
      status: 'installed',
      ...(p.supplierId ? { supplierId: p.supplierId } : {}),
      branchId: p.branchId,
    },
  })

  // Boshqa mashinada o'rnatilgan shina ko'chirilgan bo'lsa — avvalgi joydan "olindi" yozuvi.
  if (before?.status === 'installed' && before.vehicleId && before.vehicleId !== p.vehicleId) {
    await db.tireEvent.create({
      data: {
        tireId: tire.id, eventType: 'removed', vehicleId: before.vehicleId,
        mileageAtEvent: p.installKm, position: before.position,
        notes: "Boshqa mashinaga o'rnatilgani uchun olindi (ta'mirlash orqali)",
        createdById: p.createdById,
      },
    })
  }
  if (!before) {
    await db.tireEvent.create({
      data: { tireId: tire.id, eventType: 'purchased', notes: "Ta'mirlash orqali tizimga kiritildi", createdById: p.createdById },
    })
  }
  await db.tireEvent.create({
    data: {
      tireId: tire.id, eventType: 'installed', vehicleId: p.vehicleId,
      mileageAtEvent: p.installKm, position: p.position,
      notes: "O'rnatildi (ta'mirlash orqali)", createdById: p.createdById,
    },
  })
  return tire
}
