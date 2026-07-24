import type { Citation, SourceDocument, SourcePassage } from "@/types";
import { citationSchema } from "@/lib/validation/schemas";
import { evaluateApplicability } from "./applicability";
import { detectSpecificationConflicts } from "./conflicts";
import { SOURCE_DOCUMENTS, SOURCE_PASSAGES } from "./seed-sources";
import { semanticCandidates } from "./semantic";
import type { RetrievalRequest, RetrievalResult, RetrievedPassage } from "./types";

export * from "./types";
export {
  evaluateApplicability,
  missingVehicleFields,
  isVehicleIdentified,
  seriesForModelCode,
} from "./applicability";
export { detectSpecificationConflicts, specificationIsLocked } from "./conflicts";
export {
  AUTHORITY_BY_SOURCE_TYPE,
  isOemSource,
  byAuthority,
  authorityFor,
  mayOverrideSpecification,
} from "./authority";

const documentsById = new Map(SOURCE_DOCUMENTS.map((doc) => [doc.id, doc]));

export function buildLocator(passage: SourcePassage): string {
  const parts: string[] = [];
  if (passage.pageNumber !== undefined) parts.push(`p. ${passage.pageNumber}`);
  if (passage.section) parts.push(passage.section);
  if (passage.postNumber) parts.push(`post ${passage.postNumber}`);
  if (parts.length === 0) parts.push(passage.id);
  return parts.join(" · ");
}

/** Citation IDs are derived from immutable passage IDs and never invented. */
export function buildCitation(
  passage: SourcePassage,
  document: SourceDocument,
): Citation {
  return citationSchema.parse({
    id: `cit-${passage.id}`,
    sourceDocumentId: document.id,
    sourcePassageId: passage.id,
    label: document.title,
    locator: buildLocator(passage),
    sourceType: document.sourceType,
    authorityLevel: document.authorityLevel,
    url: document.url,
    isPlaceholder: document.isPlaceholder,
  });
}

function exactKeywordMatches(
  passage: SourcePassage,
  keywords: readonly string[],
): string[] {
  if (keywords.length === 0) return [];
  const haystack = [
    passage.text,
    passage.section ?? "",
    passage.specificationSubject ?? "",
    ...passage.keywords,
  ]
    .join(" \n ")
    .toLowerCase();

  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
}

/**
 * Hybrid retrieval:
 *   applicability filter → exact keyword/spec lookup (+ optional semantic)
 *   → authority scoring → applicability reranking → conflict detection.
 *
 * Exact matching is mandatory for model codes, engine codes, tool numbers,
 * torque values, tolerances and specifications. Embeddings only ever add
 * candidates; they never replace an exact match.
 */
export function retrieve(request: RetrievalRequest): RetrievalResult {
  const keywords = request.keywords ?? [];
  const includeUnresolved = request.includeUnresolved ?? true;
  const limit = request.limit ?? 12;

  const semanticIds = new Set(semanticCandidates(keywords.join(" ")));

  const scored: RetrievedPassage[] = [];

  for (const passage of SOURCE_PASSAGES) {
    const document = documentsById.get(passage.sourceDocumentId);
    if (!document) continue;

    const applicability = evaluateApplicability(passage, request.vehicle);
    if (applicability.verdict === "not-applicable") continue;
    if (applicability.verdict === "unresolved" && !includeUnresolved) continue;

    const matchedKeywords = exactKeywordMatches(passage, keywords);
    const subjectMatch =
      request.specificationSubject !== undefined &&
      passage.specificationSubject === request.specificationSubject;
    const semantic = semanticIds.has(passage.id);

    if (matchedKeywords.length === 0 && !subjectMatch && !semantic) continue;

    const authorityBonus = 8 - document.authorityLevel;
    const applicabilityPenalty = applicability.verdict === "unresolved" ? 2 : 0;
    const score =
      matchedKeywords.length * 3 +
      (subjectMatch ? 6 : 0) +
      applicability.matchStrength * 2 +
      authorityBonus -
      applicabilityPenalty -
      (semantic && matchedKeywords.length === 0 ? 1 : 0);

    scored.push({
      passage,
      document,
      citation: buildCitation(passage, document),
      applicability,
      score,
      matchedKeywords,
      semantic: semantic && matchedKeywords.length === 0 && !subjectMatch,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.document.authorityLevel !== b.document.authorityLevel) {
      return a.document.authorityLevel - b.document.authorityLevel;
    }
    return a.passage.id.localeCompare(b.passage.id);
  });

  const passages = scored.slice(0, limit);
  const conflicts = detectSpecificationConflicts(scored, request.vehicle);

  return {
    passages,
    citations: passages.map((entry) => entry.citation),
    conflicts,
    placeholderOnly: passages.every((entry) => entry.document.isPlaceholder),
  };
}

export function citationsForPassageIds(passageIds: readonly string[]): Citation[] {
  const citations: Citation[] = [];
  for (const id of passageIds) {
    const passage = SOURCE_PASSAGES.find((entry) => entry.id === id);
    if (!passage) continue;
    const document = documentsById.get(passage.sourceDocumentId);
    if (!document) continue;
    citations.push(buildCitation(passage, document));
  }
  return citations;
}
