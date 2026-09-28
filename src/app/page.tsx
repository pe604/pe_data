import { redirect } from "next/navigation";
import { Dashboard } from "@/components/Dashboard";
import { currentUser } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/server/company";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const me = await currentUser();
  if (!me) redirect("/signin");
  const [data, sp] = await Promise.all([loadDashboard(me), searchParams]);
  const query = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])),
  ).toString();
  return <Dashboard initial={data} query={query} />;
}
