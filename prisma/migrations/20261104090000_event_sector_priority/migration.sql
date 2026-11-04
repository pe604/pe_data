-- Events: top priority sectors get every major show; the rest only their flagship event (SPEC §15.14, 2026-11-04)
ALTER TABLE "EventSector" ADD COLUMN "priority" BOOLEAN NOT NULL DEFAULT false;

UPDATE "EventSector" SET "priority" = true WHERE "name" IN (
  'Data centres and digital infrastructure',
  'AI and software',
  'Semiconductors and electronics',
  'Defence and aerospace',
  'Space',
  'Healthcare and life sciences'
);

-- Searches aimed at what the team cares about in these sectors
UPDATE "EventSector" SET "query" = 'India data centre OR datacenter OR "AI infrastructure" summit OR convention OR expo'
  WHERE "name" = 'Data centres and digital infrastructure';
UPDATE "EventSector" SET "query" = 'India pharma CDMO OR CRDMO OR biotech OR "drug discovery" summit OR conference OR expo'
  WHERE "name" = 'Healthcare and life sciences';
UPDATE "EventSector" SET "keywords" = array_cat("keywords", ARRAY['cdmo', 'crdmo', 'cphi', 'api', 'drug'])
  WHERE "name" = 'Healthcare and life sciences';
UPDATE "EventSector" SET "keywords" = array_cat("keywords", ARRAY['gpu', 'hyperscale'])
  WHERE "name" = 'Data centres and digital infrastructure';
