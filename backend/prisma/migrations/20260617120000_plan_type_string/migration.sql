-- PlanType enum → String: cheksiz tarif turlarini qo'llab-quvvatlash uchun
-- (avval enum faqat 4 qiymatli edi, shu sabab 20/100/200 mashina tariflari seed bo'lmasdi)

-- users.maxPlanType
ALTER TABLE "users" ALTER COLUMN "maxPlanType" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "maxPlanType" TYPE TEXT USING "maxPlanType"::TEXT;
ALTER TABLE "users" ALTER COLUMN "maxPlanType" SET DEFAULT 'free';

-- plans.type (@unique indeks avtomatik qayta quriladi)
ALTER TABLE "plans" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;

-- Endi enum hech qayerda ishlatilmaydi — o'chiramiz
DROP TYPE "PlanType";
