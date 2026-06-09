-- Mashinaga biriktirilgan haydovchi (Telegram) + ulanish tokeni
CREATE TABLE "vehicle_care_drivers" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "driverName" TEXT,
    "tgUsername" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_care_drivers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vehicle_care_drivers_vehicleId_key" ON "vehicle_care_drivers"("vehicleId");
CREATE INDEX "vehicle_care_drivers_chatId_idx" ON "vehicle_care_drivers"("chatId");

CREATE TABLE "vehicle_care_link_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_care_link_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vehicle_care_link_tokens_token_key" ON "vehicle_care_link_tokens"("token");
CREATE INDEX "vehicle_care_link_tokens_vehicleId_idx" ON "vehicle_care_link_tokens"("vehicleId");
