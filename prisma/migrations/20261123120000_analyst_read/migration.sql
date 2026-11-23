-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "activeReadId" TEXT;

-- AlterTable
ALTER TABLE "FitInput" ALTER COLUMN "score" SET DATA TYPE DECIMAL(3,1);

-- CreateTable
CREATE TABLE "AnalystRead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "thesisVersion" INTEGER NOT NULL,
    "overall" DECIMAL(3,1) NOT NULL,
    "confidence" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "readAt" DATE NOT NULL,
    "author" TEXT NOT NULL,
    "loadedById" TEXT NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalystRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalystRead_companyId_loadedAt_idx" ON "AnalystRead"("companyId", "loadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalystRead_companyId_hash_key" ON "AnalystRead"("companyId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "Company_activeReadId_key" ON "Company"("activeReadId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_activeReadId_fkey" FOREIGN KEY ("activeReadId") REFERENCES "AnalystRead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalystRead" ADD CONSTRAINT "AnalystRead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalystRead" ADD CONSTRAINT "AnalystRead_loadedById_fkey" FOREIGN KEY ("loadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
