import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { currentUser } from "@/lib/auth/session";
import { devLoginEnabled, entraConfigured, env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="signin">
      <div className="signin-card">
        <div className="brand">
          <span className="wm">Niveshaay</span>
          <span className="app">Deal pipeline</span>
        </div>
        <p className="muted">Sign in with your Niveshaay Microsoft account (@{env.ALLOWED_EMAIL_DOMAIN}).</p>
        {error && (
          <div className="banner err">
            {error === "AccessDenied"
              ? `Only @${env.ALLOWED_EMAIL_DOMAIN} accounts can sign in.`
              : "Sign-in did not complete. Try again."}
          </div>
        )}
        {entraConfigured && (
          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id", { redirectTo: "/" });
            }}
          >
            <button className="btn primary signin-btn" type="submit">
              Sign in with Microsoft
            </button>
          </form>
        )}
        {devLoginEnabled && (
          <form
            action={async () => {
              "use server";
              await signIn("dev", { redirectTo: "/" });
            }}
          >
            <button className="btn signin-btn" type="submit">
              Developer login (local only)
            </button>
          </form>
        )}
        {!entraConfigured && !devLoginEnabled && (
          <div className="banner info">Microsoft sign-in is not configured yet. Ask IT to finish the Entra ID setup.</div>
        )}
      </div>
    </main>
  );
}
