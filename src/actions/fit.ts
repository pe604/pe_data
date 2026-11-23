"use server";

// The fit rating's actions (SPEC §17.9–17.11). Every one starts with requireRole() and a zod schema.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { run, UserError } from "@/lib/server/action";
import { kickFitWorker, queueFitJob } from "@/lib/fit/jobs";

const id = z.string().min(1).max(40);

export interface FitJobState {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
}

/** Rate again (reason MANUAL): reads the deck again. One open job per company. */
export async function rateAgain(companyId: string) {
  return run<FitJobState>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const c = await db.company.findUnique({ where: { id: cid }, select: { status: true, _count: { select: { files: { where: { kind: "DECK" } } } } } });
    if (!c) throw new UserError("That company no longer exists. Reload the page.");
    if (c.status === "INVESTED") throw new UserError("Fit ratings are for pipeline and rejected companies.");
    if (!c._count.files) throw new UserError("Upload a deck to get a rating.");
    const jobId = await queueFitJob(cid, "MANUAL");
    kickFitWorker();
    const job = await db.fitJob.findUniqueOrThrow({ where: { id: jobId } });
    return { id: job.id, status: job.status as FitJobState["status"], error: job.error };
  });
}

/** A rating job's state, for polling while it runs. */
export async function getFitJob(jobId: string) {
  return run<FitJobState>(async () => {
    await requireRole();
    const job = await db.fitJob.findUnique({ where: { id: id.parse(jobId) } });
    if (!job) throw new UserError("That rating job no longer exists.");
    return { id: job.id, status: job.status as FitJobState["status"], error: job.error };
  });
}
