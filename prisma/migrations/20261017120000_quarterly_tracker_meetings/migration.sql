-- Quarterly tracker (per company per FY quarter), per-quarter MIS due date, and meetings.
CREATE TABLE "QuarterCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "misAt" DATE,
    "resultNoteAt" DATE,
    "resultUpdateAt" DATE,
    "bdoAt" DATE,
    "remarks" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuarterCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuarterCheck_companyId_quarter_key" ON "QuarterCheck"("companyId", "quarter");
ALTER TABLE "QuarterCheck" ADD CONSTRAINT "QuarterCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "QuarterSetting" (
    "quarter" TEXT NOT NULL,
    "misDue" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuarterSetting_pkey" PRIMARY KEY ("quarter")
);

CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "attendees" TEXT[],
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Meeting_status_check" CHECK ("status" IN ('PLANNED', 'DONE', 'CANCELLED'))
);
CREATE INDEX "Meeting_date_idx" ON "Meeting"("date");
CREATE INDEX "Meeting_companyId_date_idx" ON "Meeting"("companyId", "date");
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
