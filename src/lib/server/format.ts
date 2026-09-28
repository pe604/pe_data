import { STAGE_LABELS, STATUS_LABELS, type Stage, type Status } from "@/lib/domain/constants";
import { fmtDate } from "@/lib/domain/dates";

// Display strings stored in AuditLog from/to.
export const fmtPriority = (p: number | null) => (p ? "P" + p : null);
export const fmtStage = (s: Stage | null) => (s ? STAGE_LABELS[s] : null);
export const fmtStatus = (s: Status) => STATUS_LABELS[s];
export const fmtDay = (iso: string | null) => (iso ? fmtDate(iso) : null);
