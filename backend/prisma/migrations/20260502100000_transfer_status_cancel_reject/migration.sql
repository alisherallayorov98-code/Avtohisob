-- TransferStatus enum'ga 'cancelled' va 'rejected' qiymatlarini qo'shish.
-- Idempotent: agar qiymat allaqachon mavjud bo'lsa skip qiladi.

ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'rejected';
