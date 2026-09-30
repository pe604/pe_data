"use client";

// Friendly error page. The error's details stay in the server logs, never on screen.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="signin">
      <div className="signin-card">
        <div className="brand">
          <span className="wm">Niveshaay</span>
          <span className="app">Deal pipeline</span>
        </div>
        <p className="muted">Something went wrong loading the pipeline. Try again, and if it keeps happening, reload the page.</p>
        <button className="btn primary signin-btn" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
