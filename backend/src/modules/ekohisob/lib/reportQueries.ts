// EkoHisob — hisobotlar uchun SQL so'rovlar (hamma og'ir hisob DB tomonida, N+1 yo'q).
//
// Qoidalar:
//  - Tenant/tuman doirasi FAQAT ekoScope orqali (orgId + districtIdsFilter); `organizationId null OR` yo'q.
//  - Doira bo'sh (orgId yo'q yoki boshliq/inspektorning tumani yo'q) → so'rov YUBORILMAYDI, bo'sh natija.
//  - Sana/oy chegarasi FAQAT uzt.ts (UTC+5). `paidAt` UTC'da saqlanadi → SQL'da `+ interval '5 hours'`.
//  - Pul — butun so'm (bigint → Number).
//  - Qarz ta'rifi: debtSummary.ts sarlavhasiga qarang.

import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { ScopeUser, districtIdsFilter, entityScopeWhere } from './ekoScope'
import { monthBoundsUz, shiftMonth } from './uzt'
import { DebtGroupRow, summarizeDebt, DebtSummary } from './debtSummary'
import { ObligationRow } from './reportAggregate'

export const ALL_STATUSES = ['active', 'blacklisted', 'inactive', 'draft']

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** ISO instant → `timestamp` (UTC devor soati) — session TimeZone'ga bog'liq emas. */
function ts(d: Date): Prisma.Sql {
  return Prisma.sql`${d.toISOString()}::timestamp`
}

/** Bitta tuman bilan cheklash (drill-down) — `extra` sifatida beriladi. */
export function onlyDistrict(districtId: string): Prisma.Sql {
  return Prisma.sql`AND e."districtId" = ${districtId}`
}

/** Prisma `entity: { ... }` filtri — doira + holatlar. */
export function entityWhereFor(user: ScopeUser, statuses: string[]): any {
  return { ...entityScopeWhere(user), status: { in: statuses } }
}

/**
 * `ent` CTE: doira ichidagi tashkilotlar. Doira bo'sh bo'lsa null.
 * `extra` — qo'shimcha "AND ..." shartlari (tuman/mahalla filtri).
 */
export function entCte(user: ScopeUser, statuses: string[], extra: Prisma.Sql = Prisma.empty): Prisma.Sql | null {
  if (!user.orgId || statuses.length === 0) return null
  const districts = districtIdsFilter(user)
  if (districts && districts.length === 0) return null
  const distCond = districts ? Prisma.sql`AND e."districtId" IN (${Prisma.join(districts)})` : Prisma.empty
  return Prisma.sql`ent AS (
    SELECT e."id" AS id, e."districtId" AS did, e."mahallId" AS mid, e."status" AS status,
           e."billingMode" AS bm, e."monthlyFee" AS fee, e."contractStartMonth" AS csm
    FROM "ekohisob_legal_entities" e
    WHERE e."orgId" = ${user.orgId} AND e."status" IN (${Prisma.join(statuses)})
    ${distCond} ${extra}
  )`
}

/**
 * `dr` CTE: tashkilot bo'yicha KANONIK qarz — lib/debtMath.getEntityBalance bilan AYNAN bir xil qoida
 * (bir xil mantiq pure holda debtSummary.entityDebtFromMonthRows; testda getEntityBalance bilan solishtiriladi):
 *   - rejimga qarab manba: monthly_fixed → hisoblar (charge), talon → talonlar, variable → yo'q (qarz 0);
 *   - har oy: ex = kutilgan, pd = to'langan; qisqa = max(0, ex − pd), ortiqcha = max(0, pd − ex);
 *   - ORTIQCHA butun tarix bo'yicha yig'iladi va eng ESKI qisqa oylarni qoplaydi (FIFO);
 *   - qarz = max(0, Σqisqa − Σortiqcha), avans = max(0, Σortiqcha − Σqisqa);
 *   - months/umonths/oldest — FIFO'dan KEYIN hali qarzi qolgan oylar.
 * Ilgari har hisob alohida `expected − paid` deb sanalardi — ortiqcha to'langan oy boshqa oy qarzini
 * qoplamasdi va hisobot qarzi kartochka/akt sverkadan KATTA chiqardi.
 * Talab: oldin `ent` CTE (id, bm) e'lon qilingan bo'lsin.
 */
const DR_CTE = Prisma.sql`mm AS (
  SELECT c."entityId" AS eid, c."month" AS mo,
         GREATEST(c."expectedAmount", 0)::bigint AS ex, GREATEST(c."paidAmount", 0)::bigint AS pd
  FROM "ekohisob_charges" c JOIN ent ON ent.id = c."entityId" AND ent.bm = 'monthly_fixed'
  UNION ALL
  SELECT t."entityId", to_char(t."date", 'YYYY-MM'),
         SUM(GREATEST(t."amount", 0))::bigint,
         SUM(CASE WHEN t."paid" THEN GREATEST(t."amount", 0)
                  ELSE LEAST(GREATEST(t."amount", 0), GREATEST(t."paidAmount", 0)) END)::bigint
  FROM "ekohisob_talons" t JOIN ent ON ent.id = t."entityId" AND ent.bm = 'talon'
  GROUP BY t."entityId", to_char(t."date", 'YYYY-MM')
),
sh AS (
  SELECT eid, mo,
         GREATEST(ex - pd, 0) AS s,
         SUM(GREATEST(ex - pd, 0)) OVER (PARTITION BY eid ORDER BY mo) AS cum,
         SUM(GREATEST(pd - ex, 0)) OVER (PARTITION BY eid) AS sp
  FROM mm
),
drall AS (
  SELECT eid,
         GREATEST(SUM(s) - MAX(sp), 0)::bigint AS debt,
         GREATEST(MAX(sp) - SUM(s), 0)::bigint AS adv,
         (COUNT(*) FILTER (WHERE s > 0 AND cum > sp))::int AS months,
         MIN(mo) FILTER (WHERE s > 0 AND cum > sp) AS oldest,
         array_agg(mo ORDER BY mo) FILTER (WHERE s > 0 AND cum > sp) AS umonths
  FROM sh GROUP BY eid
),
dr AS (SELECT * FROM drall WHERE debt > 0)`

// ── Tashkilot bo'yicha kanonik qarz (id ro'yxati bo'yicha) ──────────────────

export interface EntityDebtRow {
  debt: number
  /** ortiqcha to'lov (avans), debt > 0 bo'lsa 0 */
  advance: number
  /** FIFO'dan keyin qarzi qolgan oylar soni */
  months: number
  oldest: string | null
  /** qarzi qolgan oylar, o'sish tartibida */
  unpaidMonths: string[]
}

/** PostgreSQL parametr chegarasi 32767 — id ro'yxati shundan kichik bo'laklarga bo'linadi. */
export const DEBT_ID_CHUNK = 5000

/**
 * Berilgan tashkilotlar uchun kanonik qarz (debtMath.getEntityBalance bilan bir xil).
 * `orgId` berilsa — tenant filtri (boshqa korxona id'lari e'tiborsiz). Scheduler (barcha korxonalar)
 * uchun orgId berilmaydi: id'lar o'sha yerda allaqachon o'z manbasidan olingan.
 * Qaytgan Map'da qarzi/avansi bo'lmagan tashkilot YO'Q (qarz 0 deb o'qiladi).
 */
export async function queryEntityDebts(ids: string[], orgId?: string): Promise<Map<string, EntityDebtRow>> {
  const out = new Map<string, EntityDebtRow>()
  const uniq = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < uniq.length; i += DEBT_ID_CHUNK) {
    const chunk = uniq.slice(i, i + DEBT_ID_CHUNK)
    const orgCond = orgId ? Prisma.sql`AND e."orgId" = ${orgId}` : Prisma.empty
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      WITH ent AS (
        SELECT e."id" AS id, e."districtId" AS did, e."mahallId" AS mid, e."status" AS status,
               e."billingMode" AS bm, e."monthlyFee" AS fee, e."contractStartMonth" AS csm
        FROM "ekohisob_legal_entities" e
        WHERE e."id" IN (${Prisma.join(chunk)}) ${orgCond}
      ), ${DR_CTE}
      SELECT eid AS id, debt, adv, months, oldest, umonths FROM drall WHERE debt > 0 OR adv > 0`)
    for (const r of rows) {
      out.set(r.id, {
        debt: num(r.debt), advance: num(r.adv), months: num(r.months),
        oldest: r.oldest ?? null, unpaidMonths: (r.umonths as string[] | null) ?? [],
      })
    }
  }
  return out
}

// ── Qarz ─────────────────────────────────────────────────────────────────────

/** (tuman × mahalla × holat) bo'yicha qarz — barcha holatlar; KPI to'plamini debtSummary tanlaydi. */
export async function queryDebtGroups(user: ScopeUser, extra: Prisma.Sql = Prisma.empty): Promise<DebtGroupRow[]> {
  const ent = entCte(user, ALL_STATUSES, extra)
  if (!ent) return []
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}, ${DR_CTE}
    SELECT ent.did AS "districtId", ent.mid AS "mahallId", ent.status AS status,
           SUM(dr.debt)::bigint AS debt, COUNT(*)::int AS debtors
    FROM dr JOIN ent ON ent.id = dr.eid
    GROUP BY 1, 2, 3`)
  return rows.map(r => ({
    districtId: r.districtId, mahallId: r.mahallId ?? null, status: r.status,
    debt: num(r.debt), debtors: num(r.debtors),
  }))
}

/** YAGONA "jami qarz" funksiyasi: hisobot ham, dashboard ham shuni chaqiradi. */
export async function getDebtSummary(
  user: ScopeUser, includeBlacklisted = false,
): Promise<{ summary: DebtSummary; rows: DebtGroupRow[] }> {
  const rows = await queryDebtGroups(user)
  return { summary: summarizeDebt(rows, includeBlacklisted), rows }
}

/** Qarz yoshi: oy soni (1, 2, 3+) bo'yicha tashkilot soni va summa — SQL'da guruhlanadi. */
export async function queryDebtAgeBuckets(
  user: ScopeUser, statuses: string[],
): Promise<{ months: number; count: number; amount: number }[]> {
  const ent = entCte(user, statuses)
  if (!ent) return []
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}, ${DR_CTE}
    SELECT LEAST(dr.months, 3)::int AS bucket, COUNT(*)::int AS cnt, SUM(dr.debt)::bigint AS amount
    FROM dr JOIN ent ON ent.id = dr.eid
    GROUP BY 1`)
  return rows.map(r => ({ months: num(r.bucket), count: num(r.cnt), amount: num(r.amount) }))
}

export interface DebtorRow {
  id: string
  name: string
  stir: string | null
  phone: string | null
  address: string | null
  status: string
  billingMode: string
  district: string | null
  mahalla: string | null
  districtId: string
  debtAmount: number
  debtMonths: number
  oldestMonth: string | null
  lastPaidAt: Date | null
}

/** Qarzdorlar: qarz DESC (yoki yosh bo'yicha) tartibda, SQL LIMIT bilan. */
export async function queryDebtors(
  user: ScopeUser, statuses: string[], limit: number, order: 'debt' | 'age' = 'debt',
): Promise<DebtorRow[]> {
  const ent = entCte(user, statuses)
  if (!ent) return []
  const orderBy = order === 'age'
    ? Prisma.sql`dr.months DESC, dr.debt DESC, e."name" ASC`
    : Prisma.sql`dr.debt DESC, e."name" ASC`
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}, ${DR_CTE}
    SELECT e."id" AS id, e."name" AS name, e."stir" AS stir, e."phone" AS phone, e."address" AS address,
           e."status" AS status, e."billingMode" AS "billingMode", e."districtId" AS "districtId",
           d."name" AS district, m."name" AS mahalla,
           dr.debt::bigint AS debt, dr.months::int AS months, dr.oldest AS oldest,
           (SELECT MAX(p."paidAt") FROM "ekohisob_payments" p WHERE p."entityId" = e."id") AS "lastPaidAt"
    FROM dr
    JOIN ent ON ent.id = dr.eid
    JOIN "ekohisob_legal_entities" e ON e."id" = dr.eid
    LEFT JOIN "ekohisob_districts" d ON d."id" = e."districtId"
    LEFT JOIN "ekohisob_mahallas" m ON m."id" = e."mahallId"
    ORDER BY ${orderBy}
    LIMIT ${Math.max(1, Math.floor(limit))}`)
  return rows.map(r => ({
    id: r.id, name: r.name, stir: r.stir ?? null, phone: r.phone ?? null, address: r.address ?? null,
    status: r.status, billingMode: r.billingMode, districtId: r.districtId,
    district: r.district ?? null, mahalla: r.mahalla ?? null,
    debtAmount: num(r.debt), debtMonths: num(r.months), oldestMonth: r.oldest ?? null,
    lastPaidAt: r.lastPaidAt ?? null,
  }))
}

// ── Kunlik ro'yxat / statistika (dashboard) ─────────────────────────────────

/**
 * Bitta qoida ikkala joyda (ro'yxat va stats): tashkilot qarzi =
 *   billed   — KANONIK qarz (DR_CTE: tashkilot ichida netto, avans eng eski qarzni qoplaydi);
 *   unbilled — belgilangan oylik, shu oy uchun hisob HALI YARATILMAGAN bo'lsa:
 *              monthlyFee − shu oy to'lovlari − qolgan avans (avans kelgusi hisobni qoplaydi).
 */
function dailyDebtCtes(month: string): Prisma.Sql {
  return Prisma.sql`${DR_CTE},
  un AS (
    SELECT ent.id AS eid,
           GREATEST(ent.fee
                    - COALESCE((SELECT SUM(p."amount") FROM "ekohisob_payments" p
                                WHERE p."entityId" = ent.id AND p."month" = ${month}), 0)
                    - COALESCE((SELECT a.adv FROM drall a WHERE a.eid = ent.id), 0), 0) AS rem
    FROM ent
    WHERE ent.bm = 'monthly_fixed' AND ent.fee > 0
      AND (ent.csm IS NULL OR ent.csm <= ${month})
      AND NOT EXISTS (SELECT 1 FROM "ekohisob_charges" c WHERE c."entityId" = ent.id AND c."month" = ${month})
  ),
  rows AS (
    SELECT ent.id AS id, COALESCE(dr.debt, 0)::bigint AS billed, COALESCE(un.rem, 0)::bigint AS unbilled
    FROM ent LEFT JOIN dr ON dr.eid = ent.id LEFT JOIN un ON un.eid = ent.id
  )`
}

export interface DailyDebtRow { id: string; billed: number; unbilled: number; debt: number }

/** Qarzdorlar (qarz > 0) — qarz bo'yicha kamayish tartibida, kesishdan OLDIN saralanadi. */
export async function queryDailyDebtors(
  user: ScopeUser, month: string, extra: Prisma.Sql, limit: number,
): Promise<{ rows: DailyDebtRow[]; total: number; totalBilled: number; totalUnbilled: number }> {
  const ent = entCte(user, ['active'], extra)
  if (!ent) return { rows: [], total: 0, totalBilled: 0, totalUnbilled: 0 }
  const ctes = dailyDebtCtes(month)
  const [list, agg] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      WITH ${ent}, ${ctes}
      SELECT id, billed, unbilled FROM rows WHERE billed + unbilled > 0
      ORDER BY billed + unbilled DESC, id ASC
      LIMIT ${Math.max(1, Math.floor(limit))}`),
    prisma.$queryRaw<any[]>(Prisma.sql`
      WITH ${ent}, ${ctes}
      SELECT COUNT(*)::int AS total, COALESCE(SUM(billed), 0)::bigint AS billed, COALESCE(SUM(unbilled), 0)::bigint AS unbilled
      FROM rows WHERE billed + unbilled > 0`),
  ])
  const a = agg[0] ?? {}
  return {
    rows: list.map(r => ({ id: r.id, billed: num(r.billed), unbilled: num(r.unbilled), debt: num(r.billed) + num(r.unbilled) })),
    total: num(a.total),
    totalBilled: num(a.billed),
    totalUnbilled: num(a.unbilled),
  }
}

// ── Majburiyat (kutilgan / yopilgan / to'liq to'lagan) ──────────────────────

/**
 * Har (oy × tuman × mahalla) uchun majburiyat agregati. Tarixiy oy uchun majburiyat o'sha oyning
 * charge/talon yozuvlaridan (bugungi holatdan emas). Joriy oy bo'yicha hali hisob yaratilmagan
 * belgilangan oylik ham majburiyat hisoblanadi (hisob yaratilishi bilan o'zgarmaydi).
 */
export async function queryObligations(
  user: ScopeUser, statuses: string[], months: string[], currentMonth: string, extra: Prisma.Sql = Prisma.empty,
): Promise<ObligationRow[]> {
  const ent = entCte(user, statuses, extra)
  if (!ent || months.length === 0) return []
  const first = `${months[0]}-01`
  const afterLast = `${shiftMonth(months[months.length - 1], 1)}-01`
  const unbilled = months.includes(currentMonth)
    ? Prisma.sql`
      UNION ALL
      SELECT ent.id, ${currentMonth}::text, 'c'::text, ent.fee::bigint,
             LEAST(COALESCE((SELECT SUM(p."amount") FROM "ekohisob_payments" p
                             WHERE p."entityId" = ent.id AND p."month" = ${currentMonth}), 0), ent.fee)::bigint
      FROM ent
      WHERE ent.bm = 'monthly_fixed' AND ent.fee > 0
        AND (ent.csm IS NULL OR ent.csm <= ${currentMonth})
        AND NOT EXISTS (SELECT 1 FROM "ekohisob_charges" c WHERE c."entityId" = ent.id AND c."month" = ${currentMonth})`
    : Prisma.empty

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent},
    per AS (
      SELECT u.eid AS eid, u.mo AS mo, SUM(u.ex) AS ex, SUM(u.ap) AS ap,
             COALESCE(SUM(u.ex) FILTER (WHERE u.k = 'c'), 0) AS exc
      FROM (
        SELECT c."entityId" AS eid, c."month" AS mo, 'c'::text AS k,
               c."expectedAmount"::bigint AS ex, LEAST(c."paidAmount", c."expectedAmount")::bigint AS ap
        FROM "ekohisob_charges" c JOIN ent ON ent.id = c."entityId"
        WHERE c."month" IN (${Prisma.join(months)}) AND c."expectedAmount" > 0
        UNION ALL
        SELECT t."entityId", to_char(t."date", 'YYYY-MM'), 't'::text,
               SUM(t."amount")::bigint,
               SUM(CASE WHEN t."paid" THEN t."amount" ELSE LEAST(t."paidAmount", t."amount") END)::bigint
        FROM "ekohisob_talons" t JOIN ent ON ent.id = t."entityId"
        WHERE t."date" >= ${first}::date AND t."date" < ${afterLast}::date
        GROUP BY t."entityId", to_char(t."date", 'YYYY-MM')
        HAVING SUM(t."amount") > 0
        ${unbilled}
      ) u
      GROUP BY u.eid, u.mo
    )
    SELECT per.mo AS month, ent.did AS "districtId", ent.mid AS "mahallId",
           COUNT(*)::int AS obliged,
           (COUNT(*) FILTER (WHERE per.ap >= per.ex))::int AS settled,
           (COUNT(*) FILTER (WHERE per.ap > 0 AND per.ap < per.ex))::int AS partial,
           SUM(per.ex)::bigint AS expected, SUM(per.ap)::bigint AS applied, SUM(per.exc)::bigint AS "expectedCharge"
    FROM per JOIN ent ON ent.id = per.eid
    GROUP BY 1, 2, 3`)
  return rows.map(r => ({
    month: r.month, districtId: r.districtId, mahallId: r.mahallId ?? null,
    obliged: num(r.obliged), settled: num(r.settled), partial: num(r.partial),
    expected: num(r.expected), applied: num(r.applied), expectedCharge: num(r.expectedCharge),
  }))
}

// ── Kassa (yig'ilgan) — ikki aniq ma'no ─────────────────────────────────────

export interface CollectRow { districtId: string; mahallId: string | null; forMonth: number; cash: number }

/**
 * Bitta oy uchun (tuman × mahalla):
 *  - forMonth — "Shu oyga tegishli": payment.month = oy;
 *  - cash     — "Kassaga tushdi": paidAt shu UZT oyi ichida.
 */
export async function queryCollected(
  user: ScopeUser, statuses: string[], month: string, extra: Prisma.Sql = Prisma.empty,
): Promise<CollectRow[]> {
  const ent = entCte(user, statuses, extra)
  const b = monthBoundsUz(month)
  if (!ent || !b) return []
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}
    SELECT ent.did AS "districtId", ent.mid AS "mahallId",
           COALESCE(SUM(p."amount") FILTER (WHERE p."month" = ${month}), 0)::bigint AS "forMonth",
           COALESCE(SUM(p."amount") FILTER (WHERE p."paidAt" >= ${ts(b.start)} AND p."paidAt" < ${ts(b.end)}), 0)::bigint AS cash
    FROM "ekohisob_payments" p JOIN ent ON ent.id = p."entityId"
    WHERE p."month" = ${month} OR (p."paidAt" >= ${ts(b.start)} AND p."paidAt" < ${ts(b.end)})
    GROUP BY 1, 2`)
  return rows.map(r => ({
    districtId: r.districtId, mahallId: r.mahallId ?? null, forMonth: num(r.forMonth), cash: num(r.cash),
  }))
}

/** Kassaga tushgan summa oy bo'yicha (UZT oy chegarasi) — davr trendi uchun. */
export async function queryCashByMonth(
  user: ScopeUser, statuses: string[], months: string[],
): Promise<Map<string, { cash: number; count: number }>> {
  const out = new Map<string, { cash: number; count: number }>()
  const ent = entCte(user, statuses)
  const first = months.length ? monthBoundsUz(months[0]) : null
  const last = months.length ? monthBoundsUz(months[months.length - 1]) : null
  if (!ent || !first || !last) return out
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}
    SELECT to_char(p."paidAt" + interval '5 hours', 'YYYY-MM') AS month,
           SUM(p."amount")::bigint AS cash, COUNT(*)::int AS cnt
    FROM "ekohisob_payments" p JOIN ent ON ent.id = p."entityId"
    WHERE p."paidAt" >= ${ts(first.start)} AND p."paidAt" < ${ts(last.end)}
    GROUP BY 1`)
  for (const r of rows) out.set(r.month, { cash: num(r.cash), count: num(r.cnt) })
  return out
}

/** Tashkilot soni (tuman × mahalla). */
export async function queryEntityCounts(
  user: ScopeUser, statuses: string[], extra: Prisma.Sql = Prisma.empty,
): Promise<{ districtId: string; mahallId: string | null; total: number }[]> {
  const ent = entCte(user, statuses, extra)
  if (!ent) return []
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent} SELECT ent.did AS "districtId", ent.mid AS "mahallId", COUNT(*)::int AS total FROM ent GROUP BY 1, 2`)
  return rows.map(r => ({ districtId: r.districtId, mahallId: r.mahallId ?? null, total: num(r.total) }))
}

/** Shu oy to'lov qilgan DISTINCT tashkilotlar (oy bo'yicha). */
export async function queryPayersByMonth(
  user: ScopeUser, statuses: string[], months: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ent = entCte(user, statuses)
  if (!ent || months.length === 0) return out
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}
    SELECT p."month" AS month, COUNT(DISTINCT p."entityId")::int AS payers
    FROM "ekohisob_payments" p JOIN ent ON ent.id = p."entityId"
    WHERE p."month" IN (${Prisma.join(months)})
    GROUP BY 1`)
  for (const r of rows) out.set(r.month, num(r.payers))
  return out
}

/** Kassa yig'indisi [start, end) — UZT chegaralari bilan chaqiriladi (tempo uchun). */
export async function sumCashBetween(user: ScopeUser, statuses: string[], start: Date, end: Date): Promise<number> {
  if (!user.orgId) return 0
  const agg = await (prisma as any).ekoHisobPayment.aggregate({
    where: { entity: entityWhereFor(user, statuses), paidAt: { gte: start, lt: end } },
    _sum: { amount: true },
  })
  return num(agg._sum.amount)
}

/** Tashkilot bo'yicha to'lov qilingan oylar (payment.month) — "to'xtagan mijoz" tahlili uchun. */
export async function queryPaidMonthsByEntity(
  user: ScopeUser, statuses: string[], months: string[],
): Promise<{ entityId: string; paidMonths: string[]; total: number; count: number }[]> {
  const ent = entCte(user, statuses)
  if (!ent || months.length === 0) return []
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}
    SELECT p."entityId" AS id, array_agg(DISTINCT p."month") AS months,
           SUM(p."amount")::bigint AS total, COUNT(DISTINCT p."month")::int AS cnt
    FROM "ekohisob_payments" p JOIN ent ON ent.id = p."entityId"
    WHERE p."month" IN (${Prisma.join(months)})
    GROUP BY p."entityId"`)
  return rows.map(r => ({
    entityId: r.id, paidMonths: (r.months as string[]) ?? [], total: num(r.total), count: num(r.cnt),
  }))
}

// ── Inspektor hisoboti ──────────────────────────────────────────────────────

/** Inspektor qabul qilgan to'lovlar (payment.month bo'yicha) — oy × tuman kesimida, doira ichida. */
export async function queryInspectorPaymentGroups(
  user: ScopeUser, inspectorId: string, months: string[],
): Promise<{ month: string; districtId: string; districtName: string; count: number; amount: number }[]> {
  const ent = entCte(user, ALL_STATUSES)
  if (!ent || months.length === 0) return []
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}
    SELECT p."month" AS month, ent.did AS "districtId", d."name" AS "districtName",
           COUNT(*)::int AS cnt, SUM(p."amount")::bigint AS amt
    FROM "ekohisob_payments" p
    JOIN ent ON ent.id = p."entityId"
    LEFT JOIN "ekohisob_districts" d ON d."id" = ent.did
    WHERE p."receivedBy" = ${inspectorId} AND p."month" IN (${Prisma.join(months)})
    GROUP BY 1, 2, 3`)
  return rows.map(r => ({
    month: r.month, districtId: r.districtId, districtName: r.districtName ?? '—',
    count: num(r.cnt), amount: num(r.amt),
  }))
}

/** Inspektor KASSAGA tushirgani [start, end) (paidAt, UZT chegarasi) + faol kunlar (UZT kun bo'yicha). */
export async function queryInspectorCash(
  user: ScopeUser, inspectorId: string, start: Date, end: Date,
): Promise<{ cash: number; count: number; activeDays: number }> {
  const ent = entCte(user, ALL_STATUSES)
  if (!ent) return { cash: 0, count: 0, activeDays: 0 }
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}
    SELECT COALESCE(SUM(p."amount"), 0)::bigint AS cash, COUNT(*)::int AS cnt,
           COUNT(DISTINCT to_char(p."paidAt" + interval '5 hours', 'YYYY-MM-DD'))::int AS days
    FROM "ekohisob_payments" p JOIN ent ON ent.id = p."entityId"
    WHERE p."receivedBy" = ${inspectorId} AND p."paidAt" >= ${ts(start)} AND p."paidAt" < ${ts(end)}`)
  const r = rows[0] ?? {}
  return { cash: num(r.cash), count: num(r.cnt), activeDays: num(r.days) }
}

/** Inspektor kiritgan tashkilotlar — UZT kun bo'yicha (kun → soni). */
export async function queryCreatedByDay(
  user: ScopeUser, inspectorId: string, start: Date, end: Date,
): Promise<Record<string, number>> {
  const ent = entCte(user, ALL_STATUSES)
  const out: Record<string, number> = {}
  if (!ent) return out
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH ${ent}
    SELECT to_char(e."createdAt" + interval '5 hours', 'YYYY-MM-DD') AS day, COUNT(*)::int AS cnt
    FROM "ekohisob_legal_entities" e JOIN ent ON ent.id = e."id"
    WHERE e."createdBy" = ${inspectorId} AND e."createdAt" >= ${ts(start)} AND e."createdAt" < ${ts(end)}
    GROUP BY 1`)
  for (const r of rows) out[r.day] = num(r.cnt)
  return out
}
