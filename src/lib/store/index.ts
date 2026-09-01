import type { DiagnosticSession, Vehicle } from "@/types";
import { diagnosticSessionSchema } from "@/lib/validation/schemas";

export interface SessionStore {
  create(session: DiagnosticSession): Promise<DiagnosticSession>;
  get(id: string): Promise<DiagnosticSession | undefined>;
  update(
    id: string,
    mutate: (session: DiagnosticSession) => DiagnosticSession,
  ): Promise<DiagnosticSession | undefined>;
  delete(id: string): Promise<boolean>;
}

/**
 * In-memory store.
 *
 * Deliberate MVP choice: no user media or diagnostic content is persisted to
 * disk or to a third party by default. A Postgres-backed implementation (see
 * packages/database/schema.sql) can be dropped in behind this interface
 * without touching route handlers.
 */
class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, DiagnosticSession>();

  async create(session: DiagnosticSession) {
    this.sessions.set(session.id, session);
    return session;
  }

  async get(id: string) {
    return this.sessions.get(id);
  }

  async update(
    id: string,
    mutate: (session: DiagnosticSession) => DiagnosticSession,
  ) {
    const current = this.sessions.get(id);
    if (!current) return undefined;
    const next = diagnosticSessionSchema.parse({
      ...mutate(current),
      updatedAt: new Date().toISOString(),
    });
    this.sessions.set(id, next);
    return next;
  }

  async delete(id: string) {
    return this.sessions.delete(id);
  }
}

const globalStore = globalThis as unknown as {
  __cruiserCopilotStore?: SessionStore;
};

export const sessionStore: SessionStore =
  globalStore.__cruiserCopilotStore ??
  (globalStore.__cruiserCopilotStore = new MemorySessionStore());

export function emptyVehicle(id: string): Vehicle {
  return {
    id,
    // Cruiser Copilot is currently product-scoped to Toyota Land Cruisers.
    // A multi-make deployment should collect or decode these instead.
    manufacturer: "Toyota",
    modelName: "Land Cruiser",
    series: "unknown",
    engineCode: "unknown",
    modifications: [],
    identificationConfidence: "unknown",
  };
}

let counter = 0;

export function createId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function newSession(id: string, complaint: string): DiagnosticSession {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    vehicle: emptyVehicle(`${id}-vehicle`),
    complaint,
    stage: "vehicle",
    answers: [],
    evidence: [],
    completedStepIds: [],
    mode: "scripted",
  };
}
