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
}

// Shinani mashinaga "o'rnatilgan" qilib yozadi (yangi serial — yaratadi, mavjud — qayta o'rnatish).
// Faqat TASDIQLANGAN ta'mirlash uchun chaqirilishi kerak: rad etilgan/kutilayotgan yozuv
// mavjud shinaning mashina/sana/probegini o'zgartirmasligi shart.
export async function upsertInstalledTire(tx: Prisma.TransactionClient, p: TireInstallInput) {
  const brandGuess = p.spareName.split(' ')[0] || 'N/A'
  return tx.tire.upsert({
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
}
