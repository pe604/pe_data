-- Invested tab: amount invested per portfolio company, in INR crore.
ALTER TABLE "Company" ADD COLUMN "amountInvested" DECIMAL(14,2);
ALTER TABLE "Company" ADD CONSTRAINT "Company_amountInvested_check" CHECK ("amountInvested" IS NULL OR "amountInvested" >= 0);
