-- Yakka haydovchi Telegram bot modellari

CREATE TABLE "driver_bot_users" (
    "id"            TEXT NOT NULL,
    "chatId"        TEXT NOT NULL,
    "firstName"     TEXT,
    "lastName"      TEXT,
    "username"      TEXT,
    "fuelPrice"     INTEGER NOT NULL DEFAULT 12000,
    "fuelPer100km"  INTEGER NOT NULL DEFAULT 30,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_bot_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "driver_bot_users_chatId_key" ON "driver_bot_users"("chatId");

CREATE TABLE "driver_trips" (
    "id"            TEXT NOT NULL,
    "driverId"      TEXT NOT NULL,
    "fromCity"      TEXT NOT NULL,
    "toCity"        TEXT NOT NULL,
    "distanceKm"    INTEGER NOT NULL,
    "cargoPrice"    INTEGER NOT NULL,
    "fuelCost"      INTEGER NOT NULL,
    "tollCost"      INTEGER NOT NULL DEFAULT 0,
    "otherCost"     INTEGER NOT NULL DEFAULT 0,
    "netProfit"     INTEGER NOT NULL,
    "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"   TIMESTAMP(3),
    "status"        TEXT NOT NULL DEFAULT 'completed',

    CONSTRAINT "driver_trips_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_trips_driverId_idx" ON "driver_trips"("driverId");
CREATE INDEX "driver_trips_startedAt_idx" ON "driver_trips"("startedAt");

CREATE TABLE "driver_expenses" (
    "id"            TEXT NOT NULL,
    "driverId"      TEXT NOT NULL,
    "type"          TEXT NOT NULL,
    "amount"        INTEGER NOT NULL,
    "description"   TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_expenses_driverId_idx" ON "driver_expenses"("driverId");
CREATE INDEX "driver_expenses_createdAt_idx" ON "driver_expenses"("createdAt");

ALTER TABLE "driver_trips"    ADD CONSTRAINT "driver_trips_driverId_fkey"    FOREIGN KEY ("driverId") REFERENCES "driver_bot_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_expenses" ADD CONSTRAINT "driver_expenses_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_bot_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
