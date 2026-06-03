-- CreateTable: EkoHisob moduli

CREATE TABLE "ekohisob_users" (
    "id"           TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName"     TEXT NOT NULL,
    "role"         TEXT NOT NULL DEFAULT 'inspector',
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "orgId"        TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ekohisob_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ekohisob_user_districts" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "districtId" TEXT NOT NULL,

    CONSTRAINT "ekohisob_user_districts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ekohisob_districts" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "orgId"     TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_districts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ekohisob_mahallas" (
    "id"         TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_mahallas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ekohisob_legal_entities" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "stir"        TEXT,
    "code"        TEXT,
    "address"     TEXT,
    "lat"         DOUBLE PRECISION,
    "lon"         DOUBLE PRECISION,
    "phone"       TEXT,
    "contactName" TEXT,
    "districtId"  TEXT NOT NULL,
    "mahallId"    TEXT,
    "orgId"       TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'active',
    "monthlyFee"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ekohisob_legal_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ekohisob_payments" (
    "id"         TEXT NOT NULL,
    "entityId"   TEXT NOT NULL,
    "month"      TEXT NOT NULL,
    "amount"     INTEGER NOT NULL,
    "paidAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedBy" TEXT NOT NULL,
    "note"       TEXT,

    CONSTRAINT "ekohisob_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ekohisob_blacklist" (
    "id"         TEXT NOT NULL,
    "entityId"   TEXT NOT NULL,
    "reason"     TEXT NOT NULL,
    "addedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy"    TEXT NOT NULL,
    "govOrgName" TEXT,
    "govCaseId"  TEXT,
    "status"     TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "ekohisob_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex

CREATE UNIQUE INDEX "ekohisob_users_email_orgId_key"
    ON "ekohisob_users"("email", "orgId");

CREATE INDEX "ekohisob_users_orgId_idx"
    ON "ekohisob_users"("orgId");

CREATE UNIQUE INDEX "ekohisob_user_districts_userId_districtId_key"
    ON "ekohisob_user_districts"("userId", "districtId");

CREATE INDEX "ekohisob_districts_orgId_idx"
    ON "ekohisob_districts"("orgId");

CREATE INDEX "ekohisob_mahallas_districtId_idx"
    ON "ekohisob_mahallas"("districtId");

CREATE INDEX "ekohisob_legal_entities_districtId_idx"
    ON "ekohisob_legal_entities"("districtId");

CREATE INDEX "ekohisob_legal_entities_orgId_idx"
    ON "ekohisob_legal_entities"("orgId");

CREATE INDEX "ekohisob_legal_entities_stir_idx"
    ON "ekohisob_legal_entities"("stir");

CREATE INDEX "ekohisob_legal_entities_status_idx"
    ON "ekohisob_legal_entities"("status");

CREATE UNIQUE INDEX "ekohisob_payments_entityId_month_key"
    ON "ekohisob_payments"("entityId", "month");

CREATE INDEX "ekohisob_payments_entityId_idx"
    ON "ekohisob_payments"("entityId");

CREATE INDEX "ekohisob_payments_month_idx"
    ON "ekohisob_payments"("month");

CREATE UNIQUE INDEX "ekohisob_blacklist_entityId_key"
    ON "ekohisob_blacklist"("entityId");

-- AddForeignKey

ALTER TABLE "ekohisob_user_districts" ADD CONSTRAINT "ekohisob_user_districts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "ekohisob_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ekohisob_user_districts" ADD CONSTRAINT "ekohisob_user_districts_districtId_fkey"
    FOREIGN KEY ("districtId") REFERENCES "ekohisob_districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ekohisob_mahallas" ADD CONSTRAINT "ekohisob_mahallas_districtId_fkey"
    FOREIGN KEY ("districtId") REFERENCES "ekohisob_districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ekohisob_legal_entities" ADD CONSTRAINT "ekohisob_legal_entities_districtId_fkey"
    FOREIGN KEY ("districtId") REFERENCES "ekohisob_districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ekohisob_legal_entities" ADD CONSTRAINT "ekohisob_legal_entities_mahallId_fkey"
    FOREIGN KEY ("mahallId") REFERENCES "ekohisob_mahallas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ekohisob_payments" ADD CONSTRAINT "ekohisob_payments_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "ekohisob_legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ekohisob_payments" ADD CONSTRAINT "ekohisob_payments_receivedBy_fkey"
    FOREIGN KEY ("receivedBy") REFERENCES "ekohisob_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ekohisob_blacklist" ADD CONSTRAINT "ekohisob_blacklist_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "ekohisob_legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
