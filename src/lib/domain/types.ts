import type { FileKind, Stage, Status } from "./constants";

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
  peRank: number | null;
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
}

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };
