import "server-only";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/domain/types";

/** A message that is safe to show the user. */
export class UserError extends Error {}

/** Wraps a server action body: maps known errors to friendly messages, never leaks internals. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AuthError || e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: "That value is not valid. Check it and try again." };
    const code = (e as { code?: string })?.code;
    if (code === "P2025") return { ok: false, error: "That company no longer exists. Reload the page." };
    console.error("[action] failed", code ?? (e as Error)?.name);
    return { ok: false, error: "Could not save that change. Check your connection and try again." };
  }
}
