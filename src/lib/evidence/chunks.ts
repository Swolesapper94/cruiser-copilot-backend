import {
  contentHash,
  stableId,
  type NormalizedClaim,
  type NormalizedExtraction,
} from "./normalize";

/**
 * Retrieval chunk generation.
 *
 * Chunks are built FROM STRUCTURED RECORDS, not from arbitrary token windows,
 * so that every chunk can name the exact blocks it came from and a citation can
 * open the right unit.
 */

export type ChunkKind =
  | "source_passage"
  | "case_summary"
  | "claim_bundle"
  | "procedure_fragment"
  | "specification";

export interface RetrievalChunk {
  id: string;
  chunkKind: ChunkKind;
  documentId: string;
  sourceKind: string;
  /** The unit a citation should open. */
  contentUnitId?: string;
  citationUrl: string;
  citationLabel: string;
  repairCaseId?: string;
  applicabilityId?: string;
  text: string;
  sourceBlockIds: string[];
  claimIds: string[];
  authorityTier: number;
  qualityScore: number;
  /** Evidence support, distinct from author reputation and source authority. */
  credibilityScore: number;
  keywords: string[];
  /** Set for `specification` chunks so conflicts can be grouped. */
  specificationSubject?: string;
  /** Normalized comparison key; the cited text remains verbatim. */
  specificationValueKey?: string;
  contentHash: string;
  schemaVersion: string;
  extractorVersion: string;
  active: boolean;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "was", "were",
  "are", "not", "but", "you", "your", "its", "it's", "any", "all", "can", "will",
  "would", "there", "their", "when", "what", "which", "into", "onto", "over",
]);

/** Tokens that must survive verbatim: codes, part numbers, measurements. */
const CODE_PATTERN = /\b[a-z]*\d[\w./-]*\b/gi;
const WORD_PATTERN = /\b[a-z][a-z-]{2,}\b/gi;

const CLAIM_BASIS_SCORE: Record<NormalizedClaim["claimBasis"], number> = {
  oem_published: 1,
  measured_by_author: 0.85,
  performed_by_author: 0.8,
  outcome_confirmed: 0.95,
  community_corroborated: 0.75,
  suggestion_only: 0.3,
  hearsay: 0.1,
  unattributed_quote: 0.15,
  speculation: 0,
};

export function extractKeywords(text: string, extra: readonly string[] = []): string[] {
  const keywords = new Set<string>();
  for (const match of text.matchAll(CODE_PATTERN)) {
    keywords.add(match[0].toLowerCase());
  }
  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0].toLowerCase();
    if (!STOP_WORDS.has(word)) keywords.add(word);
  }
  for (const value of extra) {
    if (value.trim()) keywords.add(value.trim().toLowerCase());
  }
  return [...keywords].sort();
}

function claimSentence(claim: NormalizedClaim): string {
  const value = claim.valueNumeric !== undefined
    ? `${claim.valueNumeric}`
    : claim.valueNumericMin !== undefined && claim.valueNumericMax !== undefined
      ? `${claim.valueNumericMin}-${claim.valueNumericMax}`
      : undefined;
  const renderedValue = value
    ? ` (${value}${claim.unit ? ` ${claim.unit}` : ""})`
    : "";
  return `${claim.subject} ${claim.predicate.replace(/_/g, " ")} ${claim.objectText}${renderedValue} [${claim.assertionStrength}; ${claim.claimBasis}]`;
}

export function buildRetrievalChunks(
  normalized: NormalizedExtraction,
): RetrievalChunk[] {
  const chunks: RetrievalChunk[] = [];
  const unitById = new Map(normalized.contentUnits.map((unit) => [unit.id, unit]));
  const caseById = new Map(normalized.repairCases.map((entry) => [entry.id, entry]));
  const assessmentByUnit = new Map(
    normalized.forumUnitAssessments.map((entry) => [entry.unitId, entry]),
  );

  const base = {
    sourceKind: normalized.sourceKind,
    authorityTier: normalized.authorityTier,
    schemaVersion: normalized.schemaVersion,
    extractorVersion: normalized.extractorVersion,
    active: true,
  };

  const label = (contentUnitId?: string): string => {
    const unit = contentUnitId ? unitById.get(contentUnitId) : undefined;
    if (!unit) return normalized.documentTitle;
    if (unit.unitKind === "forum_post") {
      const who = unit.authorDisplayName ?? "unknown author";
      return unit.sequenceNumber
        ? `${normalized.documentTitle} · post ${unit.sequenceNumber} · ${who}`
        : `${normalized.documentTitle} · ${who}`;
    }
    if (unit.unitKind === "manual_page" && unit.sequenceNumber) {
      return `${normalized.documentTitle} · page ${unit.sequenceNumber}`;
    }
    return unit.title
      ? `${normalized.documentTitle} · ${unit.title}`
      : normalized.documentTitle;
  };

  const url = (contentUnitId?: string): string =>
    (contentUnitId ? unitById.get(contentUnitId)?.canonicalUrl : undefined) ?? normalized.canonicalUrl;

  /* ------------------------- source passages ------------------------- */

  const blocksByUnit = new Map<string, typeof normalized.blocks>();
  for (const block of normalized.blocks) {
    const bucket = blocksByUnit.get(block.unitId);
    if (bucket) bucket.push(block);
    else blocksByUnit.set(block.unitId, [block]);
  }

  for (const [contentUnitId, blocks] of blocksByUnit) {
    const ordered = [...blocks].sort((a, b) => a.blockOrder - b.blockOrder);
    const text = ordered.map((block) => block.text).join("\n\n");
    const assessment = assessmentByUnit.get(contentUnitId);
    const forumQuality = assessment
      ? (assessment.helpfulness * 0.35 +
          assessment.constructiveness * 0.2 +
          assessment.automotiveRelevance * 0.2 +
          assessment.threadTopicRelevance * 0.15 +
          assessment.extractionConfidence * 0.1)
      : 0;
    chunks.push({
      ...base,
      id: stableId("chk", "passage", contentUnitId),
      chunkKind: "source_passage",
      documentId: normalized.documentId,
      contentUnitId,
      citationUrl: url(contentUnitId),
      citationLabel: label(contentUnitId),
      text,
      sourceBlockIds: ordered.map((block) => block.id),
      claimIds: [],
      qualityScore: forumQuality,
      credibilityScore:
        normalized.authorityTier <= 3
          ? 0.6
          : assessment
            ? forumQuality
            : 0.2,
      keywords: extractKeywords(text, [
        ...(assessment?.systems ?? []),
        ...(assessment?.components ?? []),
        ...(assessment?.symptoms ?? []),
        ...(assessment?.discourseRoles ?? []),
      ]),
      contentHash: contentHash(text),
      active: assessment?.retrievalDisposition !== "exclude",
    });
  }

  /* -------------------------- case summaries ------------------------- */

  for (const repairCase of normalized.repairCases) {
    const vehicle = normalized.vehicleMentions.find(
      (entry) => entry.id === repairCase.vehicleMentionId,
    );
    const vehicleLine = vehicle
      ? `Vehicle as described: ${[
          vehicle.modelCode ?? vehicle.chassisCode,
          vehicle.engineCode,
          vehicle.productionYear,
          vehicle.market,
          vehicle.pumpModel,
          `ACSD ${vehicle.acsdConfiguration}`,
        ]
          .filter(Boolean)
          .join(", ")}.`
      : "Vehicle not identified in this thread.";

    const lines = [
      `Case: ${repairCase.caseTitle}`,
      vehicleLine,
      `Complaint: ${repairCase.complaintSummary}`,
      repairCase.rootCauseSummary ? `Reported root cause: ${repairCase.rootCauseSummary}` : "",
      repairCase.repairSummary ? `Repair performed: ${repairCase.repairSummary}` : "",
      repairCase.outcomeSummary ? `Outcome: ${repairCase.outcomeSummary}` : "",
      `Status: ${repairCase.caseStatus} (basis: ${repairCase.resolutionBasis}).`,
    ].filter(Boolean);

    const text = lines.join("\n");
    const caseClaims = normalized.claims.filter(
      (claim) => claim.repairCaseId === repairCase.id,
    );
    const caseObservations = normalized.observations.filter(
      (entry) => entry.repairCaseId === repairCase.id,
    );

    chunks.push({
      ...base,
      id: stableId("chk", "case", repairCase.id),
      chunkKind: "case_summary",
      documentId: normalized.documentId,
      contentUnitId: repairCase.resolutionUnitId ?? repairCase.openedUnitId,
      citationUrl: url(repairCase.resolutionUnitId ?? repairCase.openedUnitId),
      citationLabel: label(repairCase.resolutionUnitId ?? repairCase.openedUnitId),
      repairCaseId: repairCase.id,
      text,
      sourceBlockIds: [
        ...new Set([
          ...caseClaims.flatMap((claim) => claim.sourceBlockIds),
          ...caseObservations.flatMap((entry) => entry.sourceBlockIds),
          ...(vehicle?.sourceBlockIds ?? []),
        ]),
      ],
      claimIds: caseClaims.map((claim) => claim.id),
      qualityScore: repairCase.qualityScore,
      credibilityScore: repairCase.qualityScore,
      keywords: extractKeywords(
        text,
        caseObservations.map((entry) => entry.label),
      ),
      contentHash: contentHash(text),
    });
  }

  /* --------------------- claim bundles + specs ----------------------- */

  const bySubject = new Map<string, NormalizedClaim[]>();
  for (const claim of normalized.claims) {
    const key = `${claim.subject.trim().toLowerCase()}::${
      claim.applicabilityId ?? "unscoped"
    }`;
    const bucket = bySubject.get(key);
    if (bucket) bucket.push(claim);
    else bySubject.set(key, [claim]);
  }

  for (const [groupKey, claims] of bySubject) {
    const ordered = [...claims].sort((a, b) => a.id.localeCompare(b.id));
    const unitAssessments = ordered
      .map((claim) => assessmentByUnit.get(claim.unitId))
      .filter((entry) => entry !== undefined);
    const text = [
      `Subject: ${ordered[0].subject}`,
      ...ordered.map(
        (claim) => `- ${claimSentence(claim)} — "${claim.sourceQuote}"`,
      ),
    ].join("\n");

    const qualityScore = Math.max(
      0,
      ...ordered.map((claim) => caseById.get(claim.repairCaseId ?? "")?.qualityScore ?? 0),
    );

    const numeric = ordered.filter(
      (claim) =>
        claim.valueNumeric !== undefined ||
        (claim.valueNumericMin !== undefined && claim.valueNumericMax !== undefined),
    );
    const isSpecification = numeric.length > 0;
    const specificationValueKey = numeric
      .map((claim) => {
        const value =
          claim.valueNumeric !== undefined
            ? String(claim.valueNumeric)
            : `${claim.valueNumericMin}-${claim.valueNumericMax}`;
        return `${value} ${claim.normalizedUnit ?? claim.unit ?? ""}`.trim();
      })
      .sort()
      .join("|");

    chunks.push({
      ...base,
      id: stableId(
        "chk",
        isSpecification ? "spec" : "claims",
        normalized.canonicalUrl,
        groupKey,
      ),
      chunkKind: isSpecification ? "specification" : "claim_bundle",
      documentId: normalized.documentId,
      contentUnitId: ordered[0].unitId,
      citationUrl: url(ordered[0].unitId),
      citationLabel: label(ordered[0].unitId),
      repairCaseId: ordered[0].repairCaseId,
      applicabilityId: ordered.find((claim) => claim.applicabilityId)?.applicabilityId,
      text,
      sourceBlockIds: [...new Set(ordered.flatMap((claim) => claim.sourceBlockIds))],
      claimIds: ordered.map((claim) => claim.id),
      qualityScore,
      credibilityScore:
        ordered.reduce(
          (sum, claim) => sum + CLAIM_BASIS_SCORE[claim.claimBasis],
          0,
        ) / ordered.length,
      keywords: extractKeywords(
        text,
        ordered.flatMap((claim) => [claim.unit ?? "", claim.objectText]),
      ),
      specificationSubject: isSpecification ? ordered[0].subject : undefined,
      specificationValueKey: isSpecification ? specificationValueKey : undefined,
      contentHash: contentHash(text),
      active:
        unitAssessments.length === 0 ||
        unitAssessments.some((entry) => entry.retrievalDisposition !== "exclude"),
    });
  }

  /* ------------------------ procedure fragments ---------------------- */

  for (const fragment of normalized.procedureFragments) {
    const text = [
      `Procedure fragment (${fragment.procedureKind}): ${fragment.title}`,
      fragment.prerequisites.length
        ? `Prerequisites: ${fragment.prerequisites.join("; ")}`
        : "",
      fragment.safetyNotes.length ? `Safety: ${fragment.safetyNotes.join("; ")}` : "",
      ...fragment.steps.map(
        (step) =>
          `${step.stepOrder}. ${step.instruction}${step.expectedResult ? ` → ${step.expectedResult}` : ""}${step.isSafetyCritical ? " [safety critical]" : ""}`,
      ),
    ]
      .filter(Boolean)
      .join("\n");

    const sourceBlockIds = [
      ...new Set(fragment.steps.flatMap((step) => step.sourceBlockIds)),
    ];

    chunks.push({
      ...base,
      id: stableId("chk", "proc", fragment.id),
      chunkKind: "procedure_fragment",
      documentId: normalized.documentId,
      contentUnitId: normalized.blocks.find((block) => block.id === sourceBlockIds[0])?.unitId,
      citationUrl: url(
        normalized.blocks.find((block) => block.id === sourceBlockIds[0])?.unitId,
      ),
      citationLabel: label(
        normalized.blocks.find((block) => block.id === sourceBlockIds[0])?.unitId,
      ),
      repairCaseId: fragment.repairCaseId,
      applicabilityId: fragment.applicabilityId,
      text,
      sourceBlockIds,
      claimIds: [
        ...new Set(
          fragment.steps.flatMap((step) => [
            ...step.toolClaimIds,
            ...step.specificationClaimIds,
          ]),
        ),
      ],
      qualityScore: caseById.get(fragment.repairCaseId ?? "")?.qualityScore ?? 0,
      credibilityScore:
        caseById.get(fragment.repairCaseId ?? "")?.qualityScore ??
        (normalized.authorityTier <= 3 ? 0.7 : 0.3),
      keywords: extractKeywords(text),
      contentHash: contentHash(text),
    });
  }

  return chunks.filter((chunk) => chunk.sourceBlockIds.length > 0);
}
