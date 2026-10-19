// Client-safe constants. Mirrors the Prisma enums (kept as string unions so client bundles
// don't import the generated client).

export const STAGES = [
  "NOT_ASSIGNED",
  "CALL_PENDING",
  "INTERNAL_DISCUSSION",
  "SCUTTLEBUTT",
  "ALLOCATION",
  "DUE_DILIGENCE",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  NOT_ASSIGNED: "Not Assigned",
  CALL_PENDING: "Call Pending",
  INTERNAL_DISCUSSION: "Internal Discussion",
  SCUTTLEBUTT: "Scuttlebutt",
  ALLOCATION: "Allocation",
  DUE_DILIGENCE: "Due Diligence",
};

export const stageIndex = (s: Stage | null | undefined) => (s ? STAGES.indexOf(s) : 0);

export const STATUSES = ["PIPELINE", "REJECTED", "INVESTED"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = {
  PIPELINE: "Pipeline",
  REJECTED: "Rejected",
  INVESTED: "Invested",
};

export const PERSON_ROLES = ["PE", "RESEARCH", "VIA"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

export const FILE_KINDS = ["DECK", "MODEL", "MIS", "RESULT_NOTE", "OTHER"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_KIND_LABELS: Record<FileKind, string> = {
  DECK: "Deck",
  MODEL: "Model",
  MIS: "MIS",
  RESULT_NOTE: "Result note",
  OTHER: "Other",
};
/** File types that belong to a quarter (uploaded from the quarterly tracker). */
export const QUARTER_FILE_KINDS = ["MIS", "RESULT_NOTE"] as const;
export type QuarterFileKind = (typeof QUARTER_FILE_KINDS)[number];

// Sector master list (SPEC §8). Added on app start if missing; existing names are never renamed (companies use them).
// Oct 2026: the firm's portfolio sector names, no overlapping pairs (older names such as Consumer & Retail, Power & T&D,
// Renewables & Climate and Electronics & EMS were merged into these).
export const SEED_SECTORS = [
  "Agri & Food",
  "AI & Deep Tech",
  "Automotive Component",
  "Building Materials",
  "Business Services & Staffing",
  "Chemicals & Materials",
  "Consumer",
  "Consumer Internet & E-commerce",
  "Defence, Aerospace & Drones",
  "Education",
  "Electronics & Semiconductors",
  "Energy Transition",
  "EV & Charging",
  "Financial Services & Fintech",
  "Healthcare & Pharma",
  "Industrial Products",
  "Infrastructure & EPC",
  "IT Services & BPM",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Media & Entertainment",
  "MedTech & Diagnostics",
  "Metals & Mining",
  "Packaging",
  "Real Estate & Hospitality",
  "Recycling",
  "Space Tech",
  "Technology & SaaS",
  "Telecom & Data Centres",
  "Water Infrastructure",
  "Other",
];

/** Labels for AuditLog `field` values, used by the History tab. */
export const FIELD_LABELS: Record<string, string> = {
  name: "Company",
  sector: "Sector",
  subSector: "Sub-sector",
  stage: "Stage",
  priority: "Priority",
  pe: "Assigned PE",
  research: "Assigned Research",
  via: "Via",
  dateReceived: "Date received",
  amountInvested: "Amount invested",
  oneDriveUrl: "OneDrive link",
  status: "Status",
  peTeam: "PE team order",
};

export const ROLE_FIELD: Record<PersonRole, "pe" | "research" | "via"> = {
  PE: "pe",
  RESEARCH: "research",
  VIA: "via",
};
