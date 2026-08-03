-- EkoHisob: bitta naqd to'lov bir NECHA oyga taqsimlanishi mumkin (FIFO —
-- ortiqcha summa eng eski qarzni yopadi). Har oy uchun alohida to'lov yozuvi
-- yaratiladi (oy bo'yicha hisobot va akt sverka to'g'ri chiqishi uchun), lekin
-- ular bitta kassa operatsiyasi va bitta kvitansiya: shuni bog'lab turadigan
-- guruh id'si kerak. Bekor qilinganda ham butun guruh birga qaytariladi.
--
-- Idempotent: mavjud ustunni buzmaydi (siniq migratsiya barcha deploylarni bloklaydi).

ALTER TABLE "ekohisob_payments" ADD COLUMN IF NOT EXISTS "groupId" TEXT;

CREATE INDEX IF NOT EXISTS "ekohisob_payments_groupId_idx"
    ON "ekohisob_payments"("groupId");

-- Takroriy to'lov qorovuli (bir xil tashkilot+oy, qisqa vaqt ichida) shu indeksdan
-- foydalanadi — ekohisob_payments_entityId_month_idx allaqachon mavjud.
