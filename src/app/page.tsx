import { Dashboard } from "@/components/Dashboard";
import { FundingApp } from "@/components/funding/FundingApp";
import { fundingOnly } from "@/lib/env";
import { requireRole } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/server/company";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  // The funding-only deployment shows the funding tracker and nothing else (no dashboard data is loaded).
  if (fundingOnly) return <FundingApp />;
  const me = await requireRole();
  const [data, sp] = await Promise.all([loadDashboard(me), searchParams]);
  const query = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])),
  ).toString();
  return <Dashboard initial={data} query={query} />;
}
