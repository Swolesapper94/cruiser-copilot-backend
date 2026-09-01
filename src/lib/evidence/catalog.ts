import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

import { env } from "@/lib/config/env";
import { EvidenceStore, type IngestionResult } from "./store";

interface CatalogFile {
  version: 1;
  extractions: unknown[];
  approvedDocumentIds: string[];
}

function emptyCatalog(): CatalogFile {
  return { version: 1, extractions: [], approvedDocumentIds: [] };
}

/** Durable wrapper around the deterministic in-memory evidence index. */
export class EvidenceCatalog {
  readonly store = new EvidenceStore();
  private state = emptyCatalog();
  private writeChain = Promise.resolve();

  constructor(private readonly filePath?: string) {
    if (filePath) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath!, "utf8")) as Partial<CatalogFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.extractions)) {
        throw new Error("unsupported_evidence_catalog");
      }
      this.state = {
        version: 1,
        extractions: parsed.extractions,
        approvedDocumentIds: Array.isArray(parsed.approvedDocumentIds)
          ? parsed.approvedDocumentIds.filter((value): value is string => typeof value === "string")
          : [],
      };
      for (const extraction of this.state.extractions) this.store.ingest(extraction);
      for (const documentId of this.state.approvedDocumentIds) {
        this.store.approveDocument(documentId, "persisted-review");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async ingest(payload: unknown): Promise<IngestionResult> {
    const result = this.store.ingest(payload);
    if (!result.ok || !result.normalized) return result;

    const documentId = result.normalized.documentId;
    const retained = this.state.extractions.filter((entry) => {
      const probe = new EvidenceStore().ingest(entry);
      return probe.normalized?.documentId !== documentId;
    });
    this.state.extractions = [...retained, payload];
    this.state.approvedDocumentIds = this.state.approvedDocumentIds.filter(
      (id) => id !== documentId,
    );
    await this.persist();
    return result;
  }

  async approve(documentId: string, reviewer: string): Promise<boolean> {
    const approved = this.store.approveDocument(documentId, reviewer);
    if (!approved) return false;
    this.state.approvedDocumentIds = [
      ...new Set([...this.state.approvedDocumentIds, documentId]),
    ];
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    const serialized = JSON.stringify(this.state, null, 2);
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.tmp`;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filePath!);
    });
    await this.writeChain;
  }

  /** Used only by tests and maintenance commands. */
  async reset(): Promise<void> {
    this.store.clear();
    this.state = emptyCatalog();
    await this.persist();
  }
}

export const evidenceCatalog = new EvidenceCatalog(
  env.EVIDENCE_STORE_PATH ? path.resolve(env.EVIDENCE_STORE_PATH) : undefined,
);
