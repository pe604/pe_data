import "server-only";
import { db } from "@/lib/db";
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

// OPEN ACCESS (temporary, by decision of the firm): there is no login. Every visitor acts as one shared
// "Team" user with Editor rights, so admin-only actions (hard delete, adding sectors) are unavailable.
// When a login is added, only this file needs to change: every route and action already calls requireRole().
const TEAM_EMAIL = "team@portal.invalid";
let teamUser: Promise<Me> | null = null;

async function loadTeamUser(): Promise<Me> {
  const u = await db.user.upsert({
    where: { email: TEAM_EMAIL },
    create: { email: TEAM_EMAIL, name: "Team", role: "EDITOR" },
    update: {},
  });
  return { id: u.id, name: u.name, email: u.email, role: "EDITOR" };
}

/** The current user: always the shared Team user while the portal is open access. */
export async function currentUser(): Promise<Me | null> {
  teamUser ??= loadTeamUser().catch((err) => {
    teamUser = null; // retry on the next request (e.g. the DB was briefly unreachable)
    throw err;
  });
  return teamUser;
}

/** Every route handler and server action calls this first. */
export async function requireRole(min: AppRole = "EDITOR"): Promise<Me> {
  const me = await currentUser();
  if (!me) throw new AuthError(401, "Your session has ended. Reload the page.");
  if (min === "ADMIN" && me.role !== "ADMIN") throw new AuthError(403, "Only an admin can do that.");
  return me;
}
