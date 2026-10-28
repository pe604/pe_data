-- Results generator phase B (SPEC §15.12): one result format per company.

-- CreateTable
CREATE TABLE "ResultFormat" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResultFormat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResultFormat_companyId_key" ON "ResultFormat"("companyId");

-- AddForeignKey
ALTER TABLE "ResultFormat" ADD CONSTRAINT "ResultFormat_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultFormat" ADD CONSTRAINT "ResultFormat_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
