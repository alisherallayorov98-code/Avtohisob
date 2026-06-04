-- EkoHisob field worker Telegram bot: bot link va linking token jadvallari

CREATE TABLE "ekohisob_bot_links" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ekohisob_bot_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ekohisob_link_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ekohisob_link_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ekohisob_bot_links_chatId_key" ON "ekohisob_bot_links"("chatId");
CREATE UNIQUE INDEX "ekohisob_bot_links_userId_key" ON "ekohisob_bot_links"("userId");
CREATE UNIQUE INDEX "ekohisob_link_tokens_token_key" ON "ekohisob_link_tokens"("token");
CREATE INDEX "ekohisob_link_tokens_userId_idx" ON "ekohisob_link_tokens"("userId");

ALTER TABLE "ekohisob_bot_links" ADD CONSTRAINT "ekohisob_bot_links_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "ekohisob_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ekohisob_link_tokens" ADD CONSTRAINT "ekohisob_link_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "ekohisob_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
