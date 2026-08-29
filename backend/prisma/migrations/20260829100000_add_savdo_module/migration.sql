-- AvtoHisob Savdo — 1-bosqich (scaffold): faqat auth/tenant asosi.
-- EkoHisob bilan bir xil izolyatsiya patterni: o'z foydalanuvchi jadvali,
-- orgId opaque tenant identifikatori (core "organizations"ga FK emas).
-- Idempotent — qayta ishga tushirish xavfsiz.

CREATE TABLE IF NOT EXISTS "savdo_users" (
    "id"           TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName"     TEXT NOT NULL,
    "role"         TEXT NOT NULL DEFAULT 'staff',
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "isMirror"     BOOLEAN NOT NULL DEFAULT false,
    "orgId"        TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savdo_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "savdo_users_email_orgId_key" ON "savdo_users"("email", "orgId");
CREATE INDEX IF NOT EXISTS "savdo_users_orgId_idx" ON "savdo_users"("orgId");
