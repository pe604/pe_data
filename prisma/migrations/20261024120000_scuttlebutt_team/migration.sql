-- Scuttlebutt team within Research (SPEC 15.9): team membership and one head per team.
ALTER TABLE "TeamMember" ADD COLUMN "team" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "teamHead" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_team_check" CHECK ("team" IS NULL OR "team" IN ('SCUTTLEBUTT'));
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamHead_check" CHECK (NOT "teamHead" OR "team" IS NOT NULL);
-- One head per team is enforced by the save action (src/actions/reminders.ts setMemberTeam).
