-- Fund per round (Hedgehogs / Sambhav); quarterly MIS and result-note files; contacts; valuations removed.
ALTER TYPE "FileKind" ADD VALUE 'RESULT_NOTE';

ALTER TABLE "File" ADD COLUMN "quarter" TEXT;
CREATE INDEX "File_companyId_quarter_idx" ON "File"("companyId", "quarter");

ALTER TABLE "InvestmentRound" ADD COLUMN "fund" TEXT;
ALTER TABLE "InvestmentRound" ADD CONSTRAINT "InvestmentRound_fund_check" CHECK ("fund" IS NULL OR "fund" IN ('Hedgehogs', 'Sambhav'));

-- Current value and MOIC are no longer tracked (decision of 2026-10-16).
DROP TABLE "ValuationMark";

-- Tracker columns removed: result update, shared with BDO.
ALTER TABLE "QuarterCheck" DROP COLUMN "resultUpdateAt";
ALTER TABLE "QuarterCheck" DROP COLUMN "bdoAt";

CREATE TABLE "CompanyContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyContact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompanyContact_companyId_idx" ON "CompanyContact"("companyId");
ALTER TABLE "CompanyContact" ADD CONSTRAINT "CompanyContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
