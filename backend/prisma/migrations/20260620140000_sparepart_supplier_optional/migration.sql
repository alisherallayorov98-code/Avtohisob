-- Ehtiyot qism yetkazuvchisi ixtiyoriy bo'ldi (ko'chadan/hujjatsiz kirim uchun).
-- Avval supplierId NOT NULL edi -> yetkazuvchisiz qism yaratishda 500 xato berardi.
ALTER TABLE "spare_parts" ALTER COLUMN "supplierId" DROP NOT NULL;
