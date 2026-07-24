import { z } from "zod";
import type { DiagnosticSession, DiagnosticUpdate } from "@/types";
import { explainUpdate } from "@/lib/ai";
import {
  DIAGNOSTIC_SEARCH_KEYWORDS,
  SPECIFICATION_SUBJECT,
  evaluateSession,
} from "@/lib/diagnostic-policy";
import { retrieve } from "@/lib/retrieval";
import { sessionStore } from "@/lib/store";

export interface SessionPayload {
  session: DiagnosticSession;
  update: DiagnosticUpdate;
}

/** Framework-agnostic result. Route layers translate this to their own response type. */
export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

export function errorResult(status: number, code: string, detail?: string): ApiResult {
  return { status, body: { error: { code, detail } } };
}

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; result: ApiResult } {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      result: errorResult(422, "invalid_request", parsed.error.issues[0]?.message),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Deterministic evaluation, optionally decorated with a model explanation. */
export async function buildPayload(
  session: DiagnosticSession,
  options: { explain?: boolean } = {},
): Promise<SessionPayload> {
  const update = evaluateSession(session);
  if (!options.explain) return { session, update };

  const retrieval = retrieve({
    vehicle: session.vehicle,
    keywords: DIAGNOSTIC_SEARCH_KEYWORDS,
    specificationSubject: SPECIFICATION_SUBJECT,
  });

  const explained = await explainUpdate({
    session,
    update,
    passages: retrieval.passages,
  });

  return { session, update: { ...update, ...explained } };
}

export async function withSession(
  id: string,
  handler: (session: DiagnosticSession) => Promise<ApiResult>,
): Promise<ApiResult> {
  const session = await sessionStore.get(id);
  if (!session) return errorResult(404, "session_not_found");
  return handler(session);
}

/**
 * Applies a mutation, lets the policy layer own the resulting stage, and
 * returns the fresh payload. Stage is never set by the client.
 */
export async function mutateSession(
  id: string,
  mutate: (session: DiagnosticSession) => DiagnosticSession,
  options: { explain?: boolean } = {},
): Promise<ApiResult> {
  const updated = await sessionStore.update(id, (current) => {
    const next = mutate(current);
    return { ...next, stage: evaluateSession(next).stage };
  });
  if (!updated) return errorResult(404, "session_not_found");
  return { status: 200, body: await buildPayload(updated, options) };
}
