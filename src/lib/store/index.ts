import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/config/env";
import { diagnosticSessionSchema } from "@/lib/validation/schemas";
import type { DiagnosticSession, Vehicle } from "@/types";

interface StoredSession {
  session: DiagnosticSession;
  tokenHash: string;
}

export interface SessionStore {
  create(session: DiagnosticSession, tokenHash: string): Promise<DiagnosticSession>;
  get(id: string): Promise<DiagnosticSession | undefined>;
  authorize(id: string, accessToken: string | undefined): Promise<DiagnosticSession | undefined>;
  update(
    id: string,
    mutate: (session: DiagnosticSession) => DiagnosticSession,
  ): Promise<DiagnosticSession | undefined>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

function hashAccessToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenMatches(candidate: string | undefined, expectedHash: string): boolean {
  if (!candidate) return false;
  const actual = Buffer.from(hashAccessToken(candidate), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionAccess(): { accessToken: string; tokenHash: string } {
  const accessToken = randomBytes(32).toString("base64url");
  return { accessToken, tokenHash: hashAccessToken(accessToken) };
}

class MemorySessionStore implements SessionStore {
  protected readonly sessions = new Map<string, StoredSession>();

  async create(session: DiagnosticSession, tokenHash: string) {
    this.sessions.set(session.id, { session, tokenHash });
    await this.afterMutation();
    return session;
  }

  async get(id: string) {
    return this.sessions.get(id)?.session;
  }

  async authorize(id: string, accessToken: string | undefined) {
    const stored = this.sessions.get(id);
    if (!stored || !tokenMatches(accessToken, stored.tokenHash)) return undefined;
    return stored.session;
  }

  async update(
    id: string,
    mutate: (session: DiagnosticSession) => DiagnosticSession,
  ) {
    const stored = this.sessions.get(id);
    if (!stored) return undefined;
    const next = diagnosticSessionSchema.parse({
      ...mutate(stored.session),
      updatedAt: new Date().toISOString(),
    });
    this.sessions.set(id, { ...stored, session: next });
    await this.afterMutation();
    return next;
  }

  async delete(id: string) {
    const deleted = this.sessions.delete(id);
    if (deleted) await this.afterMutation();
    return deleted;
  }

  async clear() {
    this.sessions.clear();
    await this.afterMutation();
  }

  protected async afterMutation(): Promise<void> {}
}

/**
 * Atomic JSON persistence for a single-process deployment.
 *
 * The file contains validated session state and SHA-256 token hashes, never raw
 * bearer tokens or media bytes. Postgres remains the scale-out path.
 */
export class FileSessionStore extends MemorySessionStore {
  private writeChain = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      if (!Array.isArray(raw)) throw new Error("session_store_not_array");
      for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as { session?: unknown; tokenHash?: unknown };
        const parsed = diagnosticSessionSchema.safeParse(record.session);
        if (
          parsed.success &&
          typeof record.tokenHash === "string" &&
          /^[a-f0-9]{64}$/.test(record.tokenHash)
        ) {
          this.sessions.set(parsed.data.id, {
            session: parsed.data,
            tokenHash: record.tokenHash,
          });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  protected override async afterMutation(): Promise<void> {
    const snapshot = JSON.stringify([...this.sessions.values()], null, 2);
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.tmp`;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filePath);
    });
    await this.writeChain;
  }
}

const globalStore = globalThis as unknown as {
  __cruiserCopilotStore?: SessionStore;
};

async function buildSessionStore(): Promise<SessionStore> {
  if (env.SESSION_STORE === "file") {
    const store = new FileSessionStore(path.resolve(env.SESSION_STORE_PATH));
    await store.load();
    return store;
  }
  return new MemorySessionStore();
}

export const sessionStore: SessionStore =
  globalStore.__cruiserCopilotStore ??
  (globalStore.__cruiserCopilotStore = await buildSessionStore());

export function emptyVehicle(id: string): Vehicle {
  return {
    id,
    manufacturer: "Toyota",
    modelName: "Land Cruiser",
    series: "unknown",
    engineCode: "unknown",
    modifications: [],
    identificationConfidence: "unknown",
  };
}

export function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
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
