import type { DiagnosticCaseQuery, Vehicle } from "@/types";
import { evaluateApplicability, type ApplicabilityResult } from "@/lib/retrieval/applicability";
import { semanticCandidates } from "@/lib/retrieval/semantic";

import type { RetrievalChunk } from "./chunks";
import type { NormalizedApplicability } from "./normalize";
import { EvidenceStore, evidenceStore } from "./store";

/**
 * Evidence retrieval.
 *
 * OEM material and community material are retrieved into SEPARATE channels and
 * never blended. Low-authority practical guidance is not filtered away — it is
 * labelled, so the answer layer can show "what the manual says" beside "what
 * people report" without one masquerading as the other.
 */

/** Tier 1–3 is Toyota material; 4+ is community/derived. See retrieval/authority.ts */
const OEM_MAX_TIER = 3;

export interface EvidenceRetrievalRequest {
  vehicle: Vehicle;
  caseQuery?: DiagnosticCaseQuery;
  keywords?: string[];
  specificationSubject?: string;
  includeUnresolved?: boolean;
  limitPerChannel?: number;
  includeHeld?: boolean;
}

export interface ScoredChunk {
  chunk: RetrievalChunk;
  score: number;
  components: {
    exactMatch: number;
    applicability: number;
    authority: number;
    resolutionQuality: number;
    evidenceCredibility: number;
    semantic: number;
    conflictPenalty: number;
  };
  matchedKeywords: string[];
  applicability: ApplicabilityResult;
  /** True when only embeddings surfaced this chunk. */
  semanticOnly: boolean;
}

export interface EvidenceConflict {
  subject: string;
  alternatives: Array<{
    chunkId: string;
    value: string;
    citationUrl: string;
    citationLabel: string;
    authorityTier: number;
  }>;
  missingApplicabilityFields: string[];
  resolutionStatus: "resolved" | "unresolved";
  explanation: string;
}

export interface EvidenceRetrievalResult {
  /** Toyota material. Authoritative when applicability is settled. */
  oem: ScoredChunk[];
  /** Forum / technician material. Never overrides the OEM channel. */
  community: ScoredChunk[];
  conflicts: EvidenceConflict[];
  /** True when nothing survived the applicability filter. */
  empty: boolean;
}

/** Empty applicability means "not specified", so it can never settle anything. */
function toApplicabilityShape(entry: NormalizedApplicability | undefined): {
  completeness: "unknown" | "partial" | "sufficient";
  manufacturers: string[];
  modelNames: string[];
  submodels: string[];
  modelCodes: string[];
  engineCodes: string[];
  markets: string[];
  pumpModels: string[];
  acsdStates: Array<"present" | "absent" | "unknown">;
  emissionsConfigurations: string[];
  yearStart?: number;
  yearEnd?: number;
} {
  return {
    completeness: entry?.completeness ?? "unknown",
    manufacturers: entry?.manufacturers ?? [],
    modelNames: entry?.modelNames ?? [],
    submodels: entry?.submodels ?? [],
    modelCodes: entry ? [...entry.modelCodes, ...entry.chassisCodes] : [],
    engineCodes: entry?.engineCodes ?? [],
    markets: entry?.markets ?? [],
    pumpModels: entry?.pumpModels ?? [],
    acsdStates: (entry?.acsdStates ?? []) as Array<
      "present" | "absent" | "unknown"
    >,
    emissionsConfigurations: entry?.emissionsConfigurations ?? [],
    yearStart: entry?.yearStart,
    yearEnd: entry?.yearEnd,
  };
}

function matchKeywords(chunk: RetrievalChunk, keywords: readonly string[]): string[] {
  if (keywords.length === 0) return [];
  const haystack = new Set(chunk.keywords);
  const text = chunk.text.toLowerCase();
  return keywords.filter((keyword) => {
    const needle = keyword.trim().toLowerCase();
    return needle.length > 0 && (haystack.has(needle) || text.includes(needle));
  });
}

export function retrieveEvidence(
  request: EvidenceRetrievalRequest,
  store: EvidenceStore = evidenceStore,
): EvidenceRetrievalResult {
  const keywords = [
    ...(request.keywords ?? []),
    ...(request.caseQuery?.symptomTerms ?? []),
    ...(request.caseQuery?.affectedSystems ?? []),
    ...(request.caseQuery?.diagnosticCodes ?? []),
    ...(request.caseQuery?.userObservations ?? []),
    ...(request.caseQuery?.machineObservations ?? []),
    ...(request.caseQuery?.complaint ? [request.caseQuery.complaint] : []),
  ];
  const includeUnresolved = request.includeUnresolved ?? true;
  const limit = request.limitPerChannel ?? 8;
  const semanticIds = new Set(semanticCandidates(keywords.join(" ")));

  const scored: ScoredChunk[] = [];

  for (const chunk of store.activeChunks({ includeHeld: request.includeHeld })) {
    const applicability = evaluateApplicability(
      toApplicabilityShape(store.applicability(chunk.applicabilityId)),
      request.vehicle,
    );
    if (applicability.verdict === "not-applicable") continue;
    if (applicability.verdict === "unresolved" && !includeUnresolved) continue;

    const matchedKeywords = matchKeywords(chunk, keywords);
    const subjectMatch =
      (request.specificationSubject ??
        request.caseQuery?.requestedSpecificationSubject) !== undefined &&
      chunk.specificationSubject?.trim().toLowerCase() ===
        (
          request.specificationSubject ??
          request.caseQuery?.requestedSpecificationSubject
        )?.trim().toLowerCase();
    const semantic = semanticIds.has(chunk.id);

    if (matchedKeywords.length === 0 && !subjectMatch && !semantic) continue;

    const components = {
      exactMatch: matchedKeywords.length * 3 + (subjectMatch ? 6 : 0),
      applicability:
        applicability.matchStrength * 2 -
        (applicability.verdict === "unresolved" ? 2 : 0),
      authority: 8 - chunk.authorityTier,
      resolutionQuality: chunk.qualityScore * 4,
      evidenceCredibility: chunk.credibilityScore * 4,
      semantic: semantic && matchedKeywords.length === 0 ? 1 : 0,
      conflictPenalty: 0,
    };

    scored.push({
      chunk,
      score: 0,
      components,
      matchedKeywords,
      applicability,
      semanticOnly: semantic && matchedKeywords.length === 0 && !subjectMatch,
    });
  }

  const conflicts = detectEvidenceConflicts(scored);
  const conflictedChunkIds = new Set(
    conflicts
      .filter((conflict) => conflict.resolutionStatus === "unresolved")
      .flatMap((conflict) => conflict.alternatives.map((entry) => entry.chunkId)),
  );

  for (const entry of scored) {
    entry.components.conflictPenalty = conflictedChunkIds.has(entry.chunk.id) ? 3 : 0;
    entry.score = Number(
      (
        entry.components.exactMatch +
        entry.components.applicability +
        entry.components.authority +
        entry.components.resolutionQuality +
        entry.components.evidenceCredibility +
        entry.components.semantic -
        entry.components.conflictPenalty
      ).toFixed(3),
    );
  }

  const rank = (a: ScoredChunk, b: ScoredChunk): number => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.chunk.authorityTier !== b.chunk.authorityTier) {
      return a.chunk.authorityTier - b.chunk.authorityTier;
    }
    return a.chunk.id.localeCompare(b.chunk.id);
  };

  const oem = scored
    .filter((entry) => entry.chunk.authorityTier <= OEM_MAX_TIER)
    .sort(rank)
    .slice(0, limit);
  const community = scored
    .filter((entry) => entry.chunk.authorityTier > OEM_MAX_TIER)
    .sort(rank)
    .slice(0, limit);

  return {
    oem,
    community,
    conflicts,
    empty: oem.length === 0 && community.length === 0,
  };
}

/**
 * A conflict is only "resolved" when exactly one value survives at the highest
 * authority present AND every applicability field is settled. Otherwise the
 * disagreement is surfaced instead of silently picking a winner.
 */
export function detectEvidenceConflicts(
  candidates: readonly ScoredChunk[],
): EvidenceConflict[] {
  const bySubject = new Map<string, ScoredChunk[]>();
  for (const entry of candidates) {
    const subject = entry.chunk.specificationSubject;
    if (!subject) continue;
    const key = subject.trim().toLowerCase();
    const bucket = bySubject.get(key);
    if (bucket) bucket.push(entry);
    else bySubject.set(key, [entry]);
  }

  const conflicts: EvidenceConflict[] = [];

  for (const [subject, entries] of bySubject) {
    const alternatives = entries.map((entry) => ({
      chunkId: entry.chunk.id,
      value: entry.chunk.text,
      citationUrl: entry.chunk.citationUrl,
      citationLabel: entry.chunk.citationLabel,
      authorityTier: entry.chunk.authorityTier,
    }));

    const distinct = new Set(
      entries.map(
        (entry) => entry.chunk.specificationValueKey ?? entry.chunk.text,
      ),
    );
    if (distinct.size < 2) continue;

    const missingApplicabilityFields = [
      ...new Set(entries.flatMap((entry) => entry.applicability.unresolvedFields)),
    ].sort();

    const topTier = Math.min(...entries.map((entry) => entry.chunk.authorityTier));
    const survivingAtTopTier = new Set(
      entries
        .filter(
          (entry) =>
            entry.chunk.authorityTier === topTier &&
            entry.applicability.verdict === "applicable",
        )
        .map(
          (entry) =>
            entry.chunk.specificationValueKey ?? entry.chunk.text,
        ),
    );

    const resolved =
      missingApplicabilityFields.length === 0 &&
      survivingAtTopTier.size === 1 &&
      topTier <= OEM_MAX_TIER;

    conflicts.push({
      subject,
      alternatives,
      missingApplicabilityFields,
      resolutionStatus: resolved ? "resolved" : "unresolved",
      explanation: explainConflict({
        subject,
        missingApplicabilityFields,
        survivingCount: survivingAtTopTier.size,
        topTier,
      }),
    });
  }

  return conflicts.sort((a, b) => a.subject.localeCompare(b.subject));
}

function explainConflict(input: {
  subject: string;
  missingApplicabilityFields: string[];
  survivingCount: number;
  topTier: number;
}): string {
  const reasons: string[] = [];
  if (input.missingApplicabilityFields.length > 0) {
    reasons.push(
      `the vehicle record is missing ${input.missingApplicabilityFields.join(", ")}`,
    );
  }
  if (input.survivingCount > 1) {
    reasons.push("more than one source still matches this vehicle");
  }
  if (input.topTier > OEM_MAX_TIER) {
    reasons.push("no Toyota source is available for this figure — only community reports");
  }
  if (reasons.length === 0) {
    reasons.push("the sources disagree and the difference has not been explained");
  }
  return `Sources disagree on "${input.subject}". Cruiser Copilot will not choose a value because ${reasons.join("; ")}.`;
}
