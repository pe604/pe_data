"use server";

// Portfolio news agent (SPEC §15.10): a company's news watch, and "Check now".
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { normaliseLinkedinUrl, normaliseWebsite } from "@/lib/domain/news";
import { aiConfigured, apifyConfigured, whatsappConfigured } from "@/lib/env";
import { run, UserError } from "@/lib/server/action";
import { audit } from "@/lib/server/company";
import { checkNews, sendInstant } from "@/lib/news/agent";

const id = z.string().min(1).max(40);

export interface NewsWatchView {
  names: string[];
  website: string | null;
  linkedinUrl: string | null;
  enabled: boolean;
  /** Not saved yet: the agent searches the dashboard name. */
  isDefault: boolean;
  lastCheckedAt: string | null;
  seen: number;
  material: number;
  ai: boolean;
  linkedin: boolean;
  whatsapp: boolean;
}

async function invested(companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { name: true, status: true } });
  if (!c) throw new UserError("That company no longer exists. Reload the page.");
  if (c.status !== "INVESTED") throw new UserError("The news agent only watches companies in Invested.");
  return c;
}

async function view(companyId: string, name: string): Promise<NewsWatchView> {
  const [w, seen, material] = await Promise.all([
    db.newsWatch.findUnique({ where: { companyId } }),
    db.newsItem.count({ where: { companyId } }),
    db.newsItem.count({ where: { companyId, verdict: "MATERIAL" } }),
  ]);
  return {
    names: w?.names.length ? w.names : [name],
    website: w?.website ?? null,
    linkedinUrl: w?.linkedinUrl ?? null,
    enabled: w?.enabled ?? true,
    isDefault: !w,
    lastCheckedAt: w?.lastCheckedAt?.toISOString() ?? null,
    seen,
    material,
    ai: aiConfigured,
    linkedin: apifyConfigured,
    whatsapp: whatsappConfigured,
  };
}

export async function getNewsWatch(companyId: string) {
  return run<NewsWatchView>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const c = await invested(cid);
    return view(cid, c.name);
  });
}

const watchInput = z.object({
  names: z.array(z.string().trim().min(1).max(120)).min(1, "Add at least one name to search for").max(8),
  website: z.string().trim().max(300),
  linkedinUrl: z.string().trim().max(300),
  enabled: z.boolean(),
});

export async function saveNewsWatch(companyId: string, input: z.input<typeof watchInput>) {
  return run<NewsWatchView>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    let p;
    try {
      p = watchInput.parse(input);
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues[0]?.message : undefined;
      throw msg?.startsWith("Add at least") ? new UserError(msg) : e;
    }
    const c = await invested(cid);
    const website = p.website ? normaliseWebsite(p.website) : null;
    if (p.website && !website) throw new UserError("Enter the website like example.com.");
    const linkedinUrl = p.linkedinUrl ? normaliseLinkedinUrl(p.linkedinUrl) : null;
    if (p.linkedinUrl && !linkedinUrl) throw new UserError("Enter the LinkedIn company page, like linkedin.com/company/example.");
    const names = [...new Set(p.names.map((n) => n.replace(/\s+/g, " ")))];
    await db.$transaction(async (tx) => {
      await tx.newsWatch.upsert({
        where: { companyId: cid },
        create: { companyId: cid, names, website, linkedinUrl, enabled: p.enabled },
        update: { names, website, linkedinUrl, enabled: p.enabled },
      });
      await audit(tx, cid, me.id, [{ note: `Updated the news watch${p.enabled ? "" : " (turned off)"}` }]);
    });
    return view(cid, c.name);
  });
}

/** Runs the news agent for one company now: last 7 days of news and LinkedIn posts, instant alerts for big news. */
export async function checkNewsNow(companyId: string) {
  return run<{ watch: NewsWatchView; judged: number; added: number; alerted: number }>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const c = await invested(cid);
    if (!aiConfigured) throw new UserError("The news agent needs the AI key (OPENROUTER_API_KEY) to judge what's material.");
    const r = await checkNews({ companyIds: [cid], newsDays: 7, linkedinSinceMs: Date.now() - 7 * 86_400_000 });
    if (r.failed && !r.seen) throw new UserError("Couldn't check the news right now. Try again in a few minutes.");
    const alerted = await sendInstant(r.material);
    return { watch: await view(cid, c.name), judged: r.seen, added: r.material.length, alerted };
  });
}
