-- Idle deal reminders on WhatsApp (SPEC 15.7): per-person switch, a log of reminders sent, a per-day lock.
ALTER TABLE "TeamMember" ADD COLUMN "remindersOn" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "idleDays" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReminderLog_companyId_teamMemberId_sentAt_idx" ON "ReminderLog"("companyId", "teamMemberId", "sentAt");
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReminderRun" (
    "day" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ReminderRun_pkey" PRIMARY KEY ("day")
);
