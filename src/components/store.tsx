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

export type DrawerTab = "summary" | "materials" | "comments" | "history";

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
  setSectors: (s: SectorOption[]) => void;
  setPeMeta: (m: DashboardData["peMeta"]) => void;
  toast: (msg: string, action?: { label: string; run: () => void }) => void;
  openDrawer: (id: string, tab?: DrawerTab) => void;
  openAdd: () => void;
}

export const StoreCtx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}
