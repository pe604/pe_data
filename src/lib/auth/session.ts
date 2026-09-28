import "server-only";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adminEmails } from "@/lib/env";
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
  if (!u) return null;
  const role: AppRole = u.role === "ADMIN" || adminEmails.has(u.email) ? "ADMIN" : "EDITOR";
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
