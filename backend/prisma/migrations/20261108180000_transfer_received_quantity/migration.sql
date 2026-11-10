-- Jo'natmani qabul qilishda haqiqiy kelgan miqdor va izoh (kamomadni qayd etish uchun)
ALTER TABLE "inventory_transfers" ADD COLUMN IF NOT EXISTS "receivedQuantity" INTEGER;
ALTER TABLE "transfer_batches" ADD COLUMN IF NOT EXISTS "receiveNotes" TEXT;
