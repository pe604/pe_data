import "server-only";
import { db, type Tx } from "@/lib/db";
import { prepareDeck } from "@/lib/ai/deck";
import { AiError, aiProvider } from "@/lib/ai/provider";
import type { SummaryOutput } from "@/lib/ai/schema";
import { STAGE_LABELS, type Stage } from "@/lib/domain/constants";
import { fmtDate } from "@/lib/domain/dates";
import { factsZ, flagRowZ, highlightRowZ, type Facts } from "@/lib/domain/fit";
import { isDuplicateName } from "@/lib/domain/names";
import { themeByCode } from "@/lib/domain/thesis";
import { aiModel, fitModel } from "@/lib/env";
import { audit } from "@/lib/server/company";
import { currentThesis } from "@/lib/server/thesis";
import { storage } from "@/lib/storage";
import { unverifiedFigures } from "@/lib/summary/verify";
import { rate } from "./rate";
import type { Prisma } from "@/generated/prisma/client";

// Background fit rating jobs (SPEC §17.11), built like the summary worker (src/lib/ai/jobs.ts): claimed with
// FOR UPDATE SKIP LOCKED, a heartbeat, three attempts, stale after 5 minutes, two at a time.
// Never log deck text, quotes or scores: ids and error codes only.

const STALE_MS = 5 * 60_000;
const MAX_PARALLEL = 2;
export type FitReason = "DECK" | "MANUAL" | "THESIS";

/**
 * Queues a rating unless the company already has one queued or running (one open job per company).
 * Returns the open job's id either way.
 */
export async function queueFitJob(companyId: string, reason: FitReason, tx: Tx | typeof db = db): Promise<string> {
  const open = await tx.fitJob.findFirst({ where: { companyId, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (open) return open.id;
  return (await tx.fitJob.create({ data: { companyId, reason } })).id;
}

/** The deck a rating reads: the one the active summary came from, else the newest deck. */
async function deckFile(companyId: string, summaryFileId: string | null) {
  const own = summaryFileId ? await db.file.findFirst({ where: { id: summaryFileId, companyId, kind: "DECK" } }) : null;
  return own ?? (await db.file.findFirst({ where: { companyId, kind: "DECK" }, orderBy: { uploadedAt: "desc" } }));
}

/** FL16 from an earlier rating, for a THESIS re-rate that does not read the deck again. */
const unverifiedFrom = (flags: unknown): number => {
  const list = flagRowZ.array().safeParse(flags);
  const v = list.success ? list.data.find((f) => f.code === "FL16")?.value : undefined;
  return v ? Number(/^\d+/.exec(v)?.[0] ?? 0) : 0;
};

function friendly(e: unknown): string {
  if (e instanceof AiError && (e.code === "not_configured" || e.code === "no_credits" || e.code === "blocked")) return e.message;
  const m = (e as Error)?.message;
  if (m === "no_deck") return "Upload a deck to get a rating.";
  if (m === "no_thesis") return "No thesis is loaded yet.";
  if (m === "no_text" || m === "bad_type") return "This deck could not be read. Upload a PDF or PowerPoint deck.";
  const status = (e as { status?: number })?.status;
  if (status === 429) return "The AI service is busy right now. Try again in a minute.";
  if (status === 413 || status === 400) return "This deck could not be read. It may be too large, scanned or password-protected.";
  return "The rating could not be worked out. Try again.";
}

async function processJob(jobId: string) {
  const ctl = new AbortController();
  const watch = setInterval(async () => {
    try {
      await db.fitJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date() } });
    } catch {
      /* ignore */
    }
  }, 2000);
  try {
    const job = await db.fitJob.findUniqueOrThrow({ where: { id: jobId } });
    const company = await db.company.findUniqueOrThrow({
      where: { id: job.companyId },
      include: { activeSummary: true, activeFit: true, fitInputs: true, rejections: { orderBy: { at: "desc" }, take: 1 } },
    });
    const rows = await currentThesis();
    const version = await db.thesisVersion.findFirst({ orderBy: { version: "desc" } });
    if (!rows.length || !version) throw new Error("no_thesis");
    aiProvider(); // fail fast with "not configured"

    const summary = (company.activeSummary?.json ?? null) as SummaryOutput | null;
    const previous = company.activeFit;
    const reuse = job.reason === "THESIS" && previous ? factsZ.safeParse(previous.facts) : null;
    let source: { facts: Facts } | { deck: Awaited<ReturnType<typeof prepareDeck>> };
    let fileName: string | null = previous?.sourceFileName ?? null;
    let unverified = 0;
    if (reuse?.success) {
      source = { facts: reuse.data };
      unverified = unverifiedFrom(previous?.flags);
    } else {
      const file = await deckFile(company.id, company.activeSummary?.sourceFileId ?? null);
      if (!file) throw new Error("no_deck");
      const deck = await prepareDeck(await storage().read(file.storageKey), file.originalName, file.mime);
      source = { deck };
      fileName = file.originalName;
      unverified = summary ? (unverifiedFigures(summary, deck.text)?.length ?? 0) : 0;
    }

    const stage: Stage = company.status === "PIPELINE" ? company.stage : (company.exitStage ?? company.stage);
    const holdings = await db.company.findMany({ where: { status: "INVESTED", themeCode: { not: null } }, select: { name: true, themeCode: true }, orderBy: { name: "asc" } });
    // Seen before: it left the pipeline once, or a rejected company has a matching name (SPEC §7.4).
    const before = company.rejections[0] ?? null;
    const twin = before
      ? null
      : (await db.company.findMany({ where: { status: "REJECTED", id: { not: company.id } }, select: { name: true, exitAt: true, exitStage: true } })).find((c) => isDuplicateName(c.name, company.name));
    const seenBefore = before
      ? { date: fmtDate(before.at.toISOString().slice(0, 10)), stage: STAGE_LABELS[before.stageAtRejection] }
      : twin
        ? { date: fmtDate(twin.exitAt?.toISOString().slice(0, 10) ?? null), stage: twin.exitStage ? STAGE_LABELS[twin.exitStage] : null }
        : null;
    const prevHighlights = highlightRowZ.array().safeParse(previous?.highlights);

    const r = await rate({
      rows,
      source,
      company: { themeCode: company.themeCode, themeEdited: company.themeEdited, stage },
      financials: summary?.financials ?? null,
      unverified,
      business: (summary?.business ?? []).filter((b): b is string => !!b),
      holdingsFor: (code) => (code ? holdings.filter((h) => h.themeCode === code).map((h) => h.name) : []),
      seenBefore,
      inputs: company.fitInputs.map((i) => ({ code: i.code, score: i.score })),
      previousHighlights: prevHighlights.success ? prevHighlights.data : [],
      signal: ctl.signal,
    });

    await db.$transaction(async (tx) => {
      const cur = await tx.fitJob.findUniqueOrThrow({ where: { id: jobId } });
      if (cur.status !== "RUNNING") return;
      const rating = await tx.fitRating.create({
        data: {
          companyId: company.id,
          summaryId: company.activeSummaryId,
          sourceFileName: fileName,
          thesisVersion: version.version,
          themeCode: r.themeCode,
          fit: r.means.fit,
          promise: r.means.promise,
          fitScored: r.means.fitScored,
          fitTotal: r.means.fitTotal,
          promiseScored: r.means.promiseScored,
          promiseTotal: r.means.promiseTotal,
          facts: r.facts as Prisma.InputJsonValue,
          scores: r.scores as unknown as Prisma.InputJsonValue,
          flags: r.flags as unknown as Prisma.InputJsonValue,
          highlights: r.highlights as unknown as Prisma.InputJsonValue,
          unchecked: "deck" in source ? r.unchecked : (previous?.unchecked ?? false),
          model: `${aiModel} + ${fitModel}`,
        },
      });
      // The reading picks the theme unless a person has set it (SPEC §17.2, step 2).
      const theme = !company.themeEdited && r.themeCode !== company.themeCode ? r.themeCode : undefined;
      await tx.company.update({ where: { id: company.id }, data: { activeFitId: rating.id, ...(theme !== undefined ? { themeCode: theme } : {}) } });
      const name = (c: string | null) => (c ? `${c} ${themeByCode(rows, c)?.data.name ?? ""}`.trim() : null);
      await audit(tx, company.id, company.createdById, [
        { note: `Rated fit, thesis version ${version.label}` },
        ...(theme !== undefined ? [{ field: "theme", from: name(company.themeCode), to: name(theme) }] : []),
      ]);
      await tx.fitJob.update({ where: { id: jobId }, data: { status: "DONE", finishedAt: new Date(), error: null } });
    });
  } catch (e) {
    console.error("[fit-job] failed", jobId, (e as AiError)?.code ?? (e as Error)?.message?.slice(0, 40));
    await db.fitJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: "FAILED", error: friendly(e), finishedAt: new Date() } });
  } finally {
    clearInterval(watch);
  }
}

// ─── Worker ──────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __fitWorker?: { running: number; timer?: NodeJS.Timeout } };

async function claim(): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "FitJob" SET status = 'RUNNING', "startedAt" = now(), "heartbeatAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "FitJob"
      WHERE (status = 'QUEUED')
         OR (status = 'RUNNING' AND "heartbeatAt" < now() - make_interval(secs => ${STALE_MS / 1000}) AND attempts < 3)
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

async function tick() {
  const w = g.__fitWorker;
  if (!w) return;
  try {
    // A job left running after its third attempt went stale is closed, so the company can be rated again.
    await db.fitJob.updateMany({
      where: { status: "RUNNING", attempts: { gte: 3 }, heartbeatAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { status: "FAILED", error: "The rating could not be worked out. Try again.", finishedAt: new Date() },
    });
    while (w.running < MAX_PARALLEL) {
      const id = await claim();
      if (!id) break;
      w.running++;
      processJob(id).finally(() => {
        w.running--;
        void tick();
      });
    }
  } catch (e) {
    console.error("[fit-job] worker tick failed", (e as { code?: string })?.code);
  }
}

/** Started from src/instrumentation.ts after the summary worker; never in the funding-only deployment. */
export function startFitWorker() {
  if (g.__fitWorker) return;
  g.__fitWorker = { running: 0 };
  g.__fitWorker.timer = setInterval(tick, 3000);
  void tick();
}

export function kickFitWorker() {
  if (!g.__fitWorker) startFitWorker();
  else void tick();
}
