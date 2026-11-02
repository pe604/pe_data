-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sector" TEXT,
    "organiser" TEXT,
    "city" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "dateNote" TEXT,
    "datesConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'WORTH_A_LOOK',
    "why" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "attendees" TEXT[],
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeen" (
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSeen_pkey" PRIMARY KEY ("url")
);

-- CreateIndex
CREATE INDEX "Event_startDate_idx" ON "Event"("startDate");
