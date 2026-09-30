import "server-only";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adminEmails, devLoginEnabled, env } from "@/lib/env";
import type { Me } from "@/lib/domain/types";

export type AppRole = "ADMIN" | "EDITOR";

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/** The signed-in user, or null. Role comes from the DB (re-checked against ADMIN_EMAILS). */
export async function currentUser(): Promise<Me | null> {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return null;
  const u = await db.user.findUnique({ where: { id: uid } });
  // Re-check the domain on every request (e.g. the bot user or a changed ALLOWED_EMAIL_DOMAIN).
  if (!u || !u.email.endsWith("@" + env.ALLOWED_EMAIL_DOMAIN.toLowerCase())) return null;
  // Admin follows ADMIN_EMAILS on every request, so removing someone takes effect immediately.
  // (Dev login with no ADMIN_EMAILS set is the only other admin.)
  const role: AppRole =
    adminEmails.has(u.email) || (devLoginEnabled && adminEmails.size === 0 && u.role === "ADMIN") ? "ADMIN" : "EDITOR";
  return { id: u.id, name: u.name, email: u.email, role };
}

/**
 * Every route handler and server action calls this first.
 * EDITOR = any signed-in user; ADMIN = ADMIN_EMAILS only.
 */
export async function requireRole(min: AppRole = "EDITOR"): Promise<Me> {
  const me = await currentUser();
  if (!me) throw new AuthError(401, "Your session has ended. Sign in again.");
  if (min === "ADMIN" && me.role !== "ADMIN") throw new AuthError(403, "Only an admin can do that.");
  return me;
}
