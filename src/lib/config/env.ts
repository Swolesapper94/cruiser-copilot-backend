import { z } from "zod";

/**
 * Runtime configuration for the Cruiser Copilot backend.
 *
 * Rules:
 *  - Never expose a secret through a client bundle — this service is the only
 *    place credentials are read.
 *  - Never log a key, token or raw Authorization header.
 *  - Missing credentials must degrade to scripted mode, never crash.
 */

const boolish = z
  .string()
  .optional()
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  DIAGNOSTIC_MODE: z.enum(["scripted", "live"]).default("scripted"),

  LLM_PROVIDER: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  VISION_MODEL: z.string().optional(),

  EMBEDDING_PROVIDER: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),

  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  MAX_VIDEO_SECONDS: z.coerce.number().positive().default(30),

  INGESTION_USER_AGENT: z
    .string()
    .default("CruiserCopilotBot/0.1 (+contact: set INGESTION_USER_AGENT)"),
  INGESTION_REQUEST_DELAY_MS: z.coerce.number().int().nonnegative().default(5000),
  INGESTION_MAX_PAGES_PER_RUN: z.coerce.number().int().positive().default(25),
  INGESTION_ADMIN_TOKEN: z.string().min(24).optional(),

  ENABLE_LIVE_LLM: boolish,
  ENABLE_SEMANTIC_RETRIEVAL: boolish,
  ENABLE_MEDIA_ANALYSIS: boolish,
  ENABLE_FORUM_INGESTION: boolish,
});

const parsed = envSchema.safeParse(process.env);

const fallback = envSchema.parse({});

export const env = parsed.success ? parsed.data : fallback;

/** Live mode requires an explicit flag AND a complete credential set. */
export function liveModelAvailable(): boolean {
  return Boolean(
    env.ENABLE_LIVE_LLM &&
      env.DIAGNOSTIC_MODE === "live" &&
      env.LLM_PROVIDER &&
      env.LLM_API_KEY &&
      env.LLM_MODEL,
  );
}

export function semanticRetrievalAvailable(): boolean {
  return Boolean(
    env.ENABLE_SEMANTIC_RETRIEVAL && env.EMBEDDING_PROVIDER && env.EMBEDDING_API_KEY,
  );
}

export function mediaAnalysisAvailable(): boolean {
  return Boolean(env.ENABLE_MEDIA_ANALYSIS && liveModelAvailable());
}

export function activeMode(): "scripted" | "live" {
  return liveModelAvailable() ? "live" : "scripted";
}

/**
 * Fetching third-party pages is off unless it is turned on deliberately.
 * Per-source terms review is a separate, additional gate — see
 * `assertFetchAllowed` in src/lib/evidence/adapters.ts.
 */
export function forumIngestionEnabled(): boolean {
  return Boolean(env.ENABLE_FORUM_INGESTION);
}

export function ingestionAdminAuthorized(header: string | undefined): boolean {
  if (!env.INGESTION_ADMIN_TOKEN || !header?.startsWith("Bearer ")) return false;
  return header.slice("Bearer ".length) === env.INGESTION_ADMIN_TOKEN;
}

export const uploadLimits = {
  maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  maxVideoSeconds: env.MAX_VIDEO_SECONDS,
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "video/mp4",
    "video/quicktime",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
  ] as readonly string[],
};
