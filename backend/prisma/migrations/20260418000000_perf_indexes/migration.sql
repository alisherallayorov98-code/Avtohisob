-- Perf: ko'p ishlatiladigan WHERE filtrlarini tezlashtirish uchun indekslar
CREATE INDEX IF NOT EXISTS "maintenance_records_sparePartId_idx" ON "maintenance_records"("sparePartId");
CREATE INDEX IF NOT EXISTS "fuel_records_supplierId_idx" ON "fuel_records"("supplierId");
CREATE INDEX IF NOT EXISTS "expenses_vehicleId_expenseDate_idx" ON "expenses"("vehicleId", "expenseDate");
