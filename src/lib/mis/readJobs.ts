import "server-only";
import { db } from "@/lib/db";
import { readMisHistory, type MisReadDraft } from "@/lib/ai/misRead";
import { AiError, aiUsage } from "@/lib/ai/provider";
import { resultFormatZ, usedLineIds } from "@/lib/domain/resultFormat";
import { storage } from "@/lib/storage";
import type { Prisma } from "@/generated/prisma/client";

// Background MIS reads (SPEC §15.11). A large MIS takes minutes, longer than a request can wait, so Read figures
// queues a job; the company file polls it and opens the review when it's done. DB-backed: survives a restart.
// Never log file contents or model output: ids and error codes only.

const STALE_MS = 10 * 60_000;
const MAX_PARALLEL = 2;

/** What a finished job keeps: the draft (figures only), with where it came from. */
export interface StoredRead extends MisReadDraft {
  fileName: string;
  source: "MIS" | "RESULT";
}

export async function queueRead(companyId: string, fileId: string, userId: string) {
  // One open read per file: reuse a queued or running one.
  const open = await db.misReadJob.findFirst({ where: { fileId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (open) return open;
  const job = await db.misReadJob.create({ data: { companyId, fileId, createdById: userId } });
  kick();
  return job;
}

function friendly(e: unknown): string {
  if (e instanceof AiError) return e.message;
  return "The file could not be read. Try again, or enter the figures by hand.";
}

async function runJob(jobId: string) {
  const beat = setInterval(() => {
    db.misReadJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date() } }).catch(() => undefined);
  }, 5000);
  try {
    const job = await db.misReadJob.findUniqueOrThrow({ where: { id: jobId }, include: { file: true, company: { select: { name: true } } } });
    if (!job.file) throw new AiError("failed", "That file no longer exists. Upload it again.");
    // With a saved result format, read only the lines it uses (much less to read).
    const saved = await db.resultFormat.findUnique({ where: { companyId: job.companyId }, select: { spec: true } });
    const parsed = saved ? resultFormatZ.safeParse(saved.spec) : null;
    const ids = parsed?.success ? [...usedLineIds(parsed.data)] : [];
    const want = ids.length ? (await db.misLine.findMany({ where: { id: { in: ids } }, select: { label: true } })).map((l) => l.label) : [];
    const before = aiUsage.costUsd;
    const draft = await readMisHistory(await storage().read(job.file.storageKey), job.file.originalName, job.company.name, { want });
    console.log("[mis-read-job] read", jobId, draft.rows.length, "rows", `$${(aiUsage.costUsd - before).toFixed(4)}`);
    if (!draft.rows.length) throw new AiError("failed", "No P&L or business figures found in this file.");
    const result: StoredRead = { ...draft, fileName: job.file.originalName, source: job.file.kind === "RESULT_NOTE" ? "RESULT" : "MIS" };
    await db.misReadJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: { status: "DONE", result: result as unknown as Prisma.InputJsonValue, finishedAt: new Date(), error: null },
    });
  } catch (e) {
    console.error("[mis-read-job] failed", jobId, (e as AiError)?.code ?? (e as Error)?.name);
    await db.misReadJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: "FAILED", error: friendly(e), finishedAt: new Date() } });
  } finally {
    clearInterval(beat);
  }
}

// ─── Worker ──────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __misReadWorker?: { running: number; timer?: NodeJS.Timeout } };

async function claim(): Promise<string | null> {
  // Times come from the app (as the heartbeats do), never the database clock: the columns have no time zone, so
  // mixing the two makes a running job look stale when the database isn't on UTC.
  // Prisma stores these columns as UTC wall-clock time; pass the same, as text cast to timestamp.
  const utc = (d: Date) => d.toISOString().replace("Z", "");
  const now = utc(new Date());
  const stale = utc(new Date(Date.now() - STALE_MS));
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "MisReadJob" SET status = 'RUNNING', "startedAt" = ${now}::timestamp, "heartbeatAt" = ${now}::timestamp, attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "MisReadJob"
      WHERE status = 'QUEUED'
         OR (status = 'RUNNING' AND "heartbeatAt" < ${stale}::timestamp AND attempts < 2)
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

async function tick() {
  const w = g.__misReadWorker;
  if (!w) return;
  try {
    // A job stuck after its retry: give up with a message.
    await db.misReadJob.updateMany({
      where: { status: "RUNNING", attempts: { gte: 2 }, heartbeatAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { status: "FAILED", error: "Reading took too long. Try again.", finishedAt: new Date() },
    });
    while (w.running < MAX_PARALLEL) {
      const id = await claim();
      if (!id) break;
      w.running++;
      void runJob(id).finally(() => {
        w.running--;
        kick();
      });
    }
  } catch (e) {
    console.error("[mis-read-job] worker tick failed", (e as { code?: string })?.code);
  }
}

export function startMisReadWorker() {
  if (g.__misReadWorker) return;
  g.__misReadWorker = { running: 0 };
  g.__misReadWorker.timer = setInterval(tick, 5000);
  void tick();
}

function kick() {
  if (!g.__misReadWorker) startMisReadWorker();
  else void tick();
}
