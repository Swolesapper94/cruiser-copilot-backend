import type {
  Citation,
  SourceConflict,
  SourceDocument,
  SourcePassage,
  SourceType,
} from "@/types";
import { citationSchema } from "@/lib/validation/schemas";
import { evidenceCatalog, retrieveEvidence, type ScoredChunk } from "@/lib/evidence";
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

function sourceTypeFor(kind: string): SourceType {
  if (
    kind === "service_bulletin" ||
    kind === "oem_manual" ||
    kind === "oem_technical" ||
    kind === "verified_case" ||
    kind === "technician" ||
    kind === "forum" ||
    kind === "general"
  ) {
    return kind;
  }
  return "general";
}

function evidencePassage(entry: ScoredChunk): RetrievedPassage {
  const sourceType = sourceTypeFor(entry.chunk.sourceKind);
  const document: SourceDocument = {
    id: entry.chunk.documentId,
    sourceType,
    title: entry.chunk.citationLabel,
    url: entry.chunk.citationUrl,
    authorityLevel: entry.chunk.authorityTier,
    // Editorial approval means the extraction is safe to retrieve. It does not
    // manufacture a copyright licence for the underlying source.
    licenseStatus: "unknown",
    isPlaceholder: false,
  };
  const passage: SourcePassage = {
    id: entry.chunk.id,
    sourceDocumentId: entry.chunk.documentId,
    text: entry.chunk.text,
    manufacturers: [],
    modelNames: [],
    submodels: [],
    modelCodes: [],
    engineCodes: [],
    markets: [],
    pumpModels: [],
    acsdStates: [],
    emissionsConfigurations: [],
    keywords: entry.chunk.keywords,
    specificationSubject: entry.chunk.specificationSubject,
    specificationValue: entry.chunk.specificationValueKey,
  };
  const citation = citationSchema.parse({
    id: `cit-${entry.chunk.id}`,
    sourceDocumentId: document.id,
    sourcePassageId: passage.id,
    label: entry.chunk.citationLabel,
    locator: entry.chunk.contentUnitId ?? entry.chunk.id,
    sourceType,
    authorityLevel: entry.chunk.authorityTier,
    url: entry.chunk.citationUrl,
    isPlaceholder: false,
  });
  return {
    passage,
    document,
    citation,
    applicability: entry.applicability,
    score: entry.score,
    matchedKeywords: entry.matchedKeywords,
    semantic: entry.semanticOnly,
  };
}

function evidenceConflicts(entries: ReturnType<typeof retrieveEvidence>["conflicts"]): SourceConflict[] {
  return entries.map((conflict) => ({
    id: `conflict-evidence-${conflict.subject.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    subject: conflict.subject,
    alternatives: conflict.alternatives.map((alternative) => ({
      value: alternative.value,
      citationId: `cit-${alternative.chunkId}`,
      applicabilitySummary: `Evidence authority tier ${alternative.authorityTier}; see source for vehicle scope.`,
    })),
    missingApplicabilityFields: conflict.missingApplicabilityFields,
    resolutionStatus: conflict.resolutionStatus,
    explanation: conflict.explanation,
  }));
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

  const seedConflicts = detectSpecificationConflicts(scored, request.vehicle);

  const reviewedEvidence = retrieveEvidence(
    {
      vehicle: request.vehicle,
      keywords,
      specificationSubject: request.specificationSubject,
      includeUnresolved,
      limitPerChannel: limit,
    },
    evidenceCatalog.store,
  );
  scored.push(
    ...reviewedEvidence.oem.map(evidencePassage),
    ...reviewedEvidence.community.map(evidencePassage),
  );
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.document.authorityLevel !== b.document.authorityLevel) {
      return a.document.authorityLevel - b.document.authorityLevel;
    }
    return a.passage.id.localeCompare(b.passage.id);
  });

  const passages = scored.slice(0, limit);
  const conflicts = [
    ...seedConflicts,
    ...evidenceConflicts(reviewedEvidence.conflicts),
  ];

  return {
    passages,
    citations: passages.map((entry) => entry.citation),
    conflicts,
    placeholderOnly:
      reviewedEvidence.oem.length === 0 &&
      passages.every((entry) => entry.document.isPlaceholder || entry.document.authorityLevel > 3),
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
