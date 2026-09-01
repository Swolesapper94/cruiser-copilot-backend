import { z } from "zod";

/**
 * Source-neutral extraction contract — `evidence-extraction.v2`.
 *
 * Adapters establish source-preserving structure. A semantic extractor then
 * emits atomic observations, claims and procedure fragments that cite that
 * structure. Forum posts, manual pages and manual sections use the same
 * `content_units` envelope; none is forced to masquerade as another.
 */

export const EXTRACTION_SCHEMA_VERSION = "evidence-extraction.v2";

const localId = z.string().min(1).max(120);
const confidence = z.number().min(0).max(1);
const nonEmpty = z.string().min(1);

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export const sourceKindSchema = z.enum([
  "service_bulletin",
  "oem_manual",
  "oem_technical",
  "verified_case",
  "technician",
  "forum",
  "article",
  "general",
]);

export const documentKindSchema = z.enum([
  "forum_thread",
  "manual",
  "service_bulletin",
  "article",
  "case_record",
]);

export const contentUnitKindSchema = z.enum([
  "forum_post",
  "manual_page",
  "manual_section",
  "article_section",
  "case_event",
]);

export const blockKindSchema = z.enum([
  "paragraph",
  "heading",
  "quote",
  "list",
  "table",
  "code",
  "caption",
  "notice",
  "warning",
  "specification",
  "procedure_step",
]);

export const identificationMethodSchema = z.enum([
  "vin_decoded",
  "identification_plate",
  "user_confirmed",
  "explicit",
  "decoded",
  "visual_inference",
  "document_applicability",
  "thread_context",
]);

export const acsdStateSchema = z.enum(["present", "absent", "unknown"]);
export const applicabilityCompletenessSchema = z.enum([
  "unknown",
  "partial",
  "sufficient",
]);
export const repairCaseStatusSchema = z.enum([
  "open",
  "diagnosing",
  "resolved",
  "partially_resolved",
  "unresolved",
  "abandoned",
  "not_a_case",
]);
export const resolutionBasisSchema = z.enum([
  "author_confirmed",
  "followup_improvement",
  "community_consensus",
  "extractor_inference",
  "none",
]);
export const observationKindSchema = z.enum([
  "symptom",
  "condition",
  "measurement",
  "diagnostic_code",
  "visual",
  "audio",
  "inspection_result",
]);
export const polaritySchema = z.enum(["present", "absent", "uncertain"]);
export const temporalitySchema = z.enum([
  "before_repair",
  "during_test",
  "after_repair",
  "unknown",
]);
export const claimKindSchema = z.enum([
  "diagnostic_hypothesis",
  "specification",
  "measurement",
  "test_result",
  "root_cause",
  "repair_action",
  "repair_outcome",
  "tool_requirement",
  "tool_substitution",
  "part_reference",
  "safety_warning",
  "practical_tip",
  "applicability_statement",
]);
export const assertionStrengthSchema = z.enum([
  "reported",
  "suggested",
  "measured",
  "observed",
  "confirmed",
  "quoted",
]);
export const claimBasisSchema = z.enum([
  "oem_published",
  "measured_by_author",
  "performed_by_author",
  "outcome_confirmed",
  "community_corroborated",
  "suggestion_only",
  "hearsay",
  "unattributed_quote",
  "speculation",
]);
export const claimRelationKindSchema = z.enum([
  "supports",
  "contradicts",
  "corrects",
  "refines",
  "duplicates",
  "caused_by",
  "resolved_by",
]);
export const procedureKindSchema = z.enum([
  "diagnostic_test",
  "inspection",
  "repair",
  "adjustment",
  "validation",
]);
export const reviewFlagKindSchema = z.enum([
  "exact_specification_from_community",
  "conflicting_claims",
  "missing_applicability",
  "safety_critical_procedure",
  "confirmed_root_cause",
  "ocr_derived_value",
  "unverifiable_oem_quote",
  "unit_normalization",
  "speculative_claim",
  "parse_incomplete",
]);
export const evidenceReviewStatusSchema = z.enum([
  "unreviewed",
  "accepted",
  "rejected",
  "needs_review",
]);
export const forumThreadKindSchema = z.enum([
  "repair_case",
  "diagnostic_question",
  "how_to",
  "technical_discussion",
  "build_thread",
  "parts_discussion",
  "general_discussion",
  "classified",
  "site_meta",
  "unknown",
]);
export const forumDiscourseRoleSchema = z.enum([
  "problem_report",
  "clarifying_question",
  "diagnostic_hypothesis",
  "test_instruction",
  "test_result",
  "measurement",
  "repair_action",
  "outcome_report",
  "correction",
  "corroboration",
  "reference",
  "opinion",
  "banter",
  "argument",
  "moderation",
  "signature",
  "spam",
  "unknown",
]);
export const forumEvidenceStrengthSchema = z.enum([
  "none",
  "anecdotal",
  "reasoned",
  "measured",
  "documented",
  "outcome_confirmed",
]);
export const forumSentimentSchema = z.enum([
  "negative",
  "frustrated",
  "neutral",
  "constructive",
  "positive",
  "mixed",
]);
export const forumAuthorRoleSchema = z.enum([
  "original_poster",
  "participant",
  "moderator",
  "vendor",
  "unknown",
]);
export const retrievalDispositionSchema = z.enum([
  "include",
  "downrank",
  "exclude",
  "human_review",
]);

/* ------------------------------------------------------------------ */
/* Applicability                                                       */
/* ------------------------------------------------------------------ */

/** Empty arrays mean "not specified"; they never mean "all vehicles". */
export const extractedApplicabilitySchema = z.object({
  local_id: localId,
  manufacturers: z.array(nonEmpty).default([]),
  model_names: z.array(nonEmpty).default([]),
  submodels: z.array(nonEmpty).default([]),
  series: z.array(nonEmpty).default([]),
  model_codes: z.array(nonEmpty).default([]),
  chassis_codes: z.array(nonEmpty).default([]),
  year_start: z.number().int().min(1950).max(2100).nullish(),
  year_end: z.number().int().min(1950).max(2100).nullish(),
  production_date_start: z.string().date().nullish(),
  production_date_end: z.string().date().nullish(),
  markets: z.array(nonEmpty).default([]),
  engine_codes: z.array(nonEmpty).default([]),
  transmission_codes: z.array(nonEmpty).default([]),
  pump_models: z.array(nonEmpty).default([]),
  emissions_configurations: z.array(nonEmpty).default([]),
  acsd_states: z.array(acsdStateSchema).default([]),
  required_modifications: z.array(nonEmpty).default([]),
  excluded_modifications: z.array(nonEmpty).default([]),
  completeness: applicabilityCompletenessSchema.default("unknown"),
});

/* ------------------------------------------------------------------ */
/* Source-preserving document structure                                */
/* ------------------------------------------------------------------ */

export const extractedBlockSchema = z.object({
  local_id: localId,
  block_kind: blockKindSchema,
  text: nonEmpty,
  /** CSS/XPath for HTML or page + bounding box for paginated documents. */
  raw_locator: z.record(z.string(), z.unknown()).default({}),
  quoted_unit_local_id: localId.nullish(),
  ocr_derived: z.boolean().default(false),
});

export const extractedContentUnitSchema = z.object({
  local_id: localId,
  unit_kind: contentUnitKindSchema,
  external_id: nonEmpty,
  sequence_number: z.number().int().positive().nullish(),
  parent_unit_local_id: localId.nullish(),
  title: z.string().nullish(),
  author_external_id: z.string().nullish(),
  author_display_name: z.string().nullish(),
  created_at_source: z.string().datetime().nullish(),
  edited_at_source: z.string().datetime().nullish(),
  is_primary: z.boolean().default(false),
  is_moderator: z.boolean().nullish(),
  reaction_count: z.number().int().min(0).nullish(),
  blocks: z.array(extractedBlockSchema).min(1),
});

export const extractedDocumentSchema = z.object({
  title: nonEmpty,
  document_kind: documentKindSchema,
  canonical_url: z.string().url(),
  external_id: z.string().nullish(),
  manufacturer: z.string().nullish(),
  document_number: z.string().nullish(),
  edition: z.string().nullish(),
  publication_date: z.string().date().nullish(),
  created_at_source: z.string().datetime().nullish(),
  updated_at_source: z.string().datetime().nullish(),
  language: z.string().max(16).default("en"),
});

export const extractedMediaSchema = z.object({
  local_id: localId,
  content_unit_local_id: localId,
  asset_kind: z.enum(["image", "diagram", "video", "audio", "file"]),
  source_url: z.string().url(),
  caption: z.string().nullish(),
  alt_text: z.string().nullish(),
  ocr_text: z.string().nullish(),
  rights_status: z.enum(["unknown", "permitted", "restricted"]).default("unknown"),
});

/* ------------------------------------------------------------------ */
/* Automotive knowledge                                                */
/* ------------------------------------------------------------------ */

export const extractedVehicleMentionSchema = z.object({
  local_id: localId,
  manufacturer: z.string().nullish(),
  model_name: z.string().nullish(),
  submodel: z.string().nullish(),
  vin: z.string().max(32).nullish(),
  series: z.string().nullish(),
  model_code: z.string().nullish(),
  chassis_code: z.string().nullish(),
  production_year: z.number().int().min(1950).max(2100).nullish(),
  production_date: z.string().date().nullish(),
  market: z.string().nullish(),
  engine_code: z.string().nullish(),
  transmission_code: z.string().nullish(),
  pump_model: z.string().nullish(),
  emissions_configuration: z.string().nullish(),
  acsd_configuration: acsdStateSchema.default("unknown"),
  modifications: z.array(nonEmpty).default([]),
  identification_method: identificationMethodSchema,
  confidence,
  source_block_local_ids: z.array(localId).min(1),
});

export const extractedRepairCaseSchema = z.object({
  local_id: localId,
  vehicle_local_id: localId.nullish(),
  case_title: nonEmpty,
  case_status: repairCaseStatusSchema.default("open"),
  complaint_summary: nonEmpty,
  root_cause_summary: z.string().nullish(),
  repair_summary: z.string().nullish(),
  outcome_summary: z.string().nullish(),
  resolution_confidence: confidence.default(0),
  resolution_basis: resolutionBasisSchema.default("none"),
  opened_unit_local_id: localId,
  resolution_unit_local_id: localId.nullish(),
  followup_days: z.number().int().min(0).nullish(),
});

export const extractedObservationSchema = z.object({
  local_id: localId,
  repair_case_local_id: localId.nullish(),
  observation_kind: observationKindSchema,
  concept_code: z.string().nullish(),
  label: nonEmpty,
  value_text: z.string().nullish(),
  value_numeric: z.number().nullish(),
  unit: z.string().nullish(),
  qualifiers: z.record(z.string(), z.unknown()).default({}),
  polarity: polaritySchema.default("present"),
  temporality: temporalitySchema.default("unknown"),
  source_block_local_ids: z.array(localId).min(1),
  extraction_confidence: confidence,
});

/** Every numeric value or independently applicable statement is its own claim. */
export const extractedClaimSchema = z.object({
  local_id: localId,
  repair_case_local_id: localId.nullish(),
  claim_kind: claimKindSchema,
  claim_basis: claimBasisSchema,
  subject: nonEmpty,
  predicate: nonEmpty,
  object_text: nonEmpty,
  value_numeric: z.number().nullish(),
  value_numeric_min: z.number().nullish(),
  value_numeric_max: z.number().nullish(),
  /** Verbatim unit/value remain intact even when a normalized value is added. */
  unit: z.string().nullish(),
  normalized_value: z.number().nullish(),
  normalized_unit: z.string().nullish(),
  applicability_local_id: localId.nullish(),
  assertion_strength: assertionStrengthSchema,
  source_block_local_ids: z.array(localId).min(1),
  source_quote: nonEmpty,
  extraction_confidence: confidence,
  quotes_external_authority: z.boolean().default(false),
  safety_critical: z.boolean().default(false),
});

export const extractedClaimRelationSchema = z.object({
  from_claim_local_id: localId,
  to_claim_local_id: localId,
  relation_kind: claimRelationKindSchema,
  source_block_local_ids: z.array(localId).min(1),
  confidence,
});

export const extractedProcedureStepSchema = z.object({
  step_order: z.number().int().min(1),
  instruction: nonEmpty,
  expected_result: z.string().nullish(),
  tool_claim_local_ids: z.array(localId).default([]),
  specification_claim_local_ids: z.array(localId).default([]),
  media_local_ids: z.array(localId).default([]),
  source_block_local_ids: z.array(localId).min(1),
  is_safety_critical: z.boolean().default(false),
});

export const extractedProcedureFragmentSchema = z.object({
  local_id: localId,
  repair_case_local_id: localId.nullish(),
  title: nonEmpty,
  procedure_kind: procedureKindSchema,
  applicability_local_id: localId.nullish(),
  prerequisites: z.array(nonEmpty).default([]),
  safety_notes: z.array(nonEmpty).default([]),
  steps: z.array(extractedProcedureStepSchema).min(1),
});

export const extractedReviewFlagSchema = z.object({
  kind: reviewFlagKindSchema,
  message: nonEmpty,
  related_local_ids: z.array(localId).default([]),
  severity: z.number().int().min(1).max(3).default(2),
});

/**
 * Forum quality is assessed independently from claim extraction.
 *
 * Sentiment is descriptive only. Retrieval decisions are driven by relevance,
 * discourse role, evidence strength, outcome support and explicit exclusion
 * reasons — not by whether the author sounded pleasant.
 */
export const extractedForumUnitAssessmentSchema = z.object({
  content_unit_local_id: localId,
  source_block_local_ids: z.array(localId).min(1),
  author_role: forumAuthorRoleSchema.default("unknown"),
  discourse_roles: z.array(forumDiscourseRoleSchema).min(1),
  automotive_relevance: confidence,
  thread_topic_relevance: confidence,
  constructiveness: confidence,
  helpfulness: confidence,
  evidence_strength: forumEvidenceStrengthSchema,
  sentiment: forumSentimentSchema,
  systems: z.array(nonEmpty).default([]),
  components: z.array(nonEmpty).default([]),
  symptoms: z.array(nonEmpty).default([]),
  diagnostic_codes: z.array(nonEmpty).default([]),
  vehicle_local_ids: z.array(localId).default([]),
  claim_local_ids: z.array(localId).default([]),
  retrieval_disposition: retrievalDispositionSchema,
  disposition_reasons: z.array(nonEmpty).default([]),
  extraction_confidence: confidence,
});

export const extractedForumThreadAssessmentSchema = z.object({
  thread_kind: forumThreadKindSchema,
  automotive_relevance: confidence,
  target_vehicle_confidence: confidence,
  off_topic_ratio: confidence,
  argument_ratio: confidence,
  constructive_ratio: confidence,
  evidence_density: confidence,
  outcome_signal: z.enum([
    "confirmed_resolution",
    "reported_improvement",
    "unresolved",
    "contradictory",
    "not_applicable",
    "unknown",
  ]),
  systems: z.array(nonEmpty).default([]),
  components: z.array(nonEmpty).default([]),
  symptoms: z.array(nonEmpty).default([]),
  retrieval_disposition: retrievalDispositionSchema,
  disposition_reasons: z.array(nonEmpty).default([]),
  assessed_unit_count: z.number().int().min(1),
  extraction_confidence: confidence,
});

/* ------------------------------------------------------------------ */
/* Payload                                                             */
/* ------------------------------------------------------------------ */

export const extractionPayloadSchema = z.object({
  schema_version: z.literal(EXTRACTION_SCHEMA_VERSION),
  extractor_version: nonEmpty,
  source: z.object({
    name: nonEmpty,
    base_url: z.string().url(),
    source_kind: sourceKindSchema,
    authority_tier: z.number().int().min(1).max(7),
  }),
  snapshot: z.object({
    canonical_url: z.string().url(),
    retrieved_url: z.string().url(),
    retrieved_at: z.string().datetime(),
    http_status: z.number().int(),
    content_hash: nonEmpty,
  }),
  document: extractedDocumentSchema,
  content_units: z.array(extractedContentUnitSchema).min(1),
  media: z.array(extractedMediaSchema).default([]),
  applicability: z.array(extractedApplicabilitySchema).default([]),
  vehicle_mentions: z.array(extractedVehicleMentionSchema).default([]),
  repair_cases: z.array(extractedRepairCaseSchema).default([]),
  observations: z.array(extractedObservationSchema).default([]),
  claims: z.array(extractedClaimSchema).default([]),
  claim_relations: z.array(extractedClaimRelationSchema).default([]),
  procedure_fragments: z.array(extractedProcedureFragmentSchema).default([]),
  forum_unit_assessments: z.array(extractedForumUnitAssessmentSchema).default([]),
  forum_thread_assessment: extractedForumThreadAssessmentSchema.nullish(),
  review_flags: z.array(extractedReviewFlagSchema).default([]),
});

export type ExtractionPayload = z.infer<typeof extractionPayloadSchema>;
export type ExtractedBlock = z.infer<typeof extractedBlockSchema>;
export type ExtractedContentUnit = z.infer<typeof extractedContentUnitSchema>;
export type ExtractedApplicability = z.infer<typeof extractedApplicabilitySchema>;
export type ExtractedVehicleMention = z.infer<typeof extractedVehicleMentionSchema>;
export type ExtractedRepairCase = z.infer<typeof extractedRepairCaseSchema>;
export type ExtractedObservation = z.infer<typeof extractedObservationSchema>;
export type ExtractedClaim = z.infer<typeof extractedClaimSchema>;
export type ExtractedClaimRelation = z.infer<typeof extractedClaimRelationSchema>;
export type ExtractedProcedureFragment = z.infer<typeof extractedProcedureFragmentSchema>;
export type ExtractedReviewFlag = z.infer<typeof extractedReviewFlagSchema>;
export type ExtractedForumUnitAssessment = z.infer<
  typeof extractedForumUnitAssessmentSchema
>;
export type ExtractedForumThreadAssessment = z.infer<
  typeof extractedForumThreadAssessmentSchema
>;
export type ReviewFlagKind = z.infer<typeof reviewFlagKindSchema>;
export type ClaimKind = z.infer<typeof claimKindSchema>;
export type ClaimBasis = z.infer<typeof claimBasisSchema>;
export type AssertionStrength = z.infer<typeof assertionStrengthSchema>;
