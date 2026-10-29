"use client";

import { createContext, useContext } from "react";
import type { PersonRole } from "@/lib/domain/constants";
import type {
  ActionResult,
  CompanyRow,
  DashboardData,
  Me,
  SectorOption,
  TeamMemberOption,
} from "@/lib/domain/types";

/**
 * Company file tabs. Pipeline/Rejected: summary · materials · comments · history.
 * Invested (SPEC §15.5): overview · numbers · updates · files (MIS files sit in Numbers, meetings in Updates, the deck
 * summary, comments and history in Files). "mis" and "meetings" are kept as aliases for links into those sections.
 * `normaliseTab` maps a tab to the equivalent one for the company's status.
 */
export type DrawerTab = "summary" | "materials" | "comments" | "history" | "overview" | "numbers" | "mis" | "updates" | "meetings" | "files";

export function normaliseTab(tab: DrawerTab, invested: boolean): DrawerTab {
  if (invested) {
    if (tab === "summary" || tab === "materials" || tab === "comments" || tab === "history") return "files";
    if (tab === "mis") return "numbers";
    if (tab === "meetings") return "updates";
    return tab;
  }
  if (tab === "files") return "materials";
  if (tab === "overview" || tab === "numbers" || tab === "mis" || tab === "updates" || tab === "meetings") return "summary";
  return tab;
}

export interface Store {
  me: Me;
  companies: CompanyRow[];
  sectors: SectorOption[];
  team: TeamMemberOption[];
  /** Autofill names per field (PE and Research separate; Via = PE + Via names). */
  pools: Record<PersonRole, string[]>;
  peMeta: DashboardData["peMeta"];
  aiEnabled: boolean;
  maxUploadMb: number;
  /** Bumps whenever a company changes, so the open drawer refetches its detail. */
  detailVersion: number;

  getRow: (id: string) => CompanyRow | undefined;
  /** Replace or insert a row from the server. */
  putRow: (row: CompanyRow) => void;
  /** Like putRow but doesn't bump detailVersion (used by the drawer after it fetched detail). */
  syncRow: (row: CompanyRow) => void;
  removeRow: (id: string) => void;
  /**
   * Optimistic update: applies `patch` now, runs `call`, then replaces the row with the
   * server's version, or rolls back and shows a toast on failure.
   */
  mutate: (
    id: string,
    patch: Partial<CompanyRow>,
    call: () => Promise<ActionResult<CompanyRow>>,
  ) => Promise<CompanyRow | null>;
  /** Optimistically add names to a field's list (and new PE names to the PE team bar). */
  addTeamNames: (names: string[], role: PersonRole, previous?: string[]) => void;
  setTeam: (team: TeamMemberOption[]) => void;
  /** Reload every row, the team and sectors from the server (after a change that touches many companies). */
  refresh: () => Promise<void>;
  setSectors: (s: SectorOption[]) => void;
  setPeMeta: (m: DashboardData["peMeta"]) => void;
  toast: (msg: string, action?: { label: string; run: () => void }) => void;
  openDrawer: (id: string, tab?: DrawerTab) => void;
  /** Invested → Results on this company (closes the company file). */
  openResults: (companyId: string) => void;
  openAdd: () => void;
}

export const StoreCtx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}
