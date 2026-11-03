-- Funding notes: a shareable version without our own pipeline, for the funding-only deployment (SPEC §15.16)
ALTER TABLE "FundingNote" ADD COLUMN "publicData" JSONB;
ALTER TABLE "FundingNote" ADD COLUMN "publicUnchecked" TEXT[];
