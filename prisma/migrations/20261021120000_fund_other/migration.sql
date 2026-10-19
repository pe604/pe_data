-- Third fund choice: Other (money not from Hedgehogs or Sambhav, e.g. a direct investment).
ALTER TABLE "InvestmentRound" DROP CONSTRAINT "InvestmentRound_fund_check";
ALTER TABLE "InvestmentRound" ADD CONSTRAINT "InvestmentRound_fund_check" CHECK ("fund" IS NULL OR "fund" IN ('Hedgehogs', 'Sambhav', 'Other'));
