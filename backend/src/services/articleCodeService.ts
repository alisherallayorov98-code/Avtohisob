import { prisma } from '../lib/prisma'

const CATEGORY_MAP: Record<string, string> = {
  engine: 'ENG',
  filters: 'FLT',
  brakes: 'BRK',
  suspension: 'SUS',
  electrical: 'ELC',
  body: 'BDY',
  transmission: 'TRN',
  fuel: 'FUL',
  cooling: 'COL',
  exhaust: 'EXH',
  oils: 'OIL',
  tires: 'TIR',
  other: 'OTH',
}

function buildPrefix(category: string, name: string, supplierName?: string): string {
  const catCode = CATEGORY_MAP[category.toLowerCase()] || 'OTH'

  // Extract meaningful tokens from name (2+ chars, non-numeric)
  const tokens = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length >= 2 && isNaN(Number(t)))
    .slice(0, 2)
    .map(t => t.slice(0, 3))
  const nameSlug = tokens.join('') || 'XX'

  // Supplier 2-char code
  const supCode = supplierName
    ? supplierName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
    : 'XX'

  return `${catCode}-${nameSlug}-${supCode}`
}

export async function generateArticleCode(sparePartId: string): Promise<string> {
  // Return existing if already generated
  const existing = await prisma.articleCode.findUnique({ where: { sparePartId } })
  if (existing) return existing.code

  const sparePart = await (prisma as any).sparePart.findUnique({
    where: { id: sparePartId },
    include: { supplier: { select: { name: true } } },
  })
  if (!sparePart) throw new Error('Ehtiyot qism topilmadi')

  const prefix = buildPrefix(sparePart.category, sparePart.name, sparePart.supplier.name)
  const orgId = sparePart.organizationId ?? null

  // Atomic sequence increment using a transaction
  const code = await prisma.$transaction(async (tx) => {
    const maxSeq = await tx.articleCode.aggregate({
      where: { prefix },
      _max: { sequence: true },
    })
    const nextSeq = (maxSeq._max.sequence || 0) + 1
    const codeStr = `${prefix}-${String(nextSeq).padStart(3, '0')}`

    await (tx as any).articleCode.create({
      data: { sparePartId, code: codeStr, prefix, sequence: nextSeq, organizationId: orgId },
    })

    return codeStr
  })

  return code
}

export async function getArticleCode(sparePartId: string) {
  return prisma.articleCode.findUnique({ where: { sparePartId } })
}

export async function getAllArticleCodes(page: number, limit: number, orgId: string | null) {
  const skip = (page - 1) * limit
  const where: any = orgId
    ? { OR: [{ organizationId: orgId }, { organizationId: null }] }
    : {}
  const [data, total] = await Promise.all([
    (prisma as any).articleCode.findMany({
      where,
      include: { sparePart: { select: { name: true, category: true, partCode: true } } },
      orderBy: { generatedAt: 'desc' },
      skip,
      take: limit,
    }),
    (prisma as any).articleCode.count({ where }),
  ])
  return { data, total }
}
