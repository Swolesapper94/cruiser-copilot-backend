import { buildRetrievalChunks, type RetrievalChunk } from "./chunks";
import { normalizeExtraction, type NormalizedApplicability, type NormalizedExtraction } from "./normalize";
import { scoreRepairCases, type CaseQuality } from "./quality";
import { blocksPublication, reviewTriggers, type ReviewFlag } from "./review";
import { validateExtraction, type EvidenceIssue } from "./validate";

/**
 * In-memory evidence store.
 *
 * This is the running implementation the MVP uses. `packages/database/
 * evidence-schema.sql` is the same model in Postgres for when the corpus
 * outgrows a process — the shapes are deliberately 1:1 so swapping the store
 * does not change any calling code.
 *
 * Two rules the store itself enforces:
 *   1. Nothing enters the store that has not passed `validateExtraction`.
 *   2. Anything carrying a severity-1 review flag is stored but held back from
 *      publication until a human clears it.
 */

export interface IngestionResult {
  ok: boolean;
  errors: EvidenceIssue[];
  warnings: EvidenceIssue[];
  reviewFlags: ReviewFlag[];
  quality: CaseQuality[];
  normalized?: NormalizedExtraction;
  chunks: RetrievalChunk[];
  /** True when a severity-1 flag means nothing here may be surfaced yet. */
  heldForReview: boolean;
}

export interface EvidenceSnapshotSummary {
  canonicalUrl: string;
  documentTitle: string;
  authorityTier: number;
  contentUnits: number;
  blocks: number;
  claims: number;
  cases: number;
  chunks: number;
  published: boolean;
}

export class EvidenceStore {
  private readonly extractions = new Map<string, NormalizedExtraction>();
  private readonly chunksByDocument = new Map<string, RetrievalChunk[]>();
  private readonly applicabilityById = new Map<string, NormalizedApplicability>();
  private readonly published = new Set<string>();
  private readonly openFlags = new Map<string, ReviewFlag[]>();

  ingest(payload: unknown): IngestionResult {
    const validation = validateExtraction(payload);
    if (!validation.ok || !validation.payload) {
      return {
        ok: false,
        errors: validation.errors,
        warnings: validation.warnings,
        reviewFlags: [],
        quality: [],
        chunks: [],
        heldForReview: true,
      };
    }

    const parsed = validation.payload;
    const quality = scoreRepairCases(parsed);
    const reviewFlags = reviewTriggers(parsed);
    const heldForReview = blocksPublication(reviewFlags);

    const needsReviewLocalIds = new Set(
      reviewFlags.flatMap((flag) => (flag.severity === 1 ? flag.relatedLocalIds : [])),
    );

    const normalized = normalizeExtraction(parsed, {
      qualityByCase: new Map(quality.map((entry) => [entry.caseLocalId, entry.score])),
      needsReviewLocalIds,
    });

    const chunks = buildRetrievalChunks(normalized);

    this.extractions.set(normalized.documentId, normalized);
    this.chunksByDocument.set(normalized.documentId, chunks);
    this.openFlags.set(normalized.documentId, reviewFlags);
    for (const entry of normalized.applicability) {
      this.applicabilityById.set(entry.id, entry);
    }
    if (heldForReview) this.published.delete(normalized.documentId);
    else this.published.add(normalized.documentId);

    return {
      ok: true,
      errors: [],
      warnings: validation.warnings,
      reviewFlags,
      quality,
      normalized,
      chunks,
      heldForReview,
    };
  }

  /** Clears the review hold for a document. Intended for a human-driven action. */
  approveDocument(documentId: string, reviewer: string): boolean {
    if (!reviewer.trim()) return false;
    if (!this.extractions.has(documentId)) return false;
    this.published.add(documentId);
    this.openFlags.delete(documentId);
    return true;
  }

  applicability(id: string | undefined): NormalizedApplicability | undefined {
    return id ? this.applicabilityById.get(id) : undefined;
  }

  /** Chunks eligible for retrieval. Held documents are excluded by default. */
  activeChunks(options: { includeHeld?: boolean } = {}): RetrievalChunk[] {
    const chunks: RetrievalChunk[] = [];
    for (const [documentId, documentChunks] of this.chunksByDocument) {
      if (!options.includeHeld && !this.published.has(documentId)) continue;
      for (const chunk of documentChunks) {
        if (chunk.active) chunks.push(chunk);
      }
    }
    return chunks;
  }

  blockText(blockId: string): string | undefined {
    for (const extraction of this.extractions.values()) {
      const block = extraction.blocks.find((entry) => entry.id === blockId);
      if (block) return block.text;
    }
    return undefined;
  }

  openReviewFlags(): ReviewFlag[] {
    return [...this.openFlags.values()].flat();
  }

  summaries(): EvidenceSnapshotSummary[] {
    return [...this.extractions.values()].map((extraction) => ({
      canonicalUrl: extraction.canonicalUrl,
      documentTitle: extraction.documentTitle,
      authorityTier: extraction.authorityTier,
      contentUnits: extraction.contentUnits.length,
      blocks: extraction.blocks.length,
      claims: extraction.claims.length,
      cases: extraction.repairCases.length,
      chunks: this.chunksByDocument.get(extraction.documentId)?.length ?? 0,
      published: this.published.has(extraction.documentId),
    }));
  }

  clear(): void {
    this.extractions.clear();
    this.chunksByDocument.clear();
    this.applicabilityById.clear();
    this.published.clear();
    this.openFlags.clear();
  }
}

/** Process-wide store. Replace with a Postgres-backed store when persisting. */
export const evidenceStore = new EvidenceStore();
