import "server-only";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth/session";
import { UserError } from "./action";

/** Error → JSON response for route handlers. */
export function errorResponse(e: unknown): Response {
  if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof ZodError) return Response.json({ error: "That request is not valid." }, { status: 400 });
  if ((e as { code?: string })?.code === "P2025") return Response.json({ error: "Not found." }, { status: 404 });
  console.error("[route] failed", (e as { code?: string })?.code ?? (e as Error)?.name);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
}
