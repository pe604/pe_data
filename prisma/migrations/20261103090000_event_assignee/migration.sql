-- Events: an owner from the PE team, reminded 7 and 2 days before (SPEC §15.14)
ALTER TABLE "Event" ADD COLUMN "assignee" TEXT;
ALTER TABLE "Event" ADD COLUMN "remind7At" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "remind2At" TIMESTAMP(3);
