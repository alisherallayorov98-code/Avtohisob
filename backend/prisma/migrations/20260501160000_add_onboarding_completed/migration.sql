-- Onboarding (yo'riqnoma) tugatish vaqti
-- null = hali tugatmagan (yo'riqnoma ko'rsatiladi)
ALTER TABLE "users" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
