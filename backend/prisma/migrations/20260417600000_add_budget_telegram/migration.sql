ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "telegramBotToken" TEXT;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;

CREATE TABLE IF NOT EXISTS "budget_plans" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "orgId"     TEXT NOT NULL,
  "branchId"  TEXT,
  "year"      INTEGER NOT NULL,
  "month"     INTEGER NOT NULL,
  "category"  TEXT NOT NULL,
  "amount"    DECIMAL NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("orgId", "year", "month", "category", "branchId")
);
CREATE INDEX IF NOT EXISTS "budget_plans_orgId_year_idx" ON "budget_plans"("orgId", "year");
