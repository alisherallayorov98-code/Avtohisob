-- Ombor uchun bir vaqtda faqat BITTA ochiq smena bo'lishini DB darajasida
-- kafolatlaydi. Ilgari faqat controller'da "findFirst → create" tekshiruvi
-- bor edi (poyga holati: ikki so'rov bir vaqtda kelsa ikkalasi ham "ochiq
-- smena yo'q" ko'rib, ikkita smena yaratardi). Qisman (partial) unique
-- indeks — faqat status='open' qatorlarga taalluqli, yopilgan smenalar
-- cheklovga tushmaydi.
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_kassa_smena_one_open_per_warehouse"
    ON "savdo_kassa_smena"("warehouseId")
    WHERE "status" = 'open';
