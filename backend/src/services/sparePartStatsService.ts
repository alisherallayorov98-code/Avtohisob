import { prisma } from '../lib/prisma'

export async function recalculateAll(): Promise<void> {
  // Aggregate usage from MaintenanceRecord
  const stats = await prisma.maintenanceRecord.groupBy({
    by: ['sparePartId'],
    _sum: { quantityUsed: true, cost: true },
    _count: { id: true },
    _max: { installationDate: true },
  })

  for (const s of stats) {
    await prisma.sparePartStatistic.upsert({
      where: { sparePartId: s.sparePartId },
      create: {
        sparePartId: s.sparePartId,
        totalUsed: s._sum.quantityUsed || 0,
        totalCost: s._sum.cost || 0,
        usageCount: s._count.id,
        lastUsedAt: s._max.installationDate ?? undefined,
        calculatedAt: new Date(),
      },
      update: {
        totalUsed: s._sum.quantityUsed || 0,
        totalCost: s._sum.cost || 0,
        usageCount: s._count.id,
        lastUsedAt: s._max.installationDate ?? undefined,
        calculatedAt: new Date(),
      },
    })
  }
}

export async function recalculateOne(sparePartId: string): Promise<void> {
  const stats = await prisma.maintenanceRecord.aggregate({
    where: { sparePartId },
    _sum: { quantityUsed: true, cost: true },
    _count: { id: true },
    _max: { installationDate: true },
  })

  await prisma.sparePartStatistic.upsert({
    where: { sparePartId },
    create: {
      sparePartId,
      totalUsed: stats._sum.quantityUsed || 0,
      totalCost: stats._sum.cost || 0,
      usageCount: stats._count.id,
      lastUsedAt: stats._max.installationDate || null,
    },
    update: {
      totalUsed: stats._sum.quantityUsed || 0,
      totalCost: stats._sum.cost || 0,
      usageCount: stats._count.id,
      lastUsedAt: stats._max.installationDate || null,
      calculatedAt: new Date(),
    },
  })
}

export async function getTopUsed(limit = 10) {
  return prisma.sparePartStatistic.findMany({
    orderBy: { totalUsed: 'desc' },
    take: limit,
    include: {
      sparePart: { select: { name: true, partCode: true, category: true } },
    },
  })
}

export async function getTopByValue(limit = 10) {
  return prisma.sparePartStatistic.findMany({
    orderBy: { totalCost: 'desc' },
    take: limit,
    include: {
      sparePart: { select: { name: true, partCode: true, category: true } },
    },
  })
}
