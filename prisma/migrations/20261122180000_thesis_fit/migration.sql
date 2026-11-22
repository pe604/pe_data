-- Thesis and fit rating (SPEC §17): thesis rows and versions, fit ratings, people's inputs, rating jobs; theme on companies
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "activeFitId" TEXT,
ADD COLUMN     "themeCode" TEXT,
ADD COLUMN     "themeEdited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ThesisRow" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "evidence" TEXT,
    "decision" TEXT,
    "fromVersion" INTEGER NOT NULL,
    "toVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThesisRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThesisVersion" (
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'IMPORT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThesisVersion_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "FitRating" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "summaryId" TEXT,
    "sourceFileName" TEXT,
    "thesisVersion" INTEGER NOT NULL,
    "themeCode" TEXT,
    "fit" DECIMAL(3,1),
    "promise" DECIMAL(3,1),
    "fitScored" INTEGER NOT NULL,
    "fitTotal" INTEGER NOT NULL,
    "promiseScored" INTEGER NOT NULL,
    "promiseTotal" INTEGER NOT NULL,
    "facts" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "flags" JSONB NOT NULL,
    "highlights" JSONB NOT NULL,
    "unchecked" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitInput" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "FitJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThesisRow_kind_toVersion_idx" ON "ThesisRow"("kind", "toVersion");

-- CreateIndex
CREATE INDEX "ThesisRow_code_fromVersion_idx" ON "ThesisRow"("code", "fromVersion");

-- CreateIndex
CREATE INDEX "FitRating_companyId_createdAt_idx" ON "FitRating"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FitInput_companyId_code_key" ON "FitInput"("companyId", "code");

-- CreateIndex
CREATE INDEX "FitJob_status_createdAt_idx" ON "FitJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FitJob_companyId_status_idx" ON "FitJob"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Company_activeFitId_key" ON "Company"("activeFitId");

-- CreateIndex
CREATE INDEX "Company_themeCode_idx" ON "Company"("themeCode");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_activeFitId_fkey" FOREIGN KEY ("activeFitId") REFERENCES "FitRating"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitRating" ADD CONSTRAINT "FitRating_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitInput" ADD CONSTRAINT "FitInput_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitInput" ADD CONSTRAINT "FitInput_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitJob" ADD CONSTRAINT "FitJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
