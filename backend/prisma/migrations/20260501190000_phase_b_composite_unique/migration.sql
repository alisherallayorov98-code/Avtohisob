-- Faza B — Composite unique keys (multi-tenant info-leak yopish)
--
-- Avval bir nechta maydonlar globally unique edi:
--   - SparePart.partCode: bir xil "BAT-001" ikki tashkilot ishlata olmasdi
--   - Waybill.number: WB-2026-0042 boshqa orgning waybill sonini leak qilardi
-- Endi har biri per-org unique — ma'lumot leak'i yopiq.

-- ─── B2: SparePart.partCode composite (organizationId + partCode) ───────────

-- Eski global unique constraint'ni olib tashlash
ALTER TABLE "spare_parts" DROP CONSTRAINT IF EXISTS "spare_parts_partCode_key";
DROP INDEX IF EXISTS "spare_parts_partCode_key";

-- Yangi composite unique: organizationId + partCode
-- Eslatma: organizationId NULL bo'lsa (legacy), Postgres NULL'larni distinct
-- deb hisoblaydi → bir nechta NULL+bir xil partCode ruxsat etilgan.
CREATE UNIQUE INDEX IF NOT EXISTS "spare_parts_org_partcode_key"
  ON "spare_parts"("organizationId", "partCode");

-- ─── B3: Waybill — orgId qo'shish + composite unique [orgId, number] ────────

-- Avval orgId ustunini qo'shamiz (nullable, additive)
ALTER TABLE "waybills" ADD COLUMN IF NOT EXISTS "orgId" TEXT;

-- Backfill: har bir waybill uchun branch.organizationId'ni o'rnatamiz.
-- Branch.organizationId NULL bo'lsa branch.id'ni ishlatamiz (resolveOrgId mantig'i).
UPDATE "waybills" w
SET "orgId" = COALESCE(b."organizationId", b.id)
FROM "branches" b
WHERE w."branchId" = b.id
  AND w."orgId" IS NULL;

-- Eski global unique constraint'ni olib tashlash
ALTER TABLE "waybills" DROP CONSTRAINT IF EXISTS "waybills_number_key";
DROP INDEX IF EXISTS "waybills_number_key";

-- Yangi composite unique: orgId + number
-- DIQQAT: agar mavjud yozuvlarda orgId NULL bo'lsa va bir xil number bo'lsa,
-- bu constraint o'rnatilganda xato bermaydi (NULL'lar distinct hisoblanadi).
-- Lekin orgId aniq qiymat bo'lsa, dublikatlar P2002 bilan to'siladi.
CREATE UNIQUE INDEX IF NOT EXISTS "waybills_org_number_key"
  ON "waybills"("orgId", "number");

CREATE INDEX IF NOT EXISTS "waybills_orgId_idx" ON "waybills"("orgId");
