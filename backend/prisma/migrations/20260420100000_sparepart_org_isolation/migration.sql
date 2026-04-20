-- Multi-tenant isolation: SparePart + ArticleCode + SparePartStatistic + AIAnalysisLog
-- organizationId = Branch.id (root branch = organization). null = legacy (oldingi yozuv).

-- SparePart
ALTER TABLE "spare_parts" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "spare_parts_organizationId_idx" ON "spare_parts"("organizationId");

UPDATE "spare_parts" sp
SET "organizationId" = s."organizationId"
FROM "suppliers" s
WHERE sp."supplierId" = s."id"
  AND s."organizationId" IS NOT NULL;

-- ArticleCode
ALTER TABLE "article_codes" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "article_codes_organizationId_idx" ON "article_codes"("organizationId");

UPDATE "article_codes" ac
SET "organizationId" = sp."organizationId"
FROM "spare_parts" sp
WHERE ac."sparePartId" = sp."id"
  AND sp."organizationId" IS NOT NULL;

-- SparePartStatistic
ALTER TABLE "spare_part_statistics" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "spare_part_statistics_organizationId_idx" ON "spare_part_statistics"("organizationId");

UPDATE "spare_part_statistics" sps
SET "organizationId" = sp."organizationId"
FROM "spare_parts" sp
WHERE sps."sparePartId" = sp."id"
  AND sp."organizationId" IS NOT NULL;

-- AIAnalysisLog: aniq bog'lanish yo'q, faqat column qo'shamiz. Yangi loglar'da
-- controller orgId'ni to'ldiradi. Eski loglar null qoladi (super_admin ko'radi).
ALTER TABLE "ai_analysis_logs" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "ai_analysis_logs_organizationId_idx" ON "ai_analysis_logs"("organizationId");
