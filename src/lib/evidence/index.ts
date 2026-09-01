export {
  EXTRACTION_SCHEMA_VERSION,
  extractionPayloadSchema,
  type ExtractionPayload,
  type ExtractedClaim,
  type ExtractedRepairCase,
  type ExtractedForumUnitAssessment,
  type ExtractedForumThreadAssessment,
  type ReviewFlagKind,
} from "./schemas";

export {
  validateExtraction,
  type EvidenceIssue,
  type EvidenceIssueSeverity,
  type ExtractionValidationResult,
} from "./validate";

export {
  reviewTriggers,
  detectClaimConflicts,
  blocksPublication,
  type ReviewFlag,
  type ClaimConflict,
} from "./review";

export { scoreRepairCases, type CaseQuality, type CaseQualityFeatures } from "./quality";

export {
  normalizeExtraction,
  stableId,
  contentHash,
  type NormalizedExtraction,
  type NormalizedClaim,
  type NormalizedRepairCase,
  type NormalizedForumUnitAssessment,
} from "./normalize";

export {
  buildRetrievalChunks,
  extractKeywords,
  type ChunkKind,
  type RetrievalChunk,
} from "./chunks";

export {
  EvidenceStore,
  evidenceStore,
  type IngestionResult,
  type EvidenceSnapshotSummary,
} from "./store";

export {
  retrieveEvidence,
  detectEvidenceConflicts,
  type EvidenceRetrievalRequest,
  type EvidenceRetrievalResult,
  type EvidenceConflict,
  type ScoredChunk,
} from "./retrieval";

export {
  adapterFor,
  registerAdapter,
  assertFetchAllowed,
  hashBody,
  verifyParse,
  xenforoAdapter,
  IngestionNotPermittedError,
  type SourceAdapter,
  type SourcePolicy,
  type RawSnapshot,
  type ParsedDocument,
  type ParseVerification,
} from "./adapters";

export {
  ForumCrawler,
  canonicalizeCrawlUrl,
  discoverThreadUrls,
  robotsAllows,
  crawlSourceSchema,
  type CrawlSource,
  type CrawlRunResult,
  type CrawlPageResult,
} from "./crawler";
