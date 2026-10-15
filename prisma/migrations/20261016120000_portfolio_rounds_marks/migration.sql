-- Portfolio tracking: investment rounds and valuation marks (amounts in INR crore).
CREATE TABLE "InvestmentRound" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "round" TEXT,
    "instrument" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "preMoney" DECIMAL(16,2),
    "stakePct" DECIMAL(7,4),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentRound_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InvestmentRound_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "InvestmentRound_preMoney_check" CHECK ("preMoney" IS NULL OR "preMoney" >= 0),
    CONSTRAINT "InvestmentRound_stakePct_check" CHECK ("stakePct" IS NULL OR ("stakePct" >= 0 AND "stakePct" <= 100))
);

CREATE TABLE "ValuationMark" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "valuation" DECIMAL(16,2) NOT NULL,
    "stakePct" DECIMAL(7,4) NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ValuationMark_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ValuationMark_valuation_check" CHECK ("valuation" >= 0),
    CONSTRAINT "ValuationMark_stakePct_check" CHECK ("stakePct" > 0 AND "stakePct" <= 100)
);

CREATE INDEX "InvestmentRound_companyId_date_idx" ON "InvestmentRound"("companyId", "date");
CREATE INDEX "ValuationMark_companyId_date_idx" ON "ValuationMark"("companyId", "date");

ALTER TABLE "InvestmentRound" ADD CONSTRAINT "InvestmentRound_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentRound" ADD CONSTRAINT "InvestmentRound_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ValuationMark" ADD CONSTRAINT "ValuationMark_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValuationMark" ADD CONSTRAINT "ValuationMark_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Amounts already typed into the single "Amount invested" box become each company's first round.
INSERT INTO "InvestmentRound" ("id", "companyId", "date", "amount", "createdById")
SELECT 'mig-' || "id", "id", COALESCE("exitAt", CURRENT_DATE), "amountInvested", "createdById"
FROM "Company"
WHERE "amountInvested" IS NOT NULL AND "amountInvested" > 0;

ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "Company_amountInvested_check";
ALTER TABLE "Company" DROP COLUMN "amountInvested";
