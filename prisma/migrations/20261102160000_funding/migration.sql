-- Funding tracker (SPEC §15.16)
CREATE TABLE "FundingDeal" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amountUsdM" DOUBLE PRECISION,
    "round" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "what" TEXT,
    "lead" TEXT,
    "investors" TEXT[],
    "date" DATE NOT NULL,
    "sources" JSONB NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingDeal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FundingDeal_date_idx" ON "FundingDeal"("date");
CREATE INDEX "FundingDeal_key_idx" ON "FundingDeal"("key");

CREATE TABLE "FundingSeen" (
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingSeen_pkey" PRIMARY KEY ("url")
);

CREATE TABLE "FundingNote" (
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "unchecked" TEXT[],
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingNote_pkey" PRIMARY KEY ("period")
);
