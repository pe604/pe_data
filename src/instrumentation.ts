export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSectors } = await import("@/lib/server/bootstrap");
    await ensureSectors().catch((e) => console.error("[bootstrap] sectors failed", (e as { code?: string }).code));
    const { startWorker } = await import("@/lib/ai/jobs");
    startWorker();
    const { startWhatsAppPoller } = await import("@/lib/whatsapp/intake");
    startWhatsAppPoller();
  }
}
