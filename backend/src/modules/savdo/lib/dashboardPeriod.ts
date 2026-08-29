// Dashboard davri — sof funksiya (DB'siz, testlanadi).
// Berilmagan/noto'g'ri sanada joriy oyga tushadi (eski xatti-harakat saqlanadi).
// `to` kunning OXIRIGACHA (23:59:59.999) kengaytiriladi — aks holda "01-31"
// oralig'i 31-kunning sotuvlarini tushirib qoldirardi (00:00 dan keyingi hammasi).

export interface DashboardPeriod {
  from: Date
  to: Date
  label: string
}

const isValid = (d: Date): boolean => !Number.isNaN(d.getTime())

export function resolveDashboardPeriod(
  rawFrom?: string | null,
  rawTo?: string | null,
  now: Date = new Date(),
): DashboardPeriod {
  const parsedFrom = rawFrom ? new Date(rawFrom) : null
  const parsedTo = rawTo ? new Date(rawTo) : null

  if (parsedFrom && isValid(parsedFrom)) {
    const from = new Date(parsedFrom)
    from.setHours(0, 0, 0, 0)

    const to = parsedTo && isValid(parsedTo) ? new Date(parsedTo) : new Date(now)
    to.setHours(23, 59, 59, 999)

    // Teskari oraliq (from > to) — joyini almashtiramiz, bo'sh hisobot bermaymiz
    if (from > to) return { from: to, to: from, label: 'Tanlangan davr' }
    return { from, to, label: 'Tanlangan davr' }
  }

  const from = new Date(now)
  from.setDate(1)
  from.setHours(0, 0, 0, 0)
  const to = new Date(now)
  to.setHours(23, 59, 59, 999)
  return { from, to, label: 'Shu oy' }
}
