"use client";

import { ToastProvider } from "../ui/toast";
import { FundingView } from "./FundingView";

/** The funding-only deployment (APP_MODE=funding, SPEC §15.16): the Funding tab on its own, read-only. */
export function FundingApp() {
  return (
    <ToastProvider>
      <div id="app">
        <header className="top">
          <div className="brand">
            <span className="wm">Niveshaay</span>
            <span className="app">Funding tracker</span>
          </div>
        </header>
        <FundingView />
      </div>
    </ToastProvider>
  );
}
