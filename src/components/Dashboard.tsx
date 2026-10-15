"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDashboard } from "@/actions/companies";
import { addNamesToTeam, namePools } from "@/lib/domain/team";
import type { CompanyRow, DashboardData } from "@/lib/domain/types";
import {
  DEFAULT_SORT,
  SET_KEYS,
  TAB_STATUS,
  filtersForTab,
  queryToView,
  sortsForTab,
  viewToQuery,
  type Tab,
  type ViewState,
} from "@/lib/domain/view";
import { AddCompanyModal } from "./add/AddCompanyModal";
import { PeBar, StagesBar } from "./bars/Bars";
import { PortfolioBar } from "./bars/PortfolioBar";
import { MeetingsView } from "./portfolio/MeetingsView";
import { QuarterlyTracker } from "./portfolio/QuarterlyTracker";
import { Drawer } from "./drawer/Drawer";
import { Header } from "./shell/Header";
import { StoreCtx, type DrawerTab, type Store } from "./store";
import { DealTable } from "./table/DealTable";
import { Toolbar } from "./toolbar/Toolbar";
import { ToastProvider, useToast } from "./ui/toast";

export function Dashboard({ initial, query }: { initial: DashboardData; query: string }) {
  return (
    <ToastProvider>
      <Inner initial={initial} query={query} />
    </ToastProvider>
  );
}

function Inner({ initial, query }: { initial: DashboardData; query: string }) {
  const toast = useToast();
  const [companies, setCompanies] = useState(initial.companies);
  const [sectors, setSectors] = useState(initial.sectors);
  const [team, setTeam] = useState(initial.team);
  const [peMeta, setPeMeta] = useState(initial.peMeta);
  const [view, setView] = useState<ViewState>(() => queryToView(query));
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("summary");
  const [addOpen, setAddOpen] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  // Invested tab sub-view (SPEC §15).
  const [invView, setInvView] = useState<"portfolio" | "quarterly" | "meetings">("portfolio");

  const rowsRef = useRef(companies);
  useEffect(() => {
    rowsRef.current = companies;
  }, [companies]);
  const pending = useRef(0);

  // Keep filters and sort in the URL so a view can be shared.
  useEffect(() => {
    const q = viewToQuery(view);
    if (q !== window.location.search) window.history.replaceState(null, "", window.location.pathname + q);
  }, [view]);

  const syncRow = useCallback((row: CompanyRow) => {
    setCompanies((list) => {
      const i = list.findIndex((c) => c.id === row.id);
      if (i < 0) return [...list, row];
      const next = list.slice();
      next[i] = row;
      return next;
    });
  }, []);

  const putRow = useCallback(
    (row: CompanyRow) => {
      syncRow(row);
      setDetailVersion((v) => v + 1);
    },
    [syncRow],
  );

  const removeRow = useCallback((id: string) => {
    setCompanies((list) => list.filter((c) => c.id !== id));
  }, []);

  const addTeamNames = useCallback<Store["addTeamNames"]>((names, role, previous) => {
    if (names.length) setTeam((t) => addNamesToTeam(t, names, role, previous));
  }, []);

  const mutate = useCallback<Store["mutate"]>(
    async (id, patch, call) => {
      const before = rowsRef.current.find((c) => c.id === id);
      if (!before) return null;
      setCompanies((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      pending.current++;
      try {
        const r = await call();
        if (r.ok) {
          putRow(r.data);
          return r.data;
        }
        setCompanies((list) => list.map((c) => (c.id === id ? before : c)));
        toast(r.error);
        return null;
      } catch {
        setCompanies((list) => list.map((c) => (c.id === id ? before : c)));
        toast("Could not save that change. Check your connection and try again.");
        return null;
      } finally {
        pending.current--;
      }
    },
    [putRow, toast],
  );

  const openDrawer = useCallback((id: string, tab?: DrawerTab) => {
    setOpenId(id);
    if (tab) setDrawerTab(tab);
  }, []);

  // Pick up other people's changes every minute (skipped while a save is in flight).
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden || pending.current > 0) return;
      const r = await getDashboard().catch(() => null);
      if (!r?.ok || pending.current > 0) return;
      setCompanies(r.data.companies);
      setTeam(r.data.team);
      setSectors(r.data.sectors);
      setPeMeta(r.data.peMeta);
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const store: Store = useMemo(
    () => ({
      me: initial.me,
      companies,
      sectors,
      team,
      pools: namePools(team),
      peMeta,
      aiEnabled: initial.aiEnabled,
      maxUploadMb: initial.maxUploadMb,
      detailVersion,
      getRow: (id) => rowsRef.current.find((c) => c.id === id),
      putRow,
      syncRow,
      removeRow,
      mutate,
      addTeamNames,
      setTeam,
      setSectors,
      setPeMeta,
      toast,
      openDrawer,
      openAdd: () => setAddOpen(true),
    }),
    [initial, companies, sectors, team, peMeta, detailVersion, putRow, syncRow, removeRow, mutate, addTeamNames, toast, openDrawer],
  );

  const setTab = (tab: Tab) => {
    setView((v) => {
      // Filters and sorts a tab doesn't show must not keep applying there (Invested hides Priority, Stage, Via).
      const shown = filtersForTab(tab);
      const f = { ...v.f, stage: [] as string[] };
      for (const k of SET_KEYS) if (!shown.includes(k)) f[k] = [];
      const sorts = sortsForTab(tab).map(([k]) => k);
      const sort = sorts.includes(v.sort) ? v.sort : tab === "invested" ? "amount-high" : DEFAULT_SORT;
      return { ...v, tab, f, sort };
    });
  };

  const inTab = useMemo(() => companies.filter((c) => c.status === TAB_STATUS[view.tab]), [companies, view.tab]);
  const counts = useMemo(
    () => ({
      pipeline: companies.filter((c) => c.status === "PIPELINE").length,
      rejected: companies.filter((c) => c.status === "REJECTED").length,
      invested: companies.filter((c) => c.status === "INVESTED").length,
    }),
    [companies],
  );
  const showBars = view.tab === "pipeline" && counts.pipeline > 0;

  return (
    <StoreCtx.Provider value={store}>
      <div id="app">
        <Header />
        <nav className="tabs" role="tablist" aria-label="Lists">
          {(
            [
              ["pipeline", "Pipeline"],
              ["rejected", "Rejected"],
              ["invested", "Invested"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className="tab" role="tab" type="button" aria-selected={view.tab === k} onClick={() => setTab(k)}>
              {l}
              <span className="n">{counts[k]}</span>
            </button>
          ))}
        </nav>
        {showBars && (
          <>
            <StagesBar rows={inTab} view={view} setView={setView} />
            <PeBar rows={inTab} view={view} setView={setView} />
          </>
        )}
        {view.tab === "invested" && counts.invested > 0 && (
          <div className="seg-switch" role="tablist" aria-label="Invested views">
            {(
              [
                ["portfolio", "Portfolio"],
                ["quarterly", "Quarterly tracker"],
                ["meetings", "Meetings"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={invView === k} onClick={() => setInvView(k)}>
                {l}
              </button>
            ))}
          </div>
        )}
        {view.tab === "invested" && counts.invested > 0 && invView === "quarterly" ? (
          <QuarterlyTracker />
        ) : view.tab === "invested" && counts.invested > 0 && invView === "meetings" ? (
          <MeetingsView companies={inTab} />
        ) : (
          <>
            {view.tab === "invested" && counts.invested > 0 && <PortfolioBar rows={inTab} view={view} />}
            <Toolbar rows={inTab} view={view} setView={setView} />
            <DealTable rows={inTab} view={view} setView={setView} openId={openId} />
          </>
        )}
      </div>
      <Drawer
        openId={openId}
        tab={drawerTab}
        setTab={setDrawerTab}
        onClose={() => setOpenId(null)}
      />
      {addOpen && (
        <AddCompanyModal
          initialTarget={view.tab === "invested" ? "invested" : "pipeline"}
          openRejectedBulk={view.tab === "rejected"}
          onClose={() => setAddOpen(false)}
          onAdded={(target) => setView((v) => ({ ...v, tab: target }))}
        />
      )}
    </StoreCtx.Provider>
  );
}
