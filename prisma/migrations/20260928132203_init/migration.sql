-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EDITOR');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('NOT_ASSIGNED', 'CALL_PENDING', 'INTERNAL_DISCUSSION', 'SCUTTLEBUTT', 'ALLOCATION', 'DUE_DILIGENCE');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('PIPELINE', 'REJECTED', 'INVESTED');

-- CreateEnum
CREATE TYPE "PersonRole" AS ENUM ('PE', 'RESEARCH', 'VIA');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('DECK', 'MODEL', 'OTHER');

-- CreateEnum
CREATE TYPE "SummaryJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SummaryJobStep" AS ENUM ('READING', 'WRITING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "peRank" INTEGER,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectorId" TEXT,
    "subSector" TEXT,
    "stage" "Stage" NOT NULL DEFAULT 'NOT_ASSIGNED',
    "priority" INTEGER,
    "status" "CompanyStatus" NOT NULL DEFAULT 'PIPELINE',
    "dateReceived" DATE,
    "exitAt" DATE,
    "exitStage" "Stage",
    "directInvested" BOOLEAN NOT NULL DEFAULT false,
    "rejectReason" TEXT,
    "oneDriveUrl" TEXT,
    "activeSummaryId" TEXT,
    "nameEdited" BOOLEAN NOT NULL DEFAULT false,
    "sectorEdited" BOOLEAN NOT NULL DEFAULT false,
    "subSectorEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPerson" (
    "companyId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "role" "PersonRole" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CompanyPerson_pkey" PRIMARY KEY ("companyId","role","teamMemberId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "originalName" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceFileId" TEXT,
    "sourceFileName" TEXT,
    "json" JSONB,
    "markdown" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummaryJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceFileId" TEXT,
    "status" "SummaryJobStatus" NOT NULL DEFAULT 'QUEUED',
    "step" "SummaryJobStep",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "resultJson" JSONB,
    "resultMarkdown" TEXT,
    "summaryId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SummaryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rejection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "stageAtRejection" "Stage" NOT NULL,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "actorId" TEXT NOT NULL,
    "field" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionLog" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_nameKey_key" ON "TeamMember"("nameKey");

-- CreateIndex
CREATE INDEX "TeamMember_peRank_idx" ON "TeamMember"("peRank");

-- CreateIndex
CREATE UNIQUE INDEX "Company_activeSummaryId_key" ON "Company"("activeSummaryId");

-- CreateIndex
CREATE INDEX "Company_status_idx" ON "Company"("status");

-- CreateIndex
CREATE INDEX "Company_status_priority_dateReceived_idx" ON "Company"("status", "priority", "dateReceived");

-- CreateIndex
CREATE INDEX "CompanyPerson_teamMemberId_role_idx" ON "CompanyPerson"("teamMemberId", "role");

-- CreateIndex
CREATE INDEX "Comment_companyId_createdAt_idx" ON "Comment"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");

-- CreateIndex
CREATE INDEX "File_companyId_uploadedAt_idx" ON "File"("companyId", "uploadedAt");

-- CreateIndex
CREATE INDEX "File_companyId_kind_idx" ON "File"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Summary_companyId_version_key" ON "Summary"("companyId", "version");

-- CreateIndex
CREATE INDEX "SummaryJob_status_createdAt_idx" ON "SummaryJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SummaryJob_companyId_status_idx" ON "SummaryJob"("companyId", "status");

-- CreateIndex
CREATE INDEX "Rejection_companyId_at_idx" ON "Rejection"("companyId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_at_idx" ON "AuditLog"("companyId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_field_at_idx" ON "AuditLog"("field", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_name_key" ON "Sector"("name");

-- CreateIndex
CREATE INDEX "Sector_sortOrder_idx" ON "Sector"("sortOrder");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_activeSummaryId_fkey" FOREIGN KEY ("activeSummaryId") REFERENCES "Summary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPerson" ADD CONSTRAINT "CompanyPerson_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPerson" ADD CONSTRAINT "CompanyPerson_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryJob" ADD CONSTRAINT "SummaryJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryJob" ADD CONSTRAINT "SummaryJob_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryJob" ADD CONSTRAINT "SummaryJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rejection" ADD CONSTRAINT "Rejection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rejection" ADD CONSTRAINT "Rejection_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionLog" ADD CONSTRAINT "DeletionLog_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Priority is 1-5 or null (SPEC §4)
ALTER TABLE "Company" ADD CONSTRAINT "Company_priority_check" CHECK (priority IS NULL OR priority BETWEEN 1 AND 5);
