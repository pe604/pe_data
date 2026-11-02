-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "alertPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "alertedAt" TIMESTAMP(3);
