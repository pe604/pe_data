-- Events: a "coming up" message to the PE Events group 10 days before (SPEC §15.14)
ALTER TABLE "Event" ADD COLUMN "soonAlertedAt" TIMESTAMP(3);
