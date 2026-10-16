-- Company updates for portfolio companies (news log; WhatsApp intake later).
CREATE TABLE "CompanyUpdate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyUpdate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CompanyUpdate_source_check" CHECK ("source" IN ('MANUAL', 'WHATSAPP'))
);
CREATE INDEX "CompanyUpdate_companyId_date_idx" ON "CompanyUpdate"("companyId", "date");
ALTER TABLE "CompanyUpdate" ADD CONSTRAINT "CompanyUpdate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyUpdate" ADD CONSTRAINT "CompanyUpdate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
