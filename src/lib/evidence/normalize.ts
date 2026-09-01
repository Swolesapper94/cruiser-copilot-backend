import { createHash } from "node:crypto";

import type {
  AssertionStrength,
  ClaimBasis,
  ClaimKind,
  ExtractionPayload,
} from "./schemas";

/**
 * Normalisation — validated wire payload -> stable application records.
 *
 * IDs are deterministic (content-addressed on the canonical URL + local id) so
 * that re-ingesting the same snapshot is idempotent and a citation stays valid
 * across reprocessing runs.
 */

export function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha1").update(parts.join("::")).digest("hex").slice(0, 16);
  return `${prefix}-${digest}`;
}

export function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface NormalizedApplicability {
  id: string;
  fingerprint: string;
  manufacturers: string[];
  modelNames: string[];
  submodels: string[];
  series: string[];
  modelCodes: string[];
  chassisCodes: string[];
  yearStart?: number;
  yearEnd?: number;
  productionDateStart?: string;
  productionDateEnd?: string;
  markets: string[];
  engineCodes: string[];
  transmissionCodes: string[];
  pumpModels: string[];
  emissionsConfigurations: string[];
  acsdStates: string[];
  completeness: "unknown" | "partial" | "sufficient";
}

export interface NormalizedBlock {
  id: string;
  documentId: string;
  unitId: string;
  blockOrder: number;
  blockKind: string;
  text: string;
  rawLocator: Record<string, unknown>;
  quotedDocumentId?: string;
  ocrDerived: boolean;
  contentHash: string;
}

export interface NormalizedContentUnit {
  id: string;
  documentId: string;
  canonicalUrl: string;
  externalId: string;
  unitKind: string;
  sequenceNumber?: number;
  title?: string;
  authorDisplayName?: string;
  createdAt?: string;
  isPrimary: boolean;
}

export interface NormalizedVehicleMention {
  id: string;
  documentId: string;
  manufacturer?: string;
  modelName?: string;
  submodel?: string;
  vin?: string;
  series?: string;
  modelCode?: string;
  chassisCode?: string;
  productionYear?: number;
  productionDate?: string;
  market?: string;
  engineCode?: string;
  pumpModel?: string;
  emissionsConfiguration?: string;
  acsdConfiguration: "present" | "absent" | "unknown";
  identificationMethod: string;
  confidence: number;
  sourceBlockIds: string[];
}

export interface NormalizedRepairCase {
  id: string;
  documentId: string;
  vehicleMentionId?: string;
  caseTitle: string;
  caseStatus: string;
  complaintSummary: string;
  rootCauseSummary?: string;
  repairSummary?: string;
  outcomeSummary?: string;
  resolutionBasis: string;
  resolutionConfidence: number;
  openedUnitId: string;
  resolutionUnitId?: string;
  qualityScore: number;
}

export interface NormalizedObservation {
  id: string;
  repairCaseId?: string;
  documentId: string;
  observationKind: string;
  label: string;
  valueText?: string;
  valueNumeric?: number;
  unit?: string;
  qualifiers: Record<string, unknown>;
  polarity: string;
  temporality: string;
  sourceBlockIds: string[];
  extractionConfidence: number;
}

export interface NormalizedClaim {
  id: string;
  documentId: string;
  unitId: string;
  repairCaseId?: string;
  claimKind: ClaimKind;
  claimBasis: ClaimBasis;
  subject: string;
  predicate: string;
  objectText: string;
  valueNumeric?: number;
  valueNumericMin?: number;
  valueNumericMax?: number;
  unit?: string;
  normalizedValue?: number;
  normalizedUnit?: string;
  applicabilityId?: string;
  assertionStrength: AssertionStrength;
  sourceAuthorityTier: number;
  sourceBlockIds: string[];
  sourceQuote: string;
  extractionConfidence: number;
  reviewStatus: "unreviewed" | "accepted" | "rejected" | "needs_review";
  safetyCritical: boolean;
}

export interface NormalizedProcedureFragment {
  id: string;
  documentId: string;
  repairCaseId?: string;
  title: string;
  procedureKind: string;
  applicabilityId?: string;
  prerequisites: string[];
  safetyNotes: string[];
  sourceAuthorityTier: number;
  reviewStatus: "unreviewed" | "accepted" | "rejected" | "needs_review";
  steps: Array<{
    stepOrder: number;
    instruction: string;
    expectedResult?: string;
    toolClaimIds: string[];
    specificationClaimIds: string[];
    sourceBlockIds: string[];
    isSafetyCritical: boolean;
  }>;
}

export interface NormalizedForumUnitAssessment {
  unitId: string;
  sourceBlockIds: string[];
  discourseRoles: string[];
  automotiveRelevance: number;
  threadTopicRelevance: number;
  constructiveness: number;
  helpfulness: number;
  evidenceStrength: string;
  sentiment: string;
  systems: string[];
  components: string[];
  symptoms: string[];
  retrievalDisposition: "include" | "downrank" | "exclude" | "human_review";
  dispositionReasons: string[];
  extractionConfidence: number;
}

export interface NormalizedExtraction {
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  authorityTier: number;
  snapshotId: string;
  canonicalUrl: string;
  documentId: string;
  documentTitle: string;
  extractorVersion: string;
  schemaVersion: string;
  applicability: NormalizedApplicability[];
  contentUnits: NormalizedContentUnit[];
  blocks: NormalizedBlock[];
  vehicleMentions: NormalizedVehicleMention[];
  repairCases: NormalizedRepairCase[];
  observations: NormalizedObservation[];
  claims: NormalizedClaim[];
  claimRelations: Array<{
    fromClaimId: string;
    toClaimId: string;
    relationKind: string;
    confidence: number;
  }>;
  procedureFragments: NormalizedProcedureFragment[];
  forumUnitAssessments: NormalizedForumUnitAssessment[];
  forumThreadAssessment?: ExtractionPayload["forum_thread_assessment"];
}

function optional<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

function applicabilityFingerprint(
  entry: ExtractionPayload["applicability"][number],
): string {
  return contentHash(
    JSON.stringify([
      [...entry.series].sort(),
      [...entry.manufacturers].sort(),
      [...entry.model_names].sort(),
      [...entry.submodels].sort(),
      [...entry.model_codes].sort(),
      [...entry.chassis_codes].sort(),
      entry.year_start ?? null,
      entry.year_end ?? null,
      entry.production_date_start ?? null,
      entry.production_date_end ?? null,
      [...entry.markets].sort(),
      [...entry.engine_codes].sort(),
      [...entry.transmission_codes].sort(),
      [...entry.pump_models].sort(),
      [...entry.emissions_configurations].sort(),
      [...entry.acsd_states].sort(),
    ]),
  );
}

/**
 * @param qualityByCase repair-case quality scores from ./quality.ts
 * @param reviewedLocalIds claim local ids that a review trigger flagged
 */
export function normalizeExtraction(
  payload: ExtractionPayload,
  options: {
    qualityByCase?: ReadonlyMap<string, number>;
    needsReviewLocalIds?: ReadonlySet<string>;
  } = {},
): NormalizedExtraction {
  const url = payload.snapshot.canonical_url;
  const quality = options.qualityByCase ?? new Map<string, number>();
  const needsReview = options.needsReviewLocalIds ?? new Set<string>();

  const sourceId = stableId("src", payload.source.base_url);
  const snapshotId = stableId("snap", url, payload.snapshot.content_hash);
  const documentId = stableId("doc", url);

  const unitIdByLocal = new Map<string, string>();
  const contentUnits: NormalizedContentUnit[] = payload.content_units.map((unit) => {
    const id = stableId("unit", url, unit.external_id);
    unitIdByLocal.set(unit.local_id, id);
    return {
      id,
      documentId,
      canonicalUrl: unit.sequence_number
        ? unit.unit_kind === "forum_post"
          ? `${url}#post-${unit.sequence_number}`
          : unit.unit_kind === "manual_page"
            ? `${url}#page=${unit.sequence_number}`
            : `${url}#unit-${unit.sequence_number}`
        : url,
      externalId: unit.external_id,
      unitKind: unit.unit_kind,
      sequenceNumber: optional(unit.sequence_number),
      title: optional(unit.title),
      authorDisplayName: optional(unit.author_display_name),
      createdAt: optional(unit.created_at_source),
      isPrimary: unit.is_primary,
    };
  });

  const blockIdByLocal = new Map<string, string>();
  const blocks: NormalizedBlock[] = [];
  for (const unit of payload.content_units) {
    const unitId = unitIdByLocal.get(unit.local_id) as string;
    unit.blocks.forEach((block, index) => {
      const id = stableId("blk", url, unit.external_id, String(index));
      blockIdByLocal.set(block.local_id, id);
      blocks.push({
        id,
        documentId: unitId,
        unitId,
        blockOrder: index,
        blockKind: block.block_kind,
        text: block.text,
        rawLocator: block.raw_locator,
        quotedDocumentId: block.quoted_unit_local_id
          ? unitIdByLocal.get(block.quoted_unit_local_id)
          : undefined,
        ocrDerived: block.ocr_derived,
        contentHash: contentHash(block.text),
      });
    });
  }

  const applicabilityIdByLocal = new Map<string, string>();
  const applicability: NormalizedApplicability[] = payload.applicability.map((entry) => {
    const fingerprint = applicabilityFingerprint(entry);
    const id = stableId("app", fingerprint);
    applicabilityIdByLocal.set(entry.local_id, id);
    return {
      id,
      fingerprint,
      manufacturers: entry.manufacturers,
      modelNames: entry.model_names,
      submodels: entry.submodels,
      series: entry.series,
      modelCodes: entry.model_codes,
      chassisCodes: entry.chassis_codes,
      yearStart: optional(entry.year_start),
      yearEnd: optional(entry.year_end),
      productionDateStart: optional(entry.production_date_start),
      productionDateEnd: optional(entry.production_date_end),
      markets: entry.markets,
      engineCodes: entry.engine_codes,
      transmissionCodes: entry.transmission_codes,
      pumpModels: entry.pump_models,
      emissionsConfigurations: entry.emissions_configurations,
      acsdStates: entry.acsd_states,
      completeness: entry.completeness,
    };
  });

  const mapBlocks = (ids: readonly string[]): string[] =>
    ids.map((id) => blockIdByLocal.get(id)).filter((id): id is string => Boolean(id));

  const vehicleIdByLocal = new Map<string, string>();
  const vehicleMentions: NormalizedVehicleMention[] = payload.vehicle_mentions.map(
    (mention) => {
      const id = stableId("veh", url, mention.local_id);
      vehicleIdByLocal.set(mention.local_id, id);
      return {
        id,
        documentId: documentId,
        manufacturer: optional(mention.manufacturer),
        modelName: optional(mention.model_name),
        submodel: optional(mention.submodel),
        vin: optional(mention.vin),
        series: optional(mention.series),
        modelCode: optional(mention.model_code),
        chassisCode: optional(mention.chassis_code),
        productionYear: optional(mention.production_year),
        productionDate: optional(mention.production_date),
        market: optional(mention.market),
        engineCode: optional(mention.engine_code),
        pumpModel: optional(mention.pump_model),
        emissionsConfiguration: optional(mention.emissions_configuration),
        acsdConfiguration: mention.acsd_configuration,
        identificationMethod: mention.identification_method,
        confidence: mention.confidence,
        sourceBlockIds: mapBlocks(mention.source_block_local_ids),
      };
    },
  );

  const caseIdByLocal = new Map<string, string>();
  const repairCases: NormalizedRepairCase[] = payload.repair_cases.map((entry) => {
    const id = stableId("case", url, entry.local_id);
    caseIdByLocal.set(entry.local_id, id);
    return {
      id,
      documentId,
      vehicleMentionId: entry.vehicle_local_id
        ? vehicleIdByLocal.get(entry.vehicle_local_id)
        : undefined,
      caseTitle: entry.case_title,
      caseStatus: entry.case_status,
      complaintSummary: entry.complaint_summary,
      rootCauseSummary: optional(entry.root_cause_summary),
      repairSummary: optional(entry.repair_summary),
      outcomeSummary: optional(entry.outcome_summary),
      resolutionBasis: entry.resolution_basis,
      resolutionConfidence: entry.resolution_confidence,
      openedUnitId: unitIdByLocal.get(entry.opened_unit_local_id) as string,
      resolutionUnitId: entry.resolution_unit_local_id
        ? unitIdByLocal.get(entry.resolution_unit_local_id)
        : undefined,
      qualityScore: quality.get(entry.local_id) ?? 0,
    };
  });

  const observations: NormalizedObservation[] = payload.observations.map((entry) => ({
    id: stableId("obs", url, entry.local_id),
    repairCaseId: entry.repair_case_local_id
      ? caseIdByLocal.get(entry.repair_case_local_id)
      : undefined,
    documentId: documentId,
    observationKind: entry.observation_kind,
    label: entry.label,
    valueText: optional(entry.value_text),
    valueNumeric: optional(entry.value_numeric),
    unit: optional(entry.unit),
    qualifiers: entry.qualifiers,
    polarity: entry.polarity,
    temporality: entry.temporality,
    sourceBlockIds: mapBlocks(entry.source_block_local_ids),
    extractionConfidence: entry.extraction_confidence,
  }));

  const blockToUnitId = new Map(blocks.map((block) => [block.id, block.unitId]));

  const claimIdByLocal = new Map<string, string>();
  const claims: NormalizedClaim[] = payload.claims.map((claim) => {
    const id = stableId("clm", url, claim.local_id);
    claimIdByLocal.set(claim.local_id, id);
    const sourceBlockIds = mapBlocks(claim.source_block_local_ids);
    return {
      id,
      documentId: documentId,
      unitId: blockToUnitId.get(sourceBlockIds[0] ?? "") ?? documentId,
      repairCaseId: claim.repair_case_local_id
        ? caseIdByLocal.get(claim.repair_case_local_id)
        : undefined,
      claimKind: claim.claim_kind,
      claimBasis: claim.claim_basis,
      subject: claim.subject,
      predicate: claim.predicate,
      objectText: claim.object_text,
      valueNumeric: optional(claim.value_numeric),
      valueNumericMin: optional(claim.value_numeric_min),
      valueNumericMax: optional(claim.value_numeric_max),
      unit: optional(claim.unit),
      normalizedValue: optional(claim.normalized_value),
      normalizedUnit: optional(claim.normalized_unit),
      applicabilityId: claim.applicability_local_id
        ? applicabilityIdByLocal.get(claim.applicability_local_id)
        : undefined,
      assertionStrength: claim.assertion_strength,
      sourceAuthorityTier: payload.source.authority_tier,
      sourceBlockIds,
      sourceQuote: claim.source_quote,
      extractionConfidence: claim.extraction_confidence,
      reviewStatus: needsReview.has(claim.local_id) ? "needs_review" : "unreviewed",
      safetyCritical: claim.safety_critical || claim.claim_kind === "safety_warning",
    };
  });

  const procedureFragments: NormalizedProcedureFragment[] =
    payload.procedure_fragments.map((fragment) => ({
      id: stableId("prc", url, fragment.local_id),
      documentId: documentId,
      repairCaseId: fragment.repair_case_local_id
        ? caseIdByLocal.get(fragment.repair_case_local_id)
        : undefined,
      title: fragment.title,
      procedureKind: fragment.procedure_kind,
      applicabilityId: fragment.applicability_local_id
        ? applicabilityIdByLocal.get(fragment.applicability_local_id)
        : undefined,
      prerequisites: fragment.prerequisites,
      safetyNotes: fragment.safety_notes,
      sourceAuthorityTier: payload.source.authority_tier,
      reviewStatus: needsReview.has(fragment.local_id) ? "needs_review" : "unreviewed",
      steps: [...fragment.steps]
        .sort((a, b) => a.step_order - b.step_order)
        .map((step) => ({
          stepOrder: step.step_order,
          instruction: step.instruction,
          expectedResult: optional(step.expected_result),
          toolClaimIds: step.tool_claim_local_ids
            .map((id) => claimIdByLocal.get(id))
            .filter((id): id is string => Boolean(id)),
          specificationClaimIds: step.specification_claim_local_ids
            .map((id) => claimIdByLocal.get(id))
            .filter((id): id is string => Boolean(id)),
          sourceBlockIds: mapBlocks(step.source_block_local_ids),
          isSafetyCritical: step.is_safety_critical,
        })),
    }));

  const forumUnitAssessments: NormalizedForumUnitAssessment[] =
    payload.forum_unit_assessments.map((assessment) => ({
      unitId: unitIdByLocal.get(assessment.content_unit_local_id) as string,
      sourceBlockIds: mapBlocks(assessment.source_block_local_ids),
      discourseRoles: assessment.discourse_roles,
      automotiveRelevance: assessment.automotive_relevance,
      threadTopicRelevance: assessment.thread_topic_relevance,
      constructiveness: assessment.constructiveness,
      helpfulness: assessment.helpfulness,
      evidenceStrength: assessment.evidence_strength,
      sentiment: assessment.sentiment,
      systems: assessment.systems,
      components: assessment.components,
      symptoms: assessment.symptoms,
      retrievalDisposition: assessment.retrieval_disposition,
      dispositionReasons: assessment.disposition_reasons,
      extractionConfidence: assessment.extraction_confidence,
    }));

  return {
    sourceId,
    sourceName: payload.source.name,
    sourceKind: payload.source.source_kind,
    authorityTier: payload.source.authority_tier,
    snapshotId,
    canonicalUrl: url,
    documentId,
    documentTitle: payload.document.title,
    extractorVersion: payload.extractor_version,
    schemaVersion: payload.schema_version,
    applicability,
    contentUnits,
    blocks,
    vehicleMentions,
    repairCases,
    observations,
    claims,
    claimRelations: payload.claim_relations.map((relation) => ({
      fromClaimId: claimIdByLocal.get(relation.from_claim_local_id) as string,
      toClaimId: claimIdByLocal.get(relation.to_claim_local_id) as string,
      relationKind: relation.relation_kind,
      confidence: relation.confidence,
    })),
    procedureFragments,
    forumUnitAssessments,
    forumThreadAssessment: optional(payload.forum_thread_assessment),
  };
}
