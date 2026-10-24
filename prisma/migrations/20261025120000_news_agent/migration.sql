-- Portfolio news agent (SPEC 15.10): watch list per company, every item seen, and news fields on company updates.
ALTER TABLE "CompanyUpdate" ADD COLUMN "url" TEXT;
ALTER TABLE "CompanyUpdate" ADD COLUMN "category" TEXT;
ALTER TABLE "CompanyUpdate" ADD COLUMN "importance" TEXT;
ALTER TABLE "CompanyUpdate" DROP CONSTRAINT "CompanyUpdate_source_check";
ALTER TABLE "CompanyUpdate" ADD CONSTRAINT "CompanyUpdate_source_check" CHECK ("source" IN ('MANUAL', 'WHATSAPP', 'NEWS', 'LINKEDIN'));

CREATE TABLE "NewsWatch" (
    "companyId" TEXT NOT NULL,
    "names" TEXT[],
    "website" TEXT,
    "linkedinUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NewsWatch_pkey" PRIMARY KEY ("companyId")
);
ALTER TABLE "NewsWatch" ADD CONSTRAINT "NewsWatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "verdict" TEXT NOT NULL DEFAULT 'PENDING',
    "category" TEXT,
    "importance" TEXT,
    "summary" TEXT,
    "updateId" TEXT,
    "code" TEXT,
    "alertedAt" TIMESTAMP(3),
    "digestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NewsItem_companyId_url_key" ON "NewsItem"("companyId", "url");
CREATE UNIQUE INDEX "NewsItem_code_key" ON "NewsItem"("code");
CREATE INDEX "NewsItem_verdict_alertedAt_digestedAt_idx" ON "NewsItem"("verdict", "alertedAt", "digestedAt");
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
