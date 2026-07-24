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

  ENABLE_LIVE_LLM: boolish,
  ENABLE_SEMANTIC_RETRIEVAL: boolish,
  ENABLE_MEDIA_ANALYSIS: boolish,
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
  ] as const,
};
