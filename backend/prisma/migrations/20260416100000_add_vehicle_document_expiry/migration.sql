-- AlterTable: Vehicle ga sug'urta va texosmotr muddati maydonlarini qo'shish
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "insuranceExpiry" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "techInspectionExpiry" TIMESTAMP(3);
