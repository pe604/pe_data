import type { FileKind, Stage, Status } from "./constants";
import type { Fund, Holding } from "./portfolio";

/** One table row. Serialisable; sent from server to client. */
export interface CompanyRow {
  id: string;
  name: string;
  sectorId: string | null;
  sector: string | null;
  subSector: string | null;
  stage: Stage;
  priority: number | null;
  status: Status;
  dateReceived: string | null;
  exitAt: string | null;
  exitStage: Stage | null;
  directInvested: boolean;
  /** Invested companies only: rounds total, current value, MOIC (SPEC §15). */
  holding: Holding | null;
  rejectReason: string | null;
  oneDriveUrl: string | null;
  pe: string[];
  research: string[];
  via: string[];
  latestComment: { text: string; author: string; at: string } | null;
  commentCount: number;
  /** Invested companies: newest company update (SPEC §15.4). */
  latestUpdate: { text: string; date: string; author: string } | null;
  updateCount: number;
  fileCount: number;
  /** All comment and update text, lower-cased, for search. */
  commentSearch: string;
}

export interface UpdateItem {
  id: string;
  date: string;
  text: string;
  author: string;
  source: "MANUAL" | "WHATSAPP" | "NEWS" | "LINKEDIN";
  createdAt: string;
  /** News agent (SPEC §15.10): the article or post, category key and importance. */
  url: string | null;
  category: string | null;
  importance: string | null;
}

export interface SectorOption {
  id: string;
  name: string;
}

export interface TeamMemberOption {
  id: string;
  name: string;
  /** Position in the PE team bar, or null when not shown there. */
  peRank: number | null;
  /** Name lists this person is in (see domain/team.ts). */
  inPe: boolean;
  inResearch: boolean;
  inVia: boolean;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "EDITOR";
}

export interface DashboardData {
  companies: CompanyRow[];
  sectors: SectorOption[];
  team: TeamMemberOption[];
  peMeta: { by: string; at: string } | null;
  me: Me;
  aiEnabled: boolean;
  maxUploadMb: number;
}

export interface FileItem {
  id: string;
  originalName: string;
  kind: FileKind;
  mime: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  /** MIS / result-note files: the quarter they are for (e.g. "FY27-Q2"). */
  quarter: string | null;
}

export interface SummaryItem {
  id: string;
  version: number;
  sourceFileName: string | null;
  markdown: string;
  edited: boolean;
  editedBy: string | null;
  editedAt: string | null;
  createdAt: string;
}

export interface CommentItem {
  id: string;
  text: string;
  author: string;
  authorId: string;
  createdAt: string;
  editedAt: string | null;
}

export interface HistoryItem {
  id: string;
  actor: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  at: string;
}

export interface JobItem {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  step: "READING" | "WRITING" | null;
  error: string | null;
  sourceFileName: string | null;
}

export interface CompanyDetail {
  row: CompanyRow;
  files: FileItem[];
  summaries: SummaryItem[];
  activeSummaryId: string | null;
  comments: CommentItem[];
  history: HistoryItem[];
  activeJob: JobItem | null;
  rounds: RoundItem[];
  contacts: ContactItem[];
}

// ─── Figures history (SPEC §15.11) ───────────────────────────────────────────

export type LineUnitKey = "INR_CR" | "PCT" | "NUM";
export type LineKindKey = "FLOW" | "STOCK" | "RATIO";

export interface MisCell {
  value: number;
  source: "MIS" | "RESULT" | "MANUAL" | "IMPORT";
  fileName: string | null;
  at: string;
}

/** A line item with its stored values by period key. */
export interface MisLineItem {
  id: string;
  section: string;
  label: string;
  unit: LineUnitKey;
  unitLabel: string | null;
  kind: LineKindKey;
  values: Record<string, MisCell>;
}

/** A row read from an MIS, for review before saving. Values are in stored units (₹ Cr, %, number). */
export interface MisDraftRowView {
  ref: string;
  section: string;
  label: string;
  unit: LineUnitKey;
  unitLabel: string | null;
  kind: LineKindKey;
  values: { period: string; value: number; raw: string }[];
  flags: string[];
  /** The existing line it matches, if any */
  matchId: string | null;
  /** Periods where a different value is already saved (stored units) */
  conflicts: { period: string; saved: number }[];
}

/** A background read of an MIS or result file (SPEC §15.11). */
export interface MisReadJobItem {
  id: string;
  fileId: string | null;
  fileName: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
  createdAt: string;
}

export interface MisReadView {
  fileName: string;
  format: "excel" | "pdf" | "image" | "paste";
  /** Where saved figures come from: an MIS file, a result note, or a pasted table */
  source: "MIS" | "RESULT" | "IMPORT";
  /** Pasted columns that weren't periods (paste only) */
  skipped: string[];
  periods: string[];
  rows: MisDraftRowView[];
  /** Existing lines, for merging a row into one */
  lines: { id: string; section: string; label: string; unit: LineUnitKey }[];
}

export interface RoundItem {
  id: string;
  date: string;
  fund: Fund | null;
  round: string | null;
  instrument: string | null;
  amount: number;
  preMoney: number | null;
  stakePct: number | null;
}

/** Quarterly tracker (SPEC §15): one row per Invested company for a quarter. Tick fields are the date done. */
export interface QuarterRow {
  companyId: string;
  name: string;
  pe: string[];
  /** Primary (else first) contact's name. */
  poc: string | null;
  /** Date received: the first MIS upload for the quarter. */
  misAt: string | null;
  /** Date made: the first result-note upload for the quarter. */
  resultNoteAt: string | null;
  misFiles: QuarterFile[];
  resultFiles: QuarterFile[];
  /** Other quarterly files (SHA, cap tables, …) */
  otherFiles: QuarterFile[];
  remarks: string | null;
}

export interface QuarterFile {
  id: string;
  name: string;
  mime: string;
  uploadedAt: string;
}

export interface ContactItem {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface QuarterView {
  quarter: string;
  misDue: string;
  misDueIsDefault: boolean;
  rows: QuarterRow[];
}

export interface MeetingItem {
  id: string;
  companyId: string;
  companyName: string;
  date: string;
  type: string;
  status: "PLANNED" | "DONE" | "CANCELLED";
  attendees: string[];
  notes: string | null;
  by: string;
}



export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };
