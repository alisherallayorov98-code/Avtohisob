-- Rasmiy/Norasmiy belgisi: kirim va texnik xizmat yozuvlari uchun
-- Default true (eski yozuvlar rasmiy deb sanaymiz, hech qanday yozuv buzilmaydi)

ALTER TABLE "inventory_receipts" ADD COLUMN "isOfficial" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "maintenance_records" ADD COLUMN "isOfficial" BOOLEAN NOT NULL DEFAULT true;
