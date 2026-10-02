-- Separate name lists for Assigned PE, Assigned Research and Via (Via suggests PE + Via names).
ALTER TABLE "TeamMember"
  ADD COLUMN "inPe" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inResearch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inVia" BOOLEAN NOT NULL DEFAULT false;

-- Existing names go to the lists they have been used in.
UPDATE "TeamMember" t SET "inPe" = true
WHERE t."peRank" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "CompanyPerson" p WHERE p."teamMemberId" = t.id AND p.role = 'PE');

UPDATE "TeamMember" t SET "inResearch" = true
WHERE EXISTS (SELECT 1 FROM "CompanyPerson" p WHERE p."teamMemberId" = t.id AND p.role = 'RESEARCH');

UPDATE "TeamMember" t SET "inVia" = true
WHERE t."whatsappNumber" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "CompanyPerson" p WHERE p."teamMemberId" = t.id AND p.role = 'VIA');

-- Names not used anywhere yet (e.g. added once, then unassigned) stay suggestible as PE and Via.
UPDATE "TeamMember" SET "inPe" = true, "inVia" = true
WHERE NOT "inPe" AND NOT "inResearch" AND NOT "inVia";

-- Every name assigned as PE on a company joins the PE team bar (after the current order, alphabetically).
WITH base AS (SELECT COALESCE(MAX("peRank"), -1) AS mx FROM "TeamMember"),
     missing AS (
       SELECT t.id, ROW_NUMBER() OVER (ORDER BY t.name) AS rn
       FROM "TeamMember" t
       WHERE t."peRank" IS NULL
         AND EXISTS (SELECT 1 FROM "CompanyPerson" p WHERE p."teamMemberId" = t.id AND p.role = 'PE')
     )
UPDATE "TeamMember" t SET "peRank" = base.mx + missing.rn
FROM base, missing
WHERE t.id = missing.id;
