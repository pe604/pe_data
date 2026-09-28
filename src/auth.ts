import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { db } from "@/lib/db";
import { adminEmails, devLoginEnabled, entraConfigured, env } from "@/lib/env";

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
      issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER || undefined,
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Developer login",
      credentials: {},
      // Local development only: signs in as the first admin (a fake admin if none is set).
      authorize: async () => {
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
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ user, profile }) {
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
