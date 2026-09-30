import Link from "next/link";

export default function NotFound() {
  return (
    <main className="signin">
      <div className="signin-card">
        <div className="brand">
          <span className="wm">Niveshaay</span>
          <span className="app">Deal pipeline</span>
        </div>
        <p className="muted">This page doesn’t exist.</p>
        <Link className="btn primary signin-btn" href="/">
          Go to the pipeline
        </Link>
      </div>
    </main>
  );
}
