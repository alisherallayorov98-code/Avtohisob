import { prisma } from '../lib/prisma'

export async function recalculateAll(orgId: string | null): Promise<void> {
  // Agar orgId berilgan bo'lsa — faqat o'sha org'ning ehtiyot qismlari
  const sparePartWhere: any = orgId
    ? { OR: [{ organizationId: orgId }, { organizationId: null }] }
    : {}
  const parts = await (prisma as any).sparePart.findMany({
    where: sparePartWhere,
    select: { id: true, organizationId: true },
  })
  const orgByPartId = new Map<string, string | null>(parts.map((p: any) => [p.id, p.organizationId]))
  const partIds = parts.map((p: any) => p.id)

  if (partIds.length === 0) return

  const stats = await prisma.maintenanceRecord.groupBy({
    by: ['sparePartId'],
    where: { sparePartId: { in: partIds } },
    _sum: { quantityUsed: true, cost: true },
    _count: { id: true },
    _max: { installationDate: true },
  })

  for (const s of stats) {
    if (!s.sparePartId) continue
    const partOrg = orgByPartId.get(s.sparePartId) ?? null
    await (prisma as any).sparePartStatistic.upsert({
      where: { sparePartId: s.sparePartId },
      create: {
        sparePartId: s.sparePartId,
        organizationId: partOrg,
        totalUsed: s._sum.quantityUsed || 0,
        totalCost: s._sum.cost || 0,
        usageCount: s._count.id,
        lastUsedAt: s._max.installationDate ?? undefined,
        calculatedAt: new Date(),
      },
      update: {
        organizationId: partOrg,
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
  const sparePart = await (prisma as any).sparePart.findUnique({
    where: { id: sparePartId },
    select: { organizationId: true },
  })
  const partOrg = sparePart?.organizationId ?? null

  const stats = await prisma.maintenanceRecord.aggregate({
    where: { sparePartId },
    _sum: { quantityUsed: true, cost: true },
    _count: { id: true },
    _max: { installationDate: true },
  })

  await (prisma as any).sparePartStatistic.upsert({
    where: { sparePartId },
    create: {
      sparePartId,
      organizationId: partOrg,
      totalUsed: stats._sum.quantityUsed || 0,
      totalCost: stats._sum.cost || 0,
      usageCount: stats._count.id,
      lastUsedAt: stats._max.installationDate || null,
    },
    update: {
      organizationId: partOrg,
      totalUsed: stats._sum.quantityUsed || 0,
      totalCost: stats._sum.cost || 0,
      usageCount: stats._count.id,
      lastUsedAt: stats._max.installationDate || null,
      calculatedAt: new Date(),
    },
  })
}

export async function getTopUsed(limit = 10, orgId: string | null) {
  const where: any = orgId
    ? { OR: [{ organizationId: orgId }, { organizationId: null }] }
    : {}
  return (prisma as any).sparePartStatistic.findMany({
    where,
    orderBy: { totalUsed: 'desc' },
    take: limit,
    include: {
      sparePart: { select: { name: true, partCode: true, category: true } },
    },
  })
}

export async function getTopByValue(limit = 10, orgId: string | null) {
  const where: any = orgId
    ? { OR: [{ organizationId: orgId }, { organizationId: null }] }
    : {}
  return (prisma as any).sparePartStatistic.findMany({
    where,
    orderBy: { totalCost: 'desc' },
    take: limit,
    include: {
      sparePart: { select: { name: true, partCode: true, category: true } },
    },
  })
}
