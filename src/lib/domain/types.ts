import type { FileKind, Stage, Status } from "./constants";
import type { Holding } from "./portfolio";

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
  fileCount: number;
  /** All comment text, lower-cased, for search. */
  commentSearch: string;
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
  marks: MarkItem[];
  /** Quarterly financials from MIS, oldest quarter first (₹ Cr). */
  mis: MisItem[];
}

export interface MisItem {
  quarter: string;
  revenue: number | null;
  ebitda: number | null;
  pat: number | null;
  cash: number | null;
  note: string | null;
  sourceFileId: string | null;
  sourceFileName: string | null;
}

/** What the MIS reader found, for review before saving (₹ Cr). */
export interface MisReadResult {
  revenue: number | null;
  ebitda: number | null;
  pat: number | null;
  cash: number | null;
  unit: string | null;
  source: Record<"revenue" | "ebitda" | "pat", "quarter" | "months" | null>;
  /** Figures the model gave that aren't in the file's text: check these. */
  unmatched: string[];
}

export interface RoundItem {
  id: string;
  date: string;
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
  misAt: string | null;
  resultNoteAt: string | null;
  resultUpdateAt: string | null;
  bdoAt: string | null;
  remarks: string | null;
  /** Meetings in the results period, e.g. "1 done · 1 planned". */
  meetings: string | null;
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

export interface MarkItem {
  id: string;
  date: string;
  valuation: number;
  stakePct: number;
  source: string;
  note: string | null;
  by: string;
}

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };
