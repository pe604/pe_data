export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // The funding-only deployment shares the database: the main app runs every job, so it runs none.
    const { fundingOnly } = await import("@/lib/env");
    if (fundingOnly) return;
    const { ensureSectors } = await import("@/lib/server/bootstrap");
    await ensureSectors().catch((e) => console.error("[bootstrap] sectors failed", (e as { code?: string }).code));
    const { startWorker } = await import("@/lib/ai/jobs");
    startWorker();
    const { startMisReadWorker } = await import("@/lib/mis/readJobs");
    startMisReadWorker();
    const { startWhatsAppPoller } = await import("@/lib/whatsapp/intake");
    startWhatsAppPoller();
    const { startReminderScheduler } = await import("@/lib/whatsapp/reminders");
    startReminderScheduler();
    const { startNewsScheduler } = await import("@/lib/news/agent");
    startNewsScheduler();
    const { startEventsScheduler } = await import("@/lib/events/agent");
    startEventsScheduler();
    const { startFundingScheduler } = await import("@/lib/funding/agent");
    startFundingScheduler();
  }
}
