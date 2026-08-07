-- Vedomost importiga yetkazib beruvchi (yoqilg'i sotuvchisi).
--
-- Nega kerak: korxona bir vaqtda 2-3 ta yetkazib beruvchidan yoqilg'i oladi va
-- har biri o'z vedomostini beradi. Ilgari import qilingan FuelRecord'larda
-- supplierId BO'SH qolardi (qo'lda kiritishda to'ldirilardi), shuning uchun
-- "qaysi yetkazuvchidan qancha olindi" degan savolga import qilingan
-- yozuvlar bo'yicha javob yo'q edi.
--
-- Idempotent: mavjud ustunni buzmaydi (siniq migratsiya barcha deploylarni bloklaydi).

ALTER TABLE "fuel_imports" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

CREATE INDEX IF NOT EXISTS "fuel_imports_supplierId_idx" ON "fuel_imports"("supplierId");

-- FK uchun IF NOT EXISTS yo'q — takroriy yaratishni istisno bilan yutamiz.
-- ON DELETE SET NULL: yetkazuvchi o'chirilsa import tarixi yo'qolmasin.
DO $$
BEGIN
  ALTER TABLE "fuel_imports"
    ADD CONSTRAINT "fuel_imports_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
