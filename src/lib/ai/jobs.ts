import "server-only";
import { db, type Tx } from "@/lib/db";
import { norm } from "@/lib/domain/names";
import { audit } from "@/lib/server/company";
import { storage } from "@/lib/storage";
import { buildMarkdown } from "@/lib/summary/markdown";
import { prepareDeck } from "./deck";
import { AiError, aiProvider } from "./provider";
import type { SummaryOutput } from "./schema";
import { summarise } from "./summarise";
import type { Prisma } from "@/generated/prisma/client";

// Background summary jobs (SPEC §9.1). DB-backed, so a closed tab or a restart doesn't lose work.
// Never log deck text or model output: ids and error codes only.

const STALE_MS = 5 * 60_000;
const MAX_PARALLEL = 2;

export async function createJob(fileId: string, companyId: string | null, userId: string) {
  const job = await db.summaryJob.create({
    data: { sourceFileId: fileId, companyId, createdById: userId },
  });
  kickWorker();
  return job;
}

export async function cancelJob(jobId: string) {
  await db.summaryJob.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
}

/** Links an Add-company job to the company it created; writes the summary if already done. */
export async function attachJobToCompany(jobId: string, companyId: string, userId: string) {
  await db.$transaction(async (tx) => {
    const job = await tx.summaryJob.findUnique({ where: { id: jobId } });
    if (!job || job.companyId) return;
    await tx.summaryJob.update({ where: { id: jobId }, data: { companyId } });
    if (job.status === "DONE" && job.resultJson && !job.summaryId) {
      await writeSummary(tx, { ...job, companyId }, userId);
    }
  });
}

export function matchSector(name: string | null | undefined, sectors: { id: string; name: string }[]) {
  if (!name) return null;
  const exact = sectors.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const n = norm(name);
  return sectors.find((s) => n && (norm(s.name).includes(n) || n.includes(norm(s.name)))) ?? sectors.find((s) => s.name === "Other") ?? null;
}

type JobRow = Prisma.SummaryJobGetPayload<object>;

/** Creates a new Summary version and applies the field update rules (SPEC §9.5). */
async function writeSummary(tx: Tx, job: JobRow & { companyId: string }, actorId: string) {
  const json = job.resultJson as SummaryOutput;
  const markdown = job.resultMarkdown ?? buildMarkdown(json);
  const company = await tx.company.findUniqueOrThrow({
    where: { id: job.companyId },
    include: { activeSummary: true, sector: true },
  });
  const file = job.sourceFileId ? await tx.file.findUnique({ where: { id: job.sourceFileId } }) : null;
  const last = await tx.summary.findFirst({ where: { companyId: company.id }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;
  const summary = await tx.summary.create({
    data: {
      companyId: company.id,
      version,
      sourceFileId: file?.id ?? null,
      sourceFileName: file?.originalName ?? null,
      json: json as Prisma.InputJsonValue,
      markdown,
      createdById: job.createdById,
    },
  });

  const data: Prisma.CompanyUncheckedUpdateInput = {};
  const changes: { field: string; from: string | null; to: string | null }[] = [];
  // An edited active summary stays active; otherwise the new one takes over.
  if (!company.activeSummary?.edited) data.activeSummaryId = summary.id;
  if (!company.sectorEdited && json.sector) {
    const sectors = await tx.sector.findMany();
    const s = matchSector(json.sector, sectors);
    if (s && s.id !== company.sectorId) {
      data.sectorId = s.id;
      changes.push({ field: "sector", from: company.sector?.name ?? null, to: s.name });
    }
  }
  const sub = json.subSector?.trim();
  if (!company.subSectorEdited && sub && sub !== company.subSector) {
    data.subSector = sub;
    changes.push({ field: "subSector", from: company.subSector, to: sub });
  }
  const name = json.company?.trim();
  if (!company.name.trim() && name) {
    data.name = name;
    changes.push({ field: "name", from: null, to: name });
  }
  await tx.company.update({ where: { id: company.id }, data });
  await tx.summaryJob.update({ where: { id: job.id }, data: { summaryId: summary.id } });
  await audit(tx, company.id, actorId, [
    { note: `Generated summary version ${version}` + (file ? ` from ${file.originalName}` : "") },
    ...changes,
  ]);
}

function friendly(e: unknown): string {
  if (e instanceof AiError) {
    if (e.code === "not_configured" || e.code === "blocked" || e.code === "empty") return e.message;
  }
  const m = (e as Error)?.message;
  if (m === "no_text") return "No readable text was found in this deck. Write the summary by hand.";
  if (m === "bad_type") return "Summaries can be generated from PDF and PowerPoint (.pptx) decks.";
  if (m === "invalid_json") return "The summary came back in an unexpected format. Try generating it again.";
  const status = (e as { status?: number })?.status;
  if (status === 429) return "The AI service is busy right now. Try generating the summary again in a minute.";
  if (status === 400) return "This deck could not be read. It may be too long or password-protected.";
  return "The summary could not be written. Try generating it again.";
}

async function processJob(jobId: string) {
  const isCancelled = async () =>
    (await db.summaryJob.findUnique({ where: { id: jobId }, select: { status: true } }))?.status === "CANCELLED";
  const ctl = new AbortController();
  const watch = setInterval(async () => {
    try {
      if (await isCancelled()) ctl.abort();
      else await db.summaryJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date() } });
    } catch {
      /* ignore */
    }
  }, 2000);
  try {
    const job = await db.summaryJob.findUniqueOrThrow({ where: { id: jobId }, include: { sourceFile: true } });
    if (!job.sourceFile) throw new Error("bad_type");
    aiProvider(); // fail fast with "not configured" before reading the deck

    await db.summaryJob.update({ where: { id: jobId }, data: { step: "READING" } });
    const bytes = await storage().read(job.sourceFile.storageKey);
    const deck = await prepareDeck(bytes, job.sourceFile.originalName, job.sourceFile.mime);
    if (ctl.signal.aborted) return;

    await db.summaryJob.update({ where: { id: jobId }, data: { step: "WRITING" } });
    const sectors = (await db.sector.findMany({ orderBy: { sortOrder: "asc" } })).map((s) => s.name);
    const { parsed, markdown, unverified } = await summarise(deck, sectors, ctl.signal);
    if (!markdown) throw new Error("no_text");
    if (unverified.length) console.warn("[summary-job] figures not found in deck text", jobId, unverified.length);

    await db.$transaction(async (tx) => {
      const cur = await tx.summaryJob.findUniqueOrThrow({ where: { id: jobId } });
      if (cur.status !== "RUNNING") return; // cancelled meanwhile
      const done = await tx.summaryJob.update({
        where: { id: jobId },
        data: {
          status: "DONE",
          step: null,
          finishedAt: new Date(),
          resultJson: parsed as Prisma.InputJsonValue,
          resultMarkdown: markdown,
        },
      });
      if (done.companyId) await writeSummary(tx, { ...done, companyId: done.companyId }, done.createdById);
    });
  } catch (e) {
    if (ctl.signal.aborted || (e instanceof AiError && e.code === "cancelled")) return;
    console.error("[summary-job] failed", jobId, (e as AiError)?.code ?? (e as Error)?.message?.slice(0, 40));
    await db.summaryJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: { status: "FAILED", step: null, error: friendly(e), finishedAt: new Date() },
    });
  } finally {
    clearInterval(watch);
  }
}

// ─── Worker ──────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __summaryWorker?: { running: number; timer?: NodeJS.Timeout; lastSweep: number } };

async function claim(): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "SummaryJob" SET status = 'RUNNING', "startedAt" = now(), "heartbeatAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "SummaryJob"
      WHERE (status = 'QUEUED')
         OR (status = 'RUNNING' AND "heartbeatAt" < now() - make_interval(secs => ${STALE_MS / 1000}) AND attempts < 3)
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** Deletes decks staged in Add company that were never saved (older than 24 h). */
async function sweepStaged() {
  const old = await db.file.findMany({
    where: { companyId: null, uploadedAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
  });
  for (const f of old) {
    await db.file.delete({ where: { id: f.id } }).catch(() => undefined);
    await storage().delete(f.storageKey).catch(() => undefined);
  }
}

async function tick() {
  const w = g.__summaryWorker!;
  try {
    if (Date.now() - w.lastSweep > 3600_000) {
      w.lastSweep = Date.now();
      await sweepStaged();
    }
    while (w.running < MAX_PARALLEL) {
      const id = await claim();
      if (!id) break;
      w.running++;
      processJob(id).finally(() => {
        w.running--;
        kickWorker();
      });
    }
  } catch (e) {
    console.error("[summary-job] worker tick failed", (e as { code?: string })?.code);
  }
}

export function startWorker() {
  if (g.__summaryWorker) return;
  g.__summaryWorker = { running: 0, lastSweep: 0 };
  g.__summaryWorker.timer = setInterval(tick, 3000);
  void tick();
}

export function kickWorker() {
  if (!g.__summaryWorker) startWorker();
  else void tick();
}
