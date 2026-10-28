-- MIS reads run in the background (SPEC §15.11): one row per read of an MIS or result file.

-- CreateTable
CREATE TABLE "MisReadJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "result" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "MisReadJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MisReadJob_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CLOSED'))
);

-- CreateIndex
CREATE INDEX "MisReadJob_status_createdAt_idx" ON "MisReadJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MisReadJob_companyId_createdAt_idx" ON "MisReadJob"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "MisReadJob" ADD CONSTRAINT "MisReadJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisReadJob" ADD CONSTRAINT "MisReadJob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisReadJob" ADD CONSTRAINT "MisReadJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
