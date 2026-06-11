-- Bak hajmi (litr) — qoldiqni hisoblash va to'ldirish vaqtini bashorat qilish uchun.
-- IF NOT EXISTS: tankCapacity allaqachon 20260505100000_add_fuel_monitoring da
-- qo'shilgan bo'lishi mumkin (Wialon fuel sensor). Bu migratsiya — no-op zaxira.
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "tankCapacity" DOUBLE PRECISION;
