-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('PROCESSING', 'DONE', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "whatsappNumber" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppIntake" (
    "id" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderNumber" TEXT,
    "viaName" TEXT,
    "fileName" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'PROCESSING',
    "companyId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "WhatsAppIntake_status_createdAt_idx" ON "WhatsAppIntake"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_whatsappNumber_key" ON "TeamMember"("whatsappNumber");
