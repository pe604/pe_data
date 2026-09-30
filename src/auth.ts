import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { db } from "@/lib/db";
import { adminEmails, devLoginEnabled, entraConfigured, entraTenantId, env } from "@/lib/env";

const allowedDomain = env.ALLOWED_EMAIL_DOMAIN.toLowerCase();

function emailAllowed(email: string | null | undefined): email is string {
  if (!email) return false;
  const e = email.toLowerCase();
  // Guest accounts in Entra look like name_otherdomain.com#EXT#@tenant.onmicrosoft.com
  if (e.includes("#ext#")) return false;
  return e.endsWith("@" + allowedDomain);
}

const providers: NextAuthConfig["providers"] = [];

if (entraConfigured) {
  providers.push(
    MicrosoftEntraID({
      clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      // Always the tenant-specific issuer (validated in env.ts), never /common.
      issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  );
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Developer login",
      credentials: {},
      // Local development only: signs in as the first admin (a fake admin if none is set).
      // Refused unless the request came to localhost, so it can't be used from another machine.
      authorize: async (_credentials, request) => {
        const host = new URL(request.url).hostname;
        if (!LOOPBACK.has(host)) return null;
        const email = [...adminEmails][0] ?? `dev.admin@${allowedDomain}`;
        return { id: email, email, name: "Dev Admin" };
      },
    }),
  );
}

/** Creates or updates the User row and returns its id. Role is re-derived on every sign-in. */
async function upsertUser(email: string, name: string | null | undefined) {
  const e = email.toLowerCase();
  const role = adminEmails.has(e) || (devLoginEnabled && adminEmails.size === 0) ? "ADMIN" : "EDITOR";
  const displayName = name?.trim() || e.split("@")[0];
  const user = await db.user.upsert({
    where: { email: e },
    create: { email: e, name: displayName, role },
    update: { name: displayName, role },
  });
  return user.id;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  // Short sessions: someone removed from Microsoft 365 loses access within 12 hours.
  session: { strategy: "jwt", maxAge: 12 * 60 * 60, updateAge: 60 * 60 },
  trustHost: true,
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ user, account, profile }) {
      if (account?.provider === "microsoft-entra-id") {
        // Only accounts from Niveshaay's own tenant. Without this, a user in another tenant could set
        // their email to @niveshaay.com and get in ("nOAuth").
        if (!entraTenantId || String(profile?.tid ?? "").toLowerCase() !== entraTenantId) return false;
      } else if (account?.provider !== "dev") {
        return false;
      }
      const email = user.email ?? (profile?.preferred_username as string | undefined);
      return emailAllowed(email);
    },
    async jwt({ token, user, profile }) {
      if (user) {
        const email = user.email ?? (profile?.preferred_username as string | undefined);
        if (!emailAllowed(email)) return null;
        token.uid = await upsertUser(email, user.name);
        token.email = email.toLowerCase();
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
