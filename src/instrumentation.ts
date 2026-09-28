export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("@/lib/ai/jobs");
    startWorker();
  }
}
