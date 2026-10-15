-- MIS reader: an MIS file type and quarterly financials per portfolio company (INR crore).
ALTER TYPE "FileKind" ADD VALUE 'MIS';

CREATE TABLE "MisFigure" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "revenue" DECIMAL(16,2),
    "ebitda" DECIMAL(16,2),
    "pat" DECIMAL(16,2),
    "cash" DECIMAL(16,2),
    "note" TEXT,
    "sourceFileId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MisFigure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MisFigure_companyId_quarter_key" ON "MisFigure"("companyId", "quarter");
ALTER TABLE "MisFigure" ADD CONSTRAINT "MisFigure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MisFigure" ADD CONSTRAINT "MisFigure_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MisFigure" ADD CONSTRAINT "MisFigure_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
