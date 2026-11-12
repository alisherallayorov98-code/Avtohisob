-- Import xarajati: umumiy partiya yoki har bir birlikka
ALTER TABLE "savdo_purchase_costs" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'total';
