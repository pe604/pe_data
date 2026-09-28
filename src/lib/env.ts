import "server-only";
import { z } from "zod";

// The only place that reads process.env. Never log these values.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_MICROSOFT_ENTRA_ID_ID: z.string().optional().default(""),
  AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().optional().default(""),
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: z.string().optional().default(""),
  ALLOWED_EMAIL_DOMAIN: z.string().min(1),
  ADMIN_EMAILS: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().optional().default(""),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_DIR: z.string().min(1).default("./storage"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  DEV_LOGIN: z.string().optional().default(""),
  SOFFICE_PATH: z.string().optional().default(""),
  NODE_ENV: z.string().optional().default("development"),
});

const blankToUndefined = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
);

export const env = schema.parse(blankToUndefined);

export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** DEV_LOGIN is ignored in production builds. */
export const devLoginEnabled = env.DEV_LOGIN === "true" && env.NODE_ENV !== "production";

export const entraConfigured = Boolean(
  env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
);

export const maxUploadBytes = env.MAX_UPLOAD_MB * 1024 * 1024;

/** Default model when GEMINI_MODEL is unset. */
export const geminiModel = env.GEMINI_MODEL || "gemini-2.5-flash";
