-- Landing'dan kelgan ariza (lead) — public, hech qaysi org'ga bog'lanmagan.
CREATE TABLE IF NOT EXISTS "leads" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "fullName"        TEXT NOT NULL,
  "phone"           TEXT NOT NULL,
  "email"           TEXT,
  "organizationName" TEXT,
  "fleetSize"       INTEGER,
  "message"         TEXT,
  "source"          TEXT NOT NULL DEFAULT 'landing',
  "referrer"        TEXT,
  "ipAddress"       TEXT,
  "userAgent"       TEXT,
  "status"          TEXT NOT NULL DEFAULT 'new',
  "notes"           TEXT,
  "contactedAt"     TIMESTAMP(3),
  "convertedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads"("status");
CREATE INDEX IF NOT EXISTS "leads_createdAt_idx" ON "leads"("createdAt");
