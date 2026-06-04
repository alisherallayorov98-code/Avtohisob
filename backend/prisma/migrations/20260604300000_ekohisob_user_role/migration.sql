-- AddValue: UserRole enum ga ekohisob_user qo'shish
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction in PostgreSQL
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ekohisob_user';

-- AlterTable: User modeliga ekoDistrictIds qo'shish
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ekoDistrictIds" TEXT[] NOT NULL DEFAULT '{}';
