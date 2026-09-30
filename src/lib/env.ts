import "server-only";
import { z } from "zod";
import { dbConfig } from "@/lib/db-config";

// The only place that reads process.env. Never log these values.
const schema = z.object({
  // Postgres (SPEC §2): DB_* parts, or one DATABASE_URL. Checked by dbConfig() below.
  DB_HOST: z.string().optional(),
  DB_PORT: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASS: z.string().optional(),
  DB_NAME: z.string().optional(),
  DB_SSL: z.enum(["disable", "require", "verify-full"]).default("verify-full"),
  DB_SSL_CA: z.string().optional(),
  DB_SCHEMA: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  DATABASE_URL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_MODEL: z.string().optional().default(""),
  // S3-compatible file storage (SPEC §2). All files are encrypted before upload.
  AWS_S3_ENDPOINT_URL: z.string().url(),
  AWS_S3_BUCKET_NAME: z.string().min(1),
  AWS_S3_FOLDER: z.string().min(1).regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, "folder without leading/trailing slashes"),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  STORAGE_ENCRYPTION_KEY: z
    .string()
    .refine((s) => Buffer.from(s, "base64").length === 32, "must be 32 random bytes, base64-encoded"),
  STORAGE_NAMESPACE: z.string().regex(/^[a-z0-9-]+$/).default("files"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  SOFFICE_PATH: z.string().optional().default(""),
  // WhatsApp intake via Evolution API (SPEC §14)
  EVOLUTION_API_URL: z.string().optional().default(""),
  EVOLUTION_API_KEY: z.string().optional().default(""),
  EVOLUTION_INSTANCE: z.string().optional().default(""),
  EVOLUTION_Receiver: z.string().optional().default(""),
  WHATSAPP_POLL_SECONDS: z.coerce.number().int().min(15).default(60),
  NODE_ENV: z.string().optional().default("development"),
});

const blankToUndefined = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
);

export const env = schema.parse(blankToUndefined);

/** Resolved Postgres connection settings (throws at startup when the database isn't configured). */
export const dbSettings = dbConfig(env);

export const maxUploadBytes = env.MAX_UPLOAD_MB * 1024 * 1024;

export const whatsappConfigured = Boolean(
  env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCE && env.EVOLUTION_Receiver,
);

/** AI summaries are on when an OpenRouter key is set. */
export const aiConfigured = Boolean(env.OPENROUTER_API_KEY);

/** Default model when OPENROUTER_MODEL is unset (reads PDFs natively). */
export const aiModel = env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
