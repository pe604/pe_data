-- Figures history for the results generator (SPEC 15.11): line items per company and their values by period.
CREATE TABLE "MisLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL,
    "unitLabel" TEXT,
    "kind" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "aliases" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MisLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MisLine_unit_check" CHECK ("unit" IN ('INR_CR', 'PCT', 'NUM')),
    CONSTRAINT "MisLine_kind_check" CHECK ("kind" IN ('FLOW', 'STOCK', 'RATIO'))
);
CREATE UNIQUE INDEX "MisLine_companyId_section_key_key" ON "MisLine"("companyId", "section", "key");
CREATE INDEX "MisLine_companyId_sortOrder_idx" ON "MisLine"("companyId", "sortOrder");
ALTER TABLE "MisLine" ADD CONSTRAINT "MisLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MisValue" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" DECIMAL(24,6) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceFileId" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MisValue_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MisValue_source_check" CHECK ("source" IN ('MIS', 'RESULT', 'MANUAL', 'IMPORT'))
);
CREATE UNIQUE INDEX "MisValue_lineId_period_key" ON "MisValue"("lineId", "period");
ALTER TABLE "MisValue" ADD CONSTRAINT "MisValue_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "MisLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MisValue" ADD CONSTRAINT "MisValue_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MisValue" ADD CONSTRAINT "MisValue_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry the earlier quarter-only figures (MisFigure) into the history. MisFigure is kept, no longer used.
INSERT INTO "MisLine" ("id", "companyId", "label", "key", "section", "unit", "kind", "sortOrder", "aliases", "updatedAt")
SELECT gen_random_uuid()::text, f."companyId", l."label", l."key", l."section", 'INR_CR', l."kind", l."ord", '{}', CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "companyId" FROM "MisFigure") f
CROSS JOIN (VALUES
    ('Revenue', 'revenue', 'P&L', 'FLOW', 0, 'revenue'),
    ('EBITDA', 'ebitda', 'P&L', 'FLOW', 1, 'ebitda'),
    ('PAT', 'pat', 'P&L', 'FLOW', 2, 'pat'),
    ('Cash and bank', 'cash and bank', 'Key metrics', 'STOCK', 3, 'cash')
) AS l("label", "key", "section", "kind", "ord", "col")
WHERE EXISTS (
    SELECT 1 FROM "MisFigure" m
    WHERE m."companyId" = f."companyId"
      AND CASE l."col" WHEN 'revenue' THEN m."revenue" WHEN 'ebitda' THEN m."ebitda" WHEN 'pat' THEN m."pat" ELSE m."cash" END IS NOT NULL
);

INSERT INTO "MisValue" ("id", "lineId", "period", "value", "source", "sourceFileId", "updatedById", "updatedAt")
SELECT gen_random_uuid()::text, ln."id", m."quarter", v."val",
       CASE WHEN m."sourceFileId" IS NULL THEN 'MANUAL' ELSE 'MIS' END, m."sourceFileId", m."createdById", CURRENT_TIMESTAMP
FROM "MisFigure" m
CROSS JOIN LATERAL (VALUES ('revenue', m."revenue"), ('ebitda', m."ebitda"), ('pat', m."pat"), ('cash and bank', m."cash")) AS v("key", "val")
JOIN "MisLine" ln ON ln."companyId" = m."companyId" AND ln."key" = v."key"
WHERE v."val" IS NOT NULL;
