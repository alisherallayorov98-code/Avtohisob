-- Maxfiylik siyosati va ommaviy ofertani qabul qilish vaqti
-- null = hali qabul qilmagan; mavjud foydalanuvchilar uchun null (banner ko'rsatiladi)
ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
