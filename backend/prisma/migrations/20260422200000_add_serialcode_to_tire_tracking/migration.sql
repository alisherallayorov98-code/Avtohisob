-- serialCode ustuni mavjud bo'lmasa qo'shish (production'da yo'q edi)
ALTER TABLE "tire_tracking" ADD COLUMN IF NOT EXISTS "serialCode" TEXT;
