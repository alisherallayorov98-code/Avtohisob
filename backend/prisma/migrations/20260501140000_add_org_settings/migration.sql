-- CreateTable: tashkilot doirasidagi umumiy sozlamalar
-- "Soddalashtirilgan ko'rinish" — norasmiy yozuvlarni butun saytdan yashirish
CREATE TABLE "org_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "simplifiedView" BOOLEAN NOT NULL DEFAULT false,
    "simplifiedAt" TIMESTAMP(3),
    "toggledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_settings_organizationId_key" ON "org_settings"("organizationId");
