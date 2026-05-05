-- User.preferredLanguage — UI tili (Telegram, Excel, hisobotlar uchun ham).
-- Mumkin qiymatlar: 'uz' (lotin) | 'uz-cyrl' (kirill) | 'ru' (rus) | 'zh' (xitoy).
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS — qayta ishga tushishi xavfsiz.
-- Eski User yozuvlari avtomatik 'uz' (default) bilan to'ldiriladi.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT NOT NULL DEFAULT 'uz';
