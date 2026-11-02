-- CreateTable
CREATE TABLE "EventSector" (
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "query" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'STARTER',
    "why" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSector_pkey" PRIMARY KEY ("name")
);
